<?php
declare(strict_types=1);

$localEnvironment = [];
$localEnvironmentPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env';
if (is_readable($localEnvironmentPath)) {
    foreach (file($localEnvironmentPath, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        $line = preg_replace('/^\xEF\xBB\xBF/', '', $line) ?? $line;
        if (!preg_match('/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/', $line, $matches)) continue;
        $value = $matches[2];
        if (strlen($value) >= 2 && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) {
            $value = substr($value, 1, -1);
        }
        $localEnvironment[$matches[1]] = $value;
    }
}
$setting = static function (string $name, string $default = '') use ($localEnvironment): string {
    $value = getenv($name);
    if (is_string($value) && $value !== '') return $value;
    return (string)($localEnvironment[$name] ?? $default);
};

return [
    'host' => $setting('DB_HOST', '127.0.0.1'),
    'port' => $setting('DB_PORT', '3306'),
    'database' => $setting('DB_DATABASE', 'reserva_db'),
    'username' => $setting('DB_USERNAME', 'root'),
    'password' => $setting('DB_PASSWORD'),
    'payment_data_key' => $setting('PAYMENT_DATA_KEY'),
    'payments' => [
        'paymongo_secret_key' => $setting('PAYMONGO_SECRET_KEY'),
        'paymongo_webhook_secret' => $setting('PAYMONGO_WEBHOOK_SECRET'),
    ],
    'oauth' => [
        'frontend_url' => rtrim($setting('RESERVA_FRONTEND_URL', 'http://localhost:5173'), '/'),
        'callback_url' => $setting('RESERVA_OAUTH_CALLBACK_URL', 'http://localhost:5173/api/index.php?action=auth.oauth.callback'),
        'google' => [
            'client_id' => $setting('GOOGLE_CLIENT_ID'),
            'client_secret' => $setting('GOOGLE_CLIENT_SECRET'),
        ],
    ],
];
