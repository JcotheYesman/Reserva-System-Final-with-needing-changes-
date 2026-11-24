<?php
declare(strict_types=1);

final class OAuthFlowException extends RuntimeException
{
    public function __construct(
        public readonly string $reason,
        public readonly string $returnTo = '/dashboard',
        public readonly string $intent = 'login',
    ) {
        parent::__construct($reason);
    }
}

function oauthProviderConfig(array $config): array
{
    $settings = $config['oauth']['google'] ?? [];
    if (empty($settings['client_id']) || empty($settings['client_secret'])) {
        throw new OAuthFlowException('not_configured');
    }
    return $settings;
}

function oauthSafeReturnTo(mixed $value): string
{
    if (!is_string($value) || strlen($value) > 1500 || str_contains($value, "\r") || str_contains($value, "\n")) {
        return '/dashboard';
    }
    $parts = parse_url($value);
    if ($parts === false || isset($parts['scheme']) || isset($parts['host']) || isset($parts['fragment'])) {
        return '/dashboard';
    }
    if (!in_array($parts['path'] ?? '', ['/choose-schedule', '/confirm-booking'], true)) {
        return '/dashboard';
    }
    return $value;
}

function oauthStateScope(string $state): string
{
    return 'oauth:r:' . substr(hash('sha256', $state), 0, 56);
}

function oauthStart(PDO $db, array $config, string $provider, mixed $returnTo, mixed $flowId, mixed $intent): string
{
    if ($provider !== 'google') {
        throw new OAuthFlowException('invalid_provider');
    }
    $settings = oauthProviderConfig($config);
    $flowId = is_string($flowId) ? $flowId : '';
    if (!preg_match('/^[A-Za-z0-9_-]{32,80}$/', $flowId)) throw new OAuthFlowException('invalid_flow');
    if (!in_array($intent, ['login', 'signup'], true)) throw new OAuthFlowException('invalid_flow');
    $callbackUrl = (string)($config['oauth']['callback_url'] ?? '');
    if (!filter_var($callbackUrl, FILTER_VALIDATE_URL)) {
        throw new OAuthFlowException('callback_not_secure', oauthSafeReturnTo($returnTo));
    }

    $state = bin2hex(random_bytes(32));
    $nonce = bin2hex(random_bytes(32));
    $safeReturnTo = oauthSafeReturnTo($returnTo);
    $db->prepare("DELETE FROM app_state WHERE state_key = 'oauth.request' AND updated_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)")->execute();
    $saveState = $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, NULL, 'oauth.request', ?)");
    $saveState->execute([
        oauthStateScope($state),
        json_encode([
            'provider' => $provider,
            'state' => $state,
            'nonce' => $nonce,
            'flowId' => $flowId,
            'intent' => $intent,
            'returnTo' => $safeReturnTo,
            'startedAt' => time(),
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    ]);

    $authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    $parameters = [
        'client_id' => $settings['client_id'],
        'redirect_uri' => $callbackUrl,
        'response_type' => 'code',
        'scope' => 'openid email profile',
        'state' => $state,
        'nonce' => $nonce,
        'prompt' => 'select_account',
    ];
    return $authorizeUrl . '?' . http_build_query($parameters, '', '&', PHP_QUERY_RFC3986);
}

function oauthComplete(PDO $db, array $config, array $response): array
{
    $state = trim((string)($response['state'] ?? ''));
    if (!preg_match('/^[a-f0-9]{64}$/', $state)) throw new OAuthFlowException('invalid_state');

    $db->beginTransaction();
    try {
        $findState = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = 'oauth.request' FOR UPDATE");
        $findState->execute([oauthStateScope($state)]);
        $stateJson = $findState->fetchColumn();
        if (!is_string($stateJson)) throw new OAuthFlowException('invalid_state');
        $context = json_decode($stateJson, true, 16, JSON_THROW_ON_ERROR);
        $deleteState = $db->prepare("DELETE FROM app_state WHERE scope_key = ? AND state_key = 'oauth.request'");
        $deleteState->execute([oauthStateScope($state)]);
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }

    $provider = (string)($context['provider'] ?? '');
    $returnTo = oauthSafeReturnTo($context['returnTo'] ?? null);
    $intent = $context['intent'] ?? null;
    if (!in_array($intent, ['login', 'signup'], true)) throw new OAuthFlowException('invalid_state', $returnTo);
    $startedAt = (int)($context['startedAt'] ?? 0);
    if ($provider !== 'google' || !hash_equals((string)($context['state'] ?? ''), $state) || $startedAt < time() - 900 || $startedAt > time() + 60) {
        throw new OAuthFlowException('expired_state', $returnTo);
    }
    try {
    if (!empty($response['error'])) {
        throw new OAuthFlowException($response['error'] === 'user_cancelled_authorize' ? 'cancelled' : 'provider_denied', $returnTo);
    }

    $code = trim((string)($response['code'] ?? ''));
    if ($code === '') throw new OAuthFlowException('missing_code', $returnTo);
    $settings = oauthProviderConfig($config);
    $tokenResponse = oauthHttpJson('https://oauth2.googleapis.com/token', [
        'client_id' => $settings['client_id'],
        'client_secret' => $settings['client_secret'],
        'code' => $code,
        'grant_type' => 'authorization_code',
        'redirect_uri' => $config['oauth']['callback_url'],
    ]);
    $idToken = (string)($tokenResponse['id_token'] ?? '');
    if ($idToken === '') throw new OAuthFlowException('missing_identity_token', $returnTo);
    $claims = oauthVerifyIdentityToken($idToken, (string)$settings['client_id'], (string)$context['nonce']);

    $email = strtolower(trim((string)($claims['email'] ?? '')));
    $subject = (string)($claims['sub'] ?? '');
    $emailVerified = in_array($claims['email_verified'] ?? false, [true, 1, '1', 'true'], true);
    if ($subject === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || !$emailVerified) {
        throw new OAuthFlowException('unverified_email', $returnTo);
    }

    $fullName = trim((string)($claims['name'] ?? ''));
    if ($fullName === '') $fullName = ucfirst(str_replace(['.', '_', '-'], ' ', (string)strstr($email, '@', true)));
    $fullName = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', $fullName) ?? '');
    if ($fullName === '') $fullName = 'Reserva Player';
    if (function_exists('mb_substr')) $fullName = mb_substr($fullName, 0, 100);
    else $fullName = substr($fullName, 0, 100);

    $identityScope = 'oauth:g:' . substr(hash('sha256', $subject), 0, 56);
    $identityJson = json_encode(['provider' => $provider, 'subject' => $subject], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $db->beginTransaction();
    try {
        $findIdentity = $db->prepare("SELECT user_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'oauth.identity' FOR UPDATE");
        $findIdentity->execute([$identityScope]);
        $identity = $findIdentity->fetch();
        $userId = 0;
        if ($identity) {
            $storedIdentity = json_decode((string)$identity['state_value'], true);
            if (!is_array($storedIdentity) || !hash_equals((string)($storedIdentity['subject'] ?? ''), $subject)) {
                throw new OAuthFlowException('identity_conflict', $returnTo);
            }
            if ($intent === 'signup') throw new OAuthFlowException('account_already_registered', $returnTo, $intent);
            $userId = (int)$identity['user_id'];
        } else {
            $findUser = $db->prepare('SELECT user_id, account_status FROM users WHERE email = ? FOR UPDATE');
            $findUser->execute([$email]);
            $existingUser = $findUser->fetch();
            if ($existingUser) {
                if ($intent === 'signup') throw new OAuthFlowException('account_already_registered', $returnTo, $intent);
                if ($existingUser['account_status'] !== 'Active') throw new OAuthFlowException('account_inactive', $returnTo);
                $userId = (int)$existingUser['user_id'];
            } else {
                if ($intent === 'login') throw new OAuthFlowException('account_not_found', $returnTo, $intent);
                $createUser = $db->prepare("INSERT INTO users (full_name, email, phone, password_hash, role_id) VALUES (?, ?, '', ?, (SELECT role_id FROM roles WHERE role_name = 'User'))");
                $createUser->execute([$fullName, $email, password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT)]);
                $userId = (int)$db->lastInsertId();
            }
            $saveIdentity = $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'oauth.identity', ?) ON DUPLICATE KEY UPDATE state_value = IF(user_id = VALUES(user_id), VALUES(state_value), state_value)");
            $saveIdentity->execute([$identityScope, $userId, $identityJson]);
            $verifyIdentity = $db->prepare("SELECT user_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'oauth.identity' FOR UPDATE");
            $verifyIdentity->execute([$identityScope]);
            $stored = $verifyIdentity->fetch();
            $storedIdentity = is_array($stored) ? json_decode((string)$stored['state_value'], true) : null;
            if (!$stored || (int)$stored['user_id'] !== $userId || !is_array($storedIdentity) || !hash_equals((string)($storedIdentity['subject'] ?? ''), $subject)) {
                throw new OAuthFlowException('identity_conflict', $returnTo);
            }
        }
        $account = $db->prepare('SELECT account_status FROM users WHERE user_id = ? FOR UPDATE');
        $account->execute([$userId]);
        if ($account->fetchColumn() !== 'Active') throw new OAuthFlowException('account_inactive', $returnTo);
        $db->commit();
        return ['userId' => $userId, 'returnTo' => $returnTo, 'flowId' => (string)$context['flowId'], 'intent' => $intent];
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        if ($error instanceof PDOException && $error->getCode() === '23000') {
            throw new OAuthFlowException($intent === 'signup' ? 'account_already_registered' : 'account_conflict', $returnTo, $intent);
        }
        throw $error;
    }
    } catch (OAuthFlowException $error) {
        throw new OAuthFlowException($error->reason, $returnTo, $intent);
    }
}

function oauthCreateTicket(PDO $db, int $userId, string $flowId, string $returnTo, string $intent): string
{
    if (!in_array($intent, ['login', 'signup'], true)) throw new OAuthFlowException('invalid_flow');
    $ticket = bin2hex(random_bytes(32));
    $scope = 'oauth:t:' . substr(hash('sha256', $ticket), 0, 56);
    $db->prepare("DELETE FROM app_state WHERE state_key = 'oauth.ticket' AND updated_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)")->execute();
    $save = $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'oauth.ticket', ?)");
    $save->execute([
        $scope,
        $userId,
        json_encode(['flowId' => $flowId, 'returnTo' => oauthSafeReturnTo($returnTo), 'intent' => $intent, 'createdAt' => time()], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    ]);
    return $ticket;
}

function oauthConsumeTicket(PDO $db, string $ticket, string $flowId, string $intent): int
{
    if (!preg_match('/^[a-f0-9]{64}$/', $ticket) || !preg_match('/^[A-Za-z0-9_-]{32,80}$/', $flowId) || !in_array($intent, ['login', 'signup'], true)) {
        throw new OAuthFlowException('invalid_flow');
    }
    $sessionFlowId = (string)($_SESSION['oauth_flow_id'] ?? '');
    if ($sessionFlowId === '') {
        $completedFlowId = (string)($_SESSION['oauth_completed_flow_id'] ?? '');
        $completedIntent = (string)($_SESSION['oauth_completed_intent'] ?? '');
        if ($completedFlowId !== '' && hash_equals($completedFlowId, $flowId) && hash_equals($completedIntent, $intent) && !empty($_SESSION['user_id'])) {
            return (int)$_SESSION['user_id'];
        }
        throw new OAuthFlowException('invalid_flow');
    }
    if (!hash_equals($sessionFlowId, $flowId) || !hash_equals((string)($_SESSION['oauth_intent'] ?? ''), $intent)) throw new OAuthFlowException('invalid_flow');
    $scope = 'oauth:t:' . substr(hash('sha256', $ticket), 0, 56);
    $db->beginTransaction();
    try {
        $find = $db->prepare("SELECT user_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'oauth.ticket' FOR UPDATE");
        $find->execute([$scope]);
        $row = $find->fetch();
        if (!$row) throw new OAuthFlowException('expired_ticket');
        $context = json_decode((string)$row['state_value'], true, 16, JSON_THROW_ON_ERROR);
        $createdAt = (int)($context['createdAt'] ?? 0);
        if (!hash_equals((string)($context['flowId'] ?? ''), $flowId) || !hash_equals((string)($context['intent'] ?? ''), $intent) || $createdAt < time() - 300 || $createdAt > time() + 60) {
            throw new OAuthFlowException('expired_ticket');
        }
        $account = $db->prepare('SELECT account_status FROM users WHERE user_id = ? FOR UPDATE');
        $account->execute([(int)$row['user_id']]);
        if ($account->fetchColumn() !== 'Active') throw new OAuthFlowException('account_inactive');
        $delete = $db->prepare("DELETE FROM app_state WHERE scope_key = ? AND state_key = 'oauth.ticket'");
        $delete->execute([$scope]);
        $db->commit();
        unset($_SESSION['oauth_flow_id'], $_SESSION['oauth_intent']);
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$row['user_id'];
        $_SESSION['oauth_completed_flow_id'] = $flowId;
        $_SESSION['oauth_completed_intent'] = $intent;
        return (int)$row['user_id'];
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function oauthVerifyIdentityToken(string $token, string $clientId, string $expectedNonce): array
{
    $parts = explode('.', $token);
    if (count($parts) !== 3) throw new OAuthFlowException('invalid_identity_token');
    $header = json_decode(oauthBase64UrlDecode($parts[0]), true);
    $claims = json_decode(oauthBase64UrlDecode($parts[1]), true);
    $signature = oauthBase64UrlDecode($parts[2]);
    if (!is_array($header) || !is_array($claims) || ($header['alg'] ?? '') !== 'RS256' || empty($header['kid'])) {
        throw new OAuthFlowException('invalid_identity_token');
    }
    $keySet = oauthHttpJson('https://www.googleapis.com/oauth2/v3/certs');
    $jwk = null;
    foreach (($keySet['keys'] ?? []) as $candidate) {
        if (($candidate['kid'] ?? '') === $header['kid']) { $jwk = $candidate; break; }
    }
    if (!$jwk) throw new OAuthFlowException('invalid_identity_token');
    $publicKey = oauthRsaPublicKey($jwk);
    if (openssl_verify($parts[0] . '.' . $parts[1], $signature, $publicKey, OPENSSL_ALGO_SHA256) !== 1) {
        throw new OAuthFlowException('invalid_identity_token');
    }

    $issuerValid = in_array($claims['iss'] ?? '', ['https://accounts.google.com', 'accounts.google.com'], true);
    $audiences = is_array($claims['aud'] ?? null) ? $claims['aud'] : [$claims['aud'] ?? ''];
    $now = time();
    $authorizedPartyValid = count($audiences) <= 1 || ($claims['azp'] ?? '') === $clientId;
    if (!$issuerValid || !$authorizedPartyValid || !in_array($clientId, $audiences, true) || empty($claims['sub']) || (int)($claims['iat'] ?? 0) < 1 || (int)($claims['exp'] ?? 0) <= $now || (int)$claims['iat'] > $now + 60 || !hash_equals($expectedNonce, (string)($claims['nonce'] ?? ''))) {
        throw new OAuthFlowException('invalid_identity_token');
    }
    if (!empty($claims['nbf']) && (int)$claims['nbf'] > $now + 60) throw new OAuthFlowException('invalid_identity_token');
    return $claims;
}

function oauthHttpJson(string $url, ?array $form = null): array
{
    $body = $form === null ? null : http_build_query($form, '', '&', PHP_QUERY_RFC3986);
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        if ($curl === false) throw new OAuthFlowException('provider_unavailable');
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => $body === null ? ['Accept: application/json'] : ['Accept: application/json', 'Content-Type: application/x-www-form-urlencoded'],
        ]);
        if ($body !== null) {
            curl_setopt($curl, CURLOPT_POST, true);
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }
        $response = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
    } else {
        $options = [
            'http' => [
                'method' => $body === null ? 'GET' : 'POST',
                'header' => $body === null ? "Accept: application/json\r\n" : "Accept: application/json\r\nContent-Type: application/x-www-form-urlencoded\r\n",
                'timeout' => 15,
                'ignore_errors' => true,
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ];
        if ($body !== null) $options['http']['content'] = $body;
        $context = stream_context_create($options);
        $response = @file_get_contents($url, false, $context);
        $status = 0;
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $matches)) $status = (int)$matches[1];
        }
    }
    if (!is_string($response) || $status < 200 || $status >= 300) throw new OAuthFlowException('provider_unavailable');
    $decoded = json_decode($response, true);
    if (!is_array($decoded)) throw new OAuthFlowException('provider_unavailable');
    return $decoded;
}

function oauthBase64UrlDecode(string $value): string
{
    $decoded = base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4), true);
    if ($decoded === false) throw new OAuthFlowException('invalid_identity_token');
    return $decoded;
}

function oauthAsn1Length(int $length): string
{
    if ($length < 128) return chr($length);
    $bytes = '';
    while ($length > 0) {
        $bytes = chr($length & 0xff) . $bytes;
        $length >>= 8;
    }
    return chr(0x80 | strlen($bytes)) . $bytes;
}

function oauthAsn1Integer(string $value): string
{
    $value = ltrim($value, "\x00");
    if ($value === '') $value = "\x00";
    if ((ord($value[0]) & 0x80) !== 0) $value = "\x00" . $value;
    return "\x02" . oauthAsn1Length(strlen($value)) . $value;
}

function oauthAsn1Sequence(string $value): string
{
    return "\x30" . oauthAsn1Length(strlen($value)) . $value;
}

function oauthPem(string $der): string
{
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

function oauthRsaPublicKey(array $jwk): string
{
    if (($jwk['kty'] ?? '') !== 'RSA' || empty($jwk['n']) || empty($jwk['e'])) throw new OAuthFlowException('invalid_identity_token');
    $modulus = oauthBase64UrlDecode((string)$jwk['n']);
    $exponent = oauthBase64UrlDecode((string)$jwk['e']);
    $rsaKey = oauthAsn1Sequence(oauthAsn1Integer($modulus) . oauthAsn1Integer($exponent));
    $algorithm = hex2bin('300d06092a864886f70d0101010500');
    $bitString = "\x03" . oauthAsn1Length(strlen($rsaKey) + 1) . "\x00" . $rsaKey;
    return oauthPem(oauthAsn1Sequence($algorithm . $bitString));
}

