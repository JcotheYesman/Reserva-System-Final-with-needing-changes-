<?php
declare(strict_types=1);
require_once __DIR__ . '/oauth.php';

ini_set('display_errors', '0');
ini_set('log_errors', '1');
ob_start();
set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) return false;
    throw new ErrorException($message, 0, $severity, $file, $line);
});

function respond(array $body, int $status = 200): never
{
    while (ob_get_level() > 0) ob_end_clean();
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
    exit;
}

function fail(string $message, int $status = 400): never
{
    respond(['success' => false, 'error' => $message, 'message' => $message], $status);
}

function redirectOAuthResult(array $config, string $result, string $returnTo = '/dashboard', array $extra = []): never
{
    $frontendUrl = rtrim((string)($config['oauth']['frontend_url'] ?? 'http://localhost:5173'), '/');
    $parameters = ['result' => $result, 'returnTo' => oauthSafeReturnTo($returnTo)];
    foreach (['ticket', 'flowId'] as $key) {
        if (isset($extra[$key]) && is_string($extra[$key])) $parameters[$key] = $extra[$key];
    }
    if (isset($extra['intent']) && in_array($extra['intent'], ['login', 'signup'], true)) {
        $parameters['intent'] = $extra['intent'];
    }
    header('Cache-Control: no-store');
    header('Referrer-Policy: no-referrer');
    header('Location: ' . $frontendUrl . '/auth/callback?' . http_build_query($parameters, '', '&', PHP_QUERY_RFC3986), true, 302);
    exit;
}

final class ApiException extends RuntimeException
{
    public function __construct(string $message, public readonly int $status)
    {
        parent::__construct($message);
    }
}

function input(?string &$rawBody = null): array
{
    $rawBody = file_get_contents('php://input') ?: '';
    $value = json_decode($rawBody, true);
    return is_array($value) ? $value : [];
}

function currentUser(PDO $db): array
{
    if (empty($_SESSION['user_id'])) {
        fail('Please sign in to continue.', 401);
    }
    $query = $db->prepare(
        'SELECT u.user_id AS id, u.full_name AS name, u.email, u.phone, u.created_at AS memberSince, u.online_status AS onlineStatus, u.preferred_sports AS preferredSports,
                u.owner_code AS ownerId, u.account_status AS status, r.role_name AS role
         FROM users u LEFT JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ?'
    );
    $query->execute([$_SESSION['user_id']]);
    $user = $query->fetch();
    if (!$user || $user['status'] !== 'Active') {
        $_SESSION = [];
        fail('Your account is unavailable.', 401);
    }
    $user['preferredSports'] = json_decode($user['preferredSports'] ?: '[]', true) ?: [];
    return $user;
}

function profilePicture(PDO $db, int $userId): ?string
{
    $query = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = 'profile.picture'");
    $query->execute(['user:' . $userId]);
    $value = $query->fetchColumn();
    if ($value === false) return null;
    $picture = json_decode((string)$value, true);
    return is_string($picture) ? $picture : null;
}

function profileAddress(PDO $db, int $userId): string
{
    $query = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = 'profile.address'");
    $query->execute(['user:' . $userId]);
    $value = $query->fetchColumn();
    if ($value === false) return '';
    $address = json_decode((string)$value, true);
    return is_string($address) ? $address : '';
}

function profilePayload(PDO $db, array $user): array
{
    $user['profilePicture'] = profilePicture($db, (int)$user['id']);
    $user['address'] = profileAddress($db, (int)$user['id']);
    return $user;
}

function facilityColorOptions(): array
{
    return ['#1d4ed8', '#6d28d9', '#0f766e', '#15803d', '#be123c', '#475569', '#b45309', '#4338ca'];
}

function defaultFacilityColor(int $facilityId): string
{
    $colors = facilityColorOptions();
    return $colors[abs($facilityId) % count($colors)];
}

function defaultSportColor(int $sportId, string $name): string
{
    $namedColors = [
        'Basketball' => '#ff7a00', 'Pickle Ball' => '#22e05a', 'Swimming' => '#22e5e5',
        'Volleyball' => '#1f5fff', 'Futsal' => '#1f5fff', 'Tennis' => '#ffffff',
        'Badminton' => '#ffffff', 'Soccer' => '#e6f21a', 'Football' => '#e6f21a',
    ];
    foreach ($namedColors as $sport => $color) {
        if (strcasecmp($sport, $name) === 0) return $color;
    }
    $palette = ['#ff7a00', '#22e05a', '#22e5e5', '#1f5fff', '#c026d3', '#e6f21a', '#ef4444', '#a3e635'];
    return $palette[abs($sportId) % count($palette)];
}

function readSportColors(PDO $db): array
{
    $query = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = 'global' AND state_key = 'sports.colors' LIMIT 1 FOR UPDATE");
    $query->execute();
    $colors = json_decode((string)($query->fetchColumn() ?: '{}'), true);
    if (!is_array($colors)) return [];
    return array_filter($colors, static fn(mixed $color): bool => is_string($color) && preg_match('/^#[0-9a-fA-F]{6}$/', $color) === 1);
}

function writeSportColors(PDO $db, array $colors): void
{
    $save = $db->prepare(
        'INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (\'global\', NULL, \'sports.colors\', ?)
         ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP'
    );
    $save->execute([json_encode($colors, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
}

function facilityPresentation(PDO $db, int $facilityId): array
{
    $query = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = 'facility.presentation' LIMIT 1");
    $query->execute(['facility:' . $facilityId]);
    $value = json_decode((string)($query->fetchColumn() ?: ''), true);
    $value = is_array($value) ? $value : [];
    $color = strtolower((string)($value['color'] ?? ''));
    return [
        'image' => is_string($value['image'] ?? null) ? $value['image'] : null,
        'color' => in_array($color, facilityColorOptions(), true) ? $color : defaultFacilityColor($facilityId),
    ];
}

function validateFacilityImage(mixed $image): ?string
{
    if ($image === null || $image === '') return null;
    if (!is_string($image) || strlen($image) > 600000 ||
        !preg_match('/\\Adata:image\\/(png|jpeg|webp);base64,([A-Za-z0-9+\\/=]+)\\z/', $image, $matches)) {
        fail('Choose a valid PNG, JPEG, or WebP facility photo.', 422);
    }
    $binary = base64_decode($matches[2], true);
    if ($binary === false || strlen($binary) > 450000) fail('The facility photo must be smaller than 450 KB after cropping.', 422);
    $details = getimagesizefromstring($binary);
    $declaredMimeType = $matches[1] === 'jpeg' ? 'image/jpeg' : 'image/' . $matches[1];
    $allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!$details || !in_array($details['mime'] ?? '', $allowedMimeTypes, true) || ($details['mime'] ?? '') !== $declaredMimeType ||
        (int)$details[0] < 320 || (int)$details[1] < 180 || (int)$details[0] > 1600 || (int)$details[1] > 900 ||
        abs(((int)$details[0] / (int)$details[1]) - (16 / 9)) > 0.03) {
        fail('Crop the facility photo to a valid 16:9 image before saving.', 422);
    }
    return $image;
}

function saveFacilityPresentation(PDO $db, int $facilityId, ?string $image, string $color): void
{
    $save = $db->prepare(
        'INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP'
    );
    $save->execute([
        'facility:' . $facilityId,
        'facility.presentation',
        json_encode(['image' => $image, 'color' => $color], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    ]);
}

function decodeEquipmentImage(mixed $image): ?array
{
    if ($image === null || $image === '') return null;
    if (!is_string($image) || strlen($image) > 700000 ||
        !preg_match('/\\Adata:image\\/(png|jpeg|webp);base64,([A-Za-z0-9+\\/=]+)\\z/', $image, $matches)) {
        throw new ApiException('Choose a valid PNG, JPEG, or WebP equipment photo.', 422);
    }
    $binary = base64_decode($matches[2], true);
    if ($binary === false || strlen($binary) > 500000) throw new ApiException('Equipment photos must be 500 KB or smaller.', 422);
    $details = getimagesizefromstring($binary);
    $mime = $matches[1] === 'jpeg' ? 'image/jpeg' : 'image/' . $matches[1];
    if (!$details || ($details['mime'] ?? '') !== $mime) throw new ApiException('The equipment photo could not be read.', 422);
    return ['dataUrl' => $image, 'binary' => $binary, 'mime' => $mime];
}

function normalizeEquipmentCatalog(mixed $catalog): array
{
    if (!is_array($catalog) || count($catalog) > 100) throw new ApiException('Equipment categories are invalid.', 422);
    $normalized = [];
    $categoryNames = [];
    $itemCount = 0;
    foreach ($catalog as $category) {
        if (!is_array($category)) throw new ApiException('An equipment category is invalid.', 422);
        $name = trim((string)($category['name'] ?? ''));
        $categoryId = isset($category['id']) ? filter_var($category['id'], FILTER_VALIDATE_INT) : null;
        $key = function_exists('mb_strtolower') ? mb_strtolower($name) : strtolower($name);
        $items = $category['items'] ?? [];
        if ($name === '' || strlen($name) > 100 || isset($categoryNames[$key]) || !is_array($items) || ($categoryId !== null && $categoryId === false)) {
            throw new ApiException('Enter a unique name for each equipment category.', 422);
        }
        $categoryNames[$key] = true;
        $normalizedItems = [];
        foreach ($items as $item) {
            if (!is_array($item)) throw new ApiException('An equipment item is invalid.', 422);
            $itemName = trim((string)($item['name'] ?? ''));
            $itemId = isset($item['id']) ? filter_var($item['id'], FILTER_VALIDATE_INT) : null;
            $unitPrice = $item['unitPrice'] ?? null;
            $billingUnit = (string)($item['billingUnit'] ?? 'hour');
            $stock = filter_var($item['stockQuantity'] ?? 1, FILTER_VALIDATE_INT);
            if ($itemName === '' || strlen($itemName) > 120 || !is_numeric($unitPrice) || (float)$unitPrice < 0 ||
                !in_array($billingUnit, ['hour', 'piece'], true) || $stock === false || $stock < 0 || $stock > 100000 || ($itemId !== null && $itemId === false)) {
                throw new ApiException('Enter a valid equipment name, price, billing unit, and stock quantity.', 422);
            }
            $image = decodeEquipmentImage($item['image'] ?? null);
            $normalizedItems[] = [
                'id' => $itemId ? (int)$itemId : null,
                'name' => $itemName,
                'unitPrice' => round((float)$unitPrice, 2),
                'billingUnit' => $billingUnit,
                'stockQuantity' => (int)$stock,
                'image' => $image['dataUrl'] ?? null,
            ];
            $itemCount++;
            if ($itemCount > 1000) throw new ApiException('A facility can list up to 1,000 equipment items.', 422);
        }
        $normalized[] = ['id' => $categoryId ? (int)$categoryId : null, 'name' => $name, 'items' => $normalizedItems];
    }
    return $normalized;
}

function hasEquipmentRentalAmenity(array $amenities): bool
{
    foreach ($amenities as $amenity) {
        if (is_string($amenity) && strtolower(trim($amenity)) === 'equipment rental') return true;
    }
    return false;
}

function equipmentTimeMinutes(mixed $value): int
{
    if (!preg_match('/^(\d{1,2}):(\d{2})/', (string)$value, $matches)) return 0;
    return ((int)$matches[1] * 60) + (int)$matches[2];
}

function equipmentReservationIntervals(PDO $db, array $itemIds, ?string $date = null): array
{
    $itemIds = array_values(array_unique(array_filter(array_map('intval', $itemIds), static fn(int $id): bool => $id > 0)));
    if (!$itemIds) return [];
    $sql = "SELECT e.reservation_equipment_id, e.quantity, r.reservation_date, r.start_time, r.end_time,
                   e.equipment_item_id, rc.start_time AS court_start_time, rc.end_time AS court_end_time
            FROM reservation_equipment_items e
            JOIN reservations r ON r.reservation_id = e.reservation_id
            LEFT JOIN reservation_courts rc ON rc.reservation_id = r.reservation_id
            WHERE e.equipment_item_id IN (" . implode(',', array_fill(0, count($itemIds), '?')) . ")
              AND r.status IN ('Pending', 'Pending payment', 'Payment verification', 'Confirmed', 'Checked in', 'Disputed')";
    $params = $itemIds;
    if ($date !== null) {
        $sql .= ' AND r.reservation_date = ?';
        $params[] = $date;
    } else {
        $sql .= ' AND r.reservation_date >= CURDATE()';
    }
    $query = $db->prepare($sql);
    $query->execute($params);
    $reservations = [];
    foreach ($query->fetchAll() as $row) {
        $itemId = (int)$row['equipment_item_id'];
        $lineId = (int)$row['reservation_equipment_id'];
        if (!isset($reservations[$itemId][$lineId])) {
            $reservations[$itemId][$lineId] = [
                'date' => (string)$row['reservation_date'], 'quantity' => (int)$row['quantity'],
                'fallback' => [equipmentTimeMinutes($row['start_time']), equipmentTimeMinutes($row['end_time'])],
                'intervals' => [],
            ];
        }
        if ($row['court_start_time'] !== null && $row['court_end_time'] !== null) {
            $reservations[$itemId][$lineId]['intervals'][] = [equipmentTimeMinutes($row['court_start_time']), equipmentTimeMinutes($row['court_end_time'])];
        }
    }
    $normalizedReservations = [];
    foreach ($reservations as $itemId => $itemReservations) {
        foreach ($itemReservations as &$reservation) {
            $intervals = $reservation['intervals'] ?: [$reservation['fallback']];
            usort($intervals, static fn(array $left, array $right): int => $left[0] <=> $right[0]);
            $merged = [];
            foreach ($intervals as [$start, $end]) {
                if ($end <= $start) continue;
                $lastIndex = count($merged) - 1;
                if ($lastIndex >= 0 && $start <= $merged[$lastIndex][1]) $merged[$lastIndex][1] = max($merged[$lastIndex][1], $end);
                else $merged[] = [$start, $end];
            }
            $reservation['intervals'] = $merged;
        }
        unset($reservation);
        $normalizedReservations[(int)$itemId] = array_values($itemReservations);
    }
    return $normalizedReservations;
}

function maximumCommittedEquipmentQuantities(PDO $db, array $itemIds): array
{
    $eventsByItemDate = [];
    foreach (equipmentReservationIntervals($db, $itemIds) as $itemId => $reservations) {
        foreach ($reservations as $reservation) {
            foreach ($reservation['intervals'] as [$start, $end]) {
                $eventsByItemDate[$itemId][$reservation['date']][] = [$start, $reservation['quantity']];
                $eventsByItemDate[$itemId][$reservation['date']][] = [$end, -$reservation['quantity']];
            }
        }
    }
    $maximumByItem = array_fill_keys(array_map('intval', $itemIds), 0);
    foreach ($eventsByItemDate as $itemId => $dates) {
        foreach ($dates as $events) {
            usort($events, static fn(array $left, array $right): int => ($left[0] <=> $right[0]) ?: ($left[1] <=> $right[1]));
            $current = 0;
            foreach ($events as [, $change]) {
                $current += $change;
                $maximumByItem[(int)$itemId] = max($maximumByItem[(int)$itemId], $current);
            }
        }
    }
    return $maximumByItem;
}

function reservedEquipmentQuantityDuring(array $reservations, array $courtBookings): int
{
    $reserved = 0;
    foreach ($reservations as $reservation) {
        foreach ($reservation['intervals'] as [$reservedStart, $reservedEnd]) {
            foreach ($courtBookings as $booking) {
                $requestedStart = equipmentTimeMinutes($booking['startTime'] ?? '');
                $requestedEnd = equipmentTimeMinutes($booking['endTime'] ?? '');
                if ($requestedStart < $reservedEnd && $requestedEnd > $reservedStart) {
                    $reserved += $reservation['quantity'];
                    continue 3;
                }
            }
        }
    }
    return $reserved;
}

function replaceFacilityEquipment(PDO $db, int $facilityId, array $catalog): void
{
    $currentQuery = $db->prepare(
        'SELECT c.equipment_category_id, i.equipment_item_id, i.stock_quantity
         FROM facility_equipment_categories c LEFT JOIN facility_equipment_items i ON i.equipment_category_id = c.equipment_category_id
         WHERE c.facility_id = ?'
    );
    $currentQuery->execute([$facilityId]);
    $existingCategories = [];
    $existingItems = [];
    foreach ($currentQuery->fetchAll() as $row) {
        $existingCategories[(int)$row['equipment_category_id']] = true;
        if ($row['equipment_item_id'] !== null) $existingItems[(int)$row['equipment_item_id']] = (int)$row['stock_quantity'];
    }
    $submittedItems = [];
    foreach ($catalog as $category) foreach ($category['items'] as $item) if (!empty($item['id'])) $submittedItems[(int)$item['id']] = (int)$item['stockQuantity'];
    $committedByItem = maximumCommittedEquipmentQuantities($db, array_keys($existingItems));
    foreach ($existingItems as $existingItemId => $_stock) {
        $committed = (int)($committedByItem[$existingItemId] ?? 0);
        if (!array_key_exists($existingItemId, $submittedItems) && $committed > 0) {
            throw new ApiException('An equipment item with upcoming rentals cannot be removed yet.', 409);
        }
        if (array_key_exists($existingItemId, $submittedItems) && $submittedItems[$existingItemId] < $committed) {
            throw new ApiException('Equipment stock cannot be reduced below the quantity committed to upcoming rentals.', 409);
        }
    }
    $deactivateCategories = $db->prepare('UPDATE facility_equipment_categories SET is_active = 0 WHERE facility_id = ?');
    $deactivateCategories->execute([$facilityId]);
    $deactivateItems = $db->prepare('UPDATE facility_equipment_items i JOIN facility_equipment_categories c ON c.equipment_category_id = i.equipment_category_id SET i.is_active = 0 WHERE c.facility_id = ?');
    $deactivateItems->execute([$facilityId]);
    $insertCategory = $db->prepare('INSERT INTO facility_equipment_categories (facility_id, category_name, display_order, is_active) VALUES (?, ?, ?, 1)');
    $updateCategory = $db->prepare('UPDATE facility_equipment_categories SET category_name = ?, display_order = ?, is_active = 1 WHERE equipment_category_id = ? AND facility_id = ?');
    $insertItem = $db->prepare(
        'INSERT INTO facility_equipment_items (equipment_category_id, item_name, unit_price, billing_unit, stock_quantity, image_data, image_mime, display_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
    );
    $updateItem = $db->prepare(
        'UPDATE facility_equipment_items i JOIN facility_equipment_categories c ON c.equipment_category_id = i.equipment_category_id
         SET i.equipment_category_id = ?, i.item_name = ?, i.unit_price = ?, i.billing_unit = ?, i.stock_quantity = ?,
             i.image_data = ?, i.image_mime = ?, i.display_order = ?, i.is_active = 1
         WHERE i.equipment_item_id = ? AND c.facility_id = ?'
    );
    foreach (array_values($catalog) as $categoryOrder => $category) {
        if (!empty($category['id'])) {
            $categoryId = (int)$category['id'];
            if (!isset($existingCategories[$categoryId])) throw new ApiException('An equipment category does not belong to this facility.', 403);
            $updateCategory->execute([$category['name'], $categoryOrder, $categoryId, $facilityId]);
        } else {
            $insertCategory->execute([$facilityId, $category['name'], $categoryOrder]);
            $categoryId = (int)$db->lastInsertId();
        }
        foreach (array_values($category['items']) as $itemOrder => $item) {
            $image = decodeEquipmentImage($item['image'] ?? null);
            $values = [$categoryId, $item['name'], $item['unitPrice'], $item['billingUnit'], $item['stockQuantity'], $image['binary'] ?? null, $image['mime'] ?? null, $itemOrder];
            if (!empty($item['id'])) {
                $itemId = (int)$item['id'];
                if (!isset($existingItems[$itemId])) throw new ApiException('An equipment item does not belong to this facility.', 403);
                $updateItem->execute([...$values, $itemId, $facilityId]);
            } else {
                $insertItem->execute($values);
            }
        }
    }
}

function readFacilityEquipmentCatalog(PDO $db, int $facilityId): array
{
    $query = $db->prepare(
        'SELECT c.equipment_category_id, c.category_name, i.equipment_item_id, i.item_name, i.unit_price,
                i.billing_unit, i.stock_quantity, i.image_data, i.image_mime
         FROM facility_equipment_categories c
         LEFT JOIN facility_equipment_items i ON i.equipment_category_id = c.equipment_category_id
         WHERE c.facility_id = ? AND c.is_active = 1 AND (i.equipment_item_id IS NULL OR i.is_active = 1)
         ORDER BY c.display_order, c.equipment_category_id, i.display_order, i.equipment_item_id'
    );
    $query->execute([$facilityId]);
    $categories = [];
    foreach ($query->fetchAll() as $row) {
        $categoryId = (int)$row['equipment_category_id'];
        if (!isset($categories[$categoryId])) $categories[$categoryId] = ['id' => $categoryId, 'name' => $row['category_name'], 'items' => []];
        if ($row['equipment_item_id'] === null) continue;
        $image = $row['image_data'] === null ? null : 'data:' . $row['image_mime'] . ';base64,' . base64_encode((string)$row['image_data']);
        $categories[$categoryId]['items'][] = [
            'id' => (int)$row['equipment_item_id'], 'name' => $row['item_name'],
            'unitPrice' => (float)$row['unit_price'], 'billingUnit' => $row['billing_unit'],
            'stockQuantity' => (int)$row['stock_quantity'], 'image' => $image,
        ];
    }
    return array_values($categories);
}

function equipmentUsageHours(array $courtBookings): int
{
    $intervals = [];
    foreach ($courtBookings as $booking) {
        $start = ((int)substr((string)$booking['startTime'], 0, 2) * 60) + (int)substr((string)$booking['startTime'], 3, 2);
        $end = ((int)substr((string)$booking['endTime'], 0, 2) * 60) + (int)substr((string)$booking['endTime'], 3, 2);
        if ($end > $start) $intervals[] = [$start, $end];
    }
    usort($intervals, static fn(array $a, array $b): int => $a[0] <=> $b[0]);
    if (!$intervals) return 0;
    $total = 0;
    [$start, $end] = $intervals[0];
    foreach (array_slice($intervals, 1) as [$nextStart, $nextEnd]) {
        if ($nextStart <= $end) $end = max($end, $nextEnd);
        else { $total += $end - $start; [$start, $end] = [$nextStart, $nextEnd]; }
    }
    return (int)(($total + $end - $start) / 60);
}

function reservationEquipmentLines(PDO $db, int $reservationId): array
{
    $query = $db->prepare(
        'SELECT reservation_equipment_id, equipment_item_id, category_name_snapshot, item_name_snapshot,
                billing_unit_snapshot, unit_price_snapshot, quantity, billed_hours, line_total,
                image_data_snapshot, image_mime_snapshot
         FROM reservation_equipment_items WHERE reservation_id = ? ORDER BY reservation_equipment_id'
    );
    $query->execute([$reservationId]);
    return array_map(static function (array $row): array {
        $image = $row['image_data_snapshot'] === null ? null : 'data:' . $row['image_mime_snapshot'] . ';base64,' . base64_encode((string)$row['image_data_snapshot']);
        return [
            'id' => $row['equipment_item_id'] === null ? null : (int)$row['equipment_item_id'],
            'categoryName' => $row['category_name_snapshot'], 'itemName' => $row['item_name_snapshot'],
            'billingUnit' => $row['billing_unit_snapshot'], 'unitPrice' => (float)$row['unit_price_snapshot'],
            'quantity' => (int)$row['quantity'], 'billedHours' => (int)$row['billed_hours'],
            'lineTotal' => (float)$row['line_total'], 'image' => $image,
        ];
    }, $query->fetchAll());
}

function validateReservationEquipment(PDO $db, int $facilityId, array $amenities, array $selections, string $date, array $courtBookings): array
{
    if (!$selections) return [];
    if (!hasEquipmentRentalAmenity($amenities)) throw new ApiException('This facility does not offer equipment rental.', 422);
    if (count($selections) > 100) throw new ApiException('Choose up to 100 equipment items per reservation.', 422);
    $hours = equipmentUsageHours($courtBookings);
    $selectedItemIds = [];
    foreach ($selections as $selection) {
        if (is_array($selection)) {
            $id = filter_var($selection['itemId'] ?? null, FILTER_VALIDATE_INT);
            if ($id && $id > 0) $selectedItemIds[] = (int)$id;
        }
    }
    $existingEquipmentUse = equipmentReservationIntervals($db, $selectedItemIds, $date);
    $itemQuery = $db->prepare(
        'SELECT i.equipment_item_id, i.item_name, i.unit_price, i.billing_unit, i.stock_quantity, i.image_data, i.image_mime, c.category_name
         FROM facility_equipment_items i JOIN facility_equipment_categories c ON c.equipment_category_id = i.equipment_category_id
         WHERE i.equipment_item_id = ? AND c.facility_id = ? AND i.is_active = 1 AND c.is_active = 1 FOR UPDATE'
    );
    $seen = [];
    $lines = [];
    foreach ($selections as $selection) {
        if (!is_array($selection)) throw new ApiException('An equipment selection is invalid.', 422);
        $itemId = filter_var($selection['itemId'] ?? null, FILTER_VALIDATE_INT);
        $quantity = filter_var($selection['quantity'] ?? null, FILTER_VALIDATE_INT);
        if (!$itemId || !$quantity || $quantity < 1 || $quantity > 100000 || isset($seen[$itemId])) {
            throw new ApiException('Choose a valid quantity for each equipment item.', 422);
        }
        $seen[$itemId] = true;
        $itemQuery->execute([(int)$itemId, $facilityId]);
        $item = $itemQuery->fetch();
        if (!$item) throw new ApiException('An equipment item is no longer available at this facility. Refresh and review the equipment list.', 409);
        $reserved = reservedEquipmentQuantityDuring($existingEquipmentUse[(int)$itemId] ?? [], $courtBookings);
        $available = max(0, (int)$item['stock_quantity'] - $reserved);
        if ($quantity > $available) throw new ApiException('Only ' . $available . ' of ' . $item['item_name'] . ' are available for this schedule.', 409);
        $billingUnit = (string)$item['billing_unit'];
        $billedHours = $billingUnit === 'hour' ? $hours : 0;
        if ($billingUnit === 'hour' && $billedHours < 1) throw new ApiException('Select court time slots before renting hourly equipment.', 422);
        $lineTotal = round((float)$item['unit_price'] * $quantity * ($billingUnit === 'hour' ? $billedHours : 1), 2);
        $lines[] = [
            'itemId' => (int)$item['equipment_item_id'], 'categoryName' => (string)$item['category_name'],
            'itemName' => (string)$item['item_name'], 'billingUnit' => $billingUnit,
            'unitPrice' => (float)$item['unit_price'], 'quantity' => (int)$quantity,
            'billedHours' => $billedHours, 'lineTotal' => $lineTotal,
            'imageBinary' => $item['image_data'], 'imageMime' => $item['image_mime'],
        ];
    }
    return $lines;
}

function preferredSportsList(mixed $value): array
{
    if (is_array($value)) $sports = $value;
    else {
        $decoded = json_decode((string)$value, true);
        $sports = is_array($decoded) ? $decoded : explode(',', (string)$value);
    }
    return array_values(array_unique(array_filter(array_map(
        static fn($sport): string => trim((string)$sport),
        $sports,
    ))));
}

function refreshPresence(PDO $db, int $userId, ?string $clientId = null, bool $markOnline = false, ?string $sessionKey = null, bool $removeSession = false): bool
{
    $lockName = 'reserva_presence_' . $userId;
    $lock = $db->prepare('SELECT GET_LOCK(?, 5)');
    $lock->execute([$lockName]);
    if ((int)$lock->fetchColumn() !== 1) throw new ApiException('Presence status is busy. Please retry.', 503);

    try {
        $scope = 'user:' . $userId;
        $query = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'presence.sessions'");
        $query->execute([$scope]);
        $row = $query->fetch();
        $sessions = $row ? (json_decode((string)$row['state_value'], true) ?: []) : [];
        if (!is_array($sessions)) $sessions = [];

        $cutoff = time() - 90;
        foreach ($sessions as $id => $lastSeen) {
            if ($removeSession && $sessionKey !== null && is_array($lastSeen) && ($lastSeen['sessionKey'] ?? '') === $sessionKey) {
                unset($sessions[$id]);
                continue;
            }
            $timestamp = strtotime((string)(is_array($lastSeen) ? ($lastSeen['lastSeen'] ?? '') : $lastSeen));
            if (!$timestamp || $timestamp < $cutoff) unset($sessions[$id]);
        }
        if ($clientId !== null) {
            if ($markOnline) $sessions[$clientId] = ['lastSeen' => date(DATE_ATOM), 'sessionKey' => $sessionKey];
            else unset($sessions[$clientId]);
        }

        if ($row || $clientId !== null) {
            $save = $db->prepare(
                'INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP'
            );
            $save->execute([$scope, $userId, 'presence.sessions', json_encode($sessions, JSON_THROW_ON_ERROR)]);
        }
        $online = count($sessions) > 0;
        $db->prepare('UPDATE users SET online_status = ? WHERE user_id = ?')->execute([$online ? 'Online' : 'Offline', $userId]);
        return $online;
    } finally {
        $release = $db->prepare('SELECT RELEASE_LOCK(?)');
        $release->execute([$lockName]);
    }
}

function storeNotification(PDO $db, int $userId, string $title, string $message): int
{
    if ($userId < 1 || trim($title) === '' || trim($message) === '') return 0;
    $title = function_exists('mb_substr') ? mb_substr(trim($title), 0, 150) : substr(trim($title), 0, 150);
    $insert = $db->prepare('INSERT INTO notifications (user_id, title, message, is_read) VALUES (?, ?, ?, 0)');
    $insert->execute([$userId, $title, trim($message)]);
    return (int)$db->lastInsertId();
}

function storeRoleNotifications(PDO $db, string $role, string $title, string $message): void
{
    $query = $db->prepare("SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id WHERE r.role_name = ? AND u.account_status = 'Active'");
    $query->execute([$role]);
    foreach ($query->fetchAll(PDO::FETCH_COLUMN) as $userId) storeNotification($db, (int)$userId, $title, $message);
}

function readStateCollection(PDO $db, string $scope, string $key, bool $lock = false): array
{
    $query = $db->prepare('SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = ?' . ($lock ? ' FOR UPDATE' : ''));
    $query->execute([$scope, $key]);
    $row = $query->fetch();
    $values = $row ? json_decode((string)$row['state_value'], true) : [];
    return [$row['state_id'] ?? null, is_array($values) ? $values : []];
}

function writeStateCollection(PDO $db, string $scope, ?int $userId, string $key, array $values): void
{
    $save = $db->prepare(
        'INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP'
    );
    $save->execute([$scope, $userId, $key, json_encode($values, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
}

function findDisputeRecordById(PDO $db, string $disputeId, bool $forUpdate = false): ?array
{
    $rows = $db->query("SELECT state_id, scope_key, user_id, state_value FROM app_state WHERE state_key = 'disputes'" . ($forUpdate ? ' FOR UPDATE' : ''))->fetchAll();
    foreach ($rows as $row) {
        $disputes = json_decode((string)$row['state_value'], true);
        if (!is_array($disputes)) continue;
        foreach ($disputes as $index => $dispute) {
            if (is_array($dispute) && (string)($dispute['id'] ?? '') === $disputeId) {
                return [$row, $disputes, $index, $dispute];
            }
        }
    }
    return null;
}

function disputeEvidenceBySide(PDO $db, string $disputeId): array
{
    $query = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key LIKE 'evidence.%' ORDER BY state_id ASC");
    $query->execute(['dispute:' . $disputeId]);
    $evidence = ['user' => [], 'owner' => []];
    foreach ($query->fetchAll(PDO::FETCH_COLUMN) as $value) {
        $item = json_decode((string)$value, true);
        $side = is_array($item) ? (string)($item['side'] ?? '') : '';
        if (isset($evidence[$side])) $evidence[$side][] = $item;
    }
    return $evidence;
}

function disputeReservationSnapshot(PDO $db, int $reservationId): ?array
{
    $query = $db->prepare(
        'SELECT r.reservation_id AS id, r.user_id AS userId, u.full_name AS user,
                f.owner_id AS ownerId, owner_user.full_name AS ownerName, f.name AS facility, r.reservation_date AS date,
                r.start_time AS startTime, r.end_time AS endTime, r.total_amount AS storedCourtRate,
                r.status, r.completed_at AS completedAt
         FROM reservations r JOIN users u ON u.user_id = r.user_id
         LEFT JOIN facilities f ON f.facility_id = r.facility_id
         LEFT JOIN users owner_user ON owner_user.user_id = f.owner_id
         WHERE r.reservation_id = ? LIMIT 1'
    );
    $query->execute([$reservationId]);
    $reservation = $query->fetch();
    if (!$reservation) return null;

    $fees = reservationFeeSnapshot($db, $reservationId, (float)$reservation['storedCourtRate']);
    $paymentQuery = $db->prepare("SELECT COALESCE(SUM(CASE WHEN LOWER(payment_status) = 'paid' THEN amount ELSE 0 END), 0) AS paidAmount, (SELECT payment_status FROM payments WHERE reservation_id = ? ORDER BY payment_id DESC LIMIT 1) AS paymentStatus FROM payments WHERE reservation_id = ?");
    $paymentQuery->execute([$reservationId, $reservationId]);
    $payment = $paymentQuery->fetch() ?: [];
    $courtQuery = $db->prepare(
        'SELECT c.court_name AS name, COALESCE(rc.start_time, r.start_time) AS startTime,
                COALESCE(rc.end_time, r.end_time) AS endTime
         FROM reservation_courts rc JOIN reservations r ON r.reservation_id = rc.reservation_id
         JOIN courts c ON c.court_id = rc.court_id WHERE rc.reservation_id = ?
         ORDER BY CAST(SUBSTRING(c.court_number, 2) AS UNSIGNED), c.court_id'
    );
    $courtQuery->execute([$reservationId]);
    $courts = $courtQuery->fetchAll();
    return [
        'id' => $reservationId,
        'userId' => (int)$reservation['userId'],
        'user' => (string)$reservation['user'],
        'ownerId' => $reservation['ownerId'] === null ? null : (int)$reservation['ownerId'],
        'ownerName' => (string)($reservation['ownerName'] ?? 'Facility owner unavailable'),
        'name' => (string)($reservation['facility'] ?? 'Facility unavailable'),
        'date' => (string)$reservation['date'],
        'startTime' => (string)$reservation['startTime'],
        'endTime' => (string)$reservation['endTime'],
        'courtRate' => (float)$fees['courtRate'],
        'serviceFee' => (float)$fees['serviceFee'],
        'ownerCommission' => (float)$fees['ownerCommission'],
        'ownerNet' => (float)$fees['ownerNet'],
        'userTotal' => (float)$fees['userTotal'],
        'paymentStatus' => (string)($payment['paymentStatus'] ?? 'Not recorded'),
        'paidAmount' => round((float)($payment['paidAmount'] ?? 0), 2),
        'status' => (string)$reservation['status'],
        'completedAt' => $reservation['completedAt'],
        'courtSchedules' => $courts,
    ];
}

function listDisputesForViewer(PDO $db, array $viewer, bool $includeEvidence = false): array
{
    $rows = $db->query("SELECT scope_key, user_id, state_value FROM app_state WHERE state_key = 'disputes' ORDER BY updated_at DESC")->fetchAll();
    $result = [];
    foreach ($rows as $row) {
        $items = json_decode((string)$row['state_value'], true);
        if (!is_array($items)) continue;
        foreach ($items as $item) {
            if (!is_array($item)) continue;
            $reservationId = filter_var($item['reservationId'] ?? null, FILTER_VALIDATE_INT);
            if (!$reservationId) continue;
            $reservation = disputeReservationSnapshot($db, (int)$reservationId);
            if (!$reservation) continue;
            $viewerRole = (string)($viewer['role'] ?? '');
            $viewerId = (int)($viewer['id'] ?? 0);
            if (($viewerRole === 'User' && (int)($row['user_id'] ?? 0) !== $viewerId) ||
                ($viewerRole === 'Facility Owner' && (int)($reservation['ownerId'] ?? 0) !== $viewerId) ||
                !in_array($viewerRole, ['User', 'Facility Owner', 'Admin'], true)) continue;
            $item['userId'] = (int)($row['user_id'] ?? $item['userId'] ?? 0);
            $item['user'] = (string)($reservation['user'] ?? $item['user'] ?? 'Customer');
            $item['ownerId'] = (int)($reservation['ownerId'] ?? 0);
            $item['owner'] = (string)($reservation['ownerName'] ?? 'Facility owner unavailable');
            $item['facility'] = (string)$reservation['name'];
            $item['reservationSnapshot'] = $reservation;
            $item['ownerResponseStatus'] = !empty($item['ownerResponse']['submittedAt']) ? 'Owner responded' : 'Awaiting owner response';
            if ($includeEvidence) {
                $evidence = disputeEvidenceBySide($db, (string)($item['id'] ?? ''));
                $item['userEvidence'] = $evidence['user'];
                $item['ownerEvidence'] = $evidence['owner'];
            }
            $result[] = $item;
        }
    }
    usort($result, static fn(array $a, array $b): int => strcmp((string)($b['createdAt'] ?? ''), (string)($a['createdAt'] ?? '')));
    return $result;
}

function validateDisputeEvidenceImage(mixed $image): string
{
    if (!is_string($image) || strlen($image) > 650000 ||
        !preg_match('#\Adata:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)\z#', $image, $matches)) {
        throw new ApiException('Choose a valid PNG, JPEG, or WebP proof image.', 422);
    }
    $binary = base64_decode($matches[2], true);
    $details = $binary === false ? false : getimagesizefromstring($binary);
    $expectedMime = $matches[1] === 'jpeg' ? 'image/jpeg' : 'image/' . $matches[1];
    if ($binary === false || strlen($binary) > 450000 || !$details || ($details['mime'] ?? '') !== $expectedMime ||
        (int)$details[0] < 1 || (int)$details[1] < 1 || (int)$details[0] > 8000 || (int)$details[1] > 8000) {
        throw new ApiException('Each proof image must be a readable image smaller than 450 KB after compression.', 422);
    }
    return $image;
}

function recordedRefundTotal(PDO $db, int $reservationId): float
{
    $query = $db->query("SELECT scope_key, state_key, state_value FROM app_state WHERE state_key IN ('payments', 'owner.refunds') FOR UPDATE");
    $refunds = [];
    foreach ($query->fetchAll() as $row) {
        $items = json_decode((string)$row['state_value'], true);
        if (!is_array($items)) continue;
        foreach ($items as $index => $item) {
            if (!is_array($item) || (string)($item['reservationId'] ?? '') !== (string)$reservationId) continue;
            if ($row['state_key'] === 'payments' && ($item['type'] ?? '') !== 'refund') continue;
            if (in_array(strtolower((string)($item['status'] ?? 'pending')), ['failed', 'cancelled', 'canceled'], true)) continue;
            $amount = round((float)($item['totalRefunded'] ?? $item['amount'] ?? 0), 2);
            if ($amount <= 0) continue;
            $dedupeKey = (string)($item['refundId'] ?? $item['id'] ?? ($row['scope_key'] . ':' . $index));
            $refunds[$dedupeKey] = max($refunds[$dedupeKey] ?? 0, $amount);
        }
    }
    return round(array_sum($refunds), 2);
}

function migrateLegacyNotifications(PDO $db, int $userId): void
{
    $db->beginTransaction();
    try {
        $scope = 'user:' . $userId;
        $query = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'notifications' FOR UPDATE");
        $query->execute([$scope]);
        $row = $query->fetch();
        $legacy = $row ? json_decode((string)$row['state_value'], true) : null;
        if ($row && is_array($legacy)) {
            foreach (array_reverse($legacy) as $item) {
                if (!is_array($item)) continue;
                $title = trim((string)($item['title'] ?? ''));
                $message = trim((string)($item['message'] ?? ''));
                if ($title === '' || $message === '') continue;
                $timestamp = strtotime((string)($item['createdAt'] ?? $item['time'] ?? ''));
                $createdAt = $timestamp ? date('Y-m-d H:i:s', $timestamp) : date('Y-m-d H:i:s');
                $insert = $db->prepare('INSERT INTO notifications (user_id, title, message, is_read, created_at) VALUES (?, ?, ?, ?, ?)');
                $insert->execute([
                    $userId,
                    function_exists('mb_substr') ? mb_substr($title, 0, 150) : substr($title, 0, 150),
                    $message,
                    empty($item['unread']) ? 1 : 0,
                    $createdAt,
                ]);
            }
            $clear = $db->prepare('UPDATE app_state SET state_value = ? WHERE state_id = ?');
            $clear->execute(['[]', $row['state_id']]);
        }
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function notificationPayload(array $row): array
{
    $timestamp = strtotime((string)$row['created_at']) ?: time();
    return [
        'id' => (int)$row['notification_id'],
        'title' => (string)$row['title'],
        'message' => (string)$row['message'],
        'time' => date('M j, Y g:i A', $timestamp),
        'createdAt' => date(DATE_ATOM, $timestamp),
        'unread' => !(bool)$row['is_read'],
        'type' => 'info',
    ];
}

function reservationConflict(PDO $db, array $snapshot, int $userId): ?string
{
    $active = array_values(array_filter($snapshot, static fn($item): bool =>
        is_array($item) && in_array($item['status'] ?? '', ['Pending', 'Confirmed'], true) && ($item['source'] ?? '') !== 'database'
    ));
    $storedQuery = $db->prepare("SELECT user_id, state_value FROM app_state WHERE state_key = 'reservations'");
    $storedQuery->execute();
    $stored = [];
    foreach ($storedQuery->fetchAll() as $row) {
        if ((int)($row['user_id'] ?? 0) === $userId) continue;
        $items = json_decode($row['state_value'], true);
        if (is_array($items)) $stored = [...$stored, ...$items];
    }
    $sqlBookings = $db->query("SELECT r.facility_id AS facilityId, r.reservation_date AS date, r.start_time AS startTime, r.end_time AS endTime, COUNT(rc.court_id) AS quantity FROM reservations r LEFT JOIN reservation_courts rc ON rc.reservation_id = r.reservation_id WHERE r.status IN ('Pending', 'Confirmed') GROUP BY r.reservation_id")->fetchAll();
    foreach ($active as $booking) {
        $facilityId = (int)($booking['facilityId'] ?? 0);
        $date = (string)($booking['date'] ?? '');
        $start = substr((string)($booking['startTime'] ?? ''), 0, 5);
        $end = substr((string)($booking['endTime'] ?? ''), 0, 5);
        if (!$facilityId || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !preg_match('/^\d{2}:\d{2}$/', $start) || !preg_match('/^\d{2}:\d{2}$/', $end) || $date < date('Y-m-d') || $start < '08:00' || $end > '22:00' || $end <= $start) return 'Reservation details are invalid.';
        $courtsQuery = $db->prepare('SELECT COUNT(*) FROM courts WHERE facility_id = ? AND is_active = 1');
        $courtsQuery->execute([$facilityId]);
        $courtCount = (int)$courtsQuery->fetchColumn();
        $quantity = max(1, (int)($booking['quantity'] ?? 1));
        if (!$courtCount || $quantity > $courtCount) return 'The requested number of courts is unavailable.';
        $occupied = 0;
        foreach ([...$sqlBookings, ...$stored, ...$active] as $other) {
            if ((string)($other['id'] ?? '') === (string)($booking['id'] ?? '')) continue;
            if ((int)($other['facilityId'] ?? 0) !== $facilityId || (string)($other['date'] ?? '') !== $date || !in_array($other['status'] ?? 'Confirmed', ['Pending', 'Confirmed'], true)) continue;
            $otherStart = substr((string)($other['startTime'] ?? ''), 0, 5);
            $otherEnd = substr((string)($other['endTime'] ?? ''), 0, 5);
            if ($otherStart < $end && $otherEnd > $start) $occupied += max(1, (int)($other['quantity'] ?? 1));
        }
        if ($occupied + $quantity > $courtCount) return 'That time was just booked. Choose another available slot.';
        $unavailable = $db->prepare('SELECT COUNT(*) FROM court_unavailable_slots us JOIN courts c ON c.court_id = us.court_id WHERE c.facility_id = ? AND c.is_active = 1 AND us.slot_date = ? AND us.slot_time >= ? AND us.slot_time < ?');
        $unavailable->execute([$facilityId, $date, $start . ':00', $end . ':00']);
        if ((int)$unavailable->fetchColumn() > ($courtCount - $quantity) * max(1, (int)((strtotime($date . ' ' . $end) - strtotime($date . ' ' . $start)) / 3600))) return 'A selected court is blocked during that time.';
    }
    return null;
}

function bookingFeeSnapshot(PDO $db, float $courtRate, ?array $promo = null): array
{
    $query = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = 'global' AND state_key = 'platform.fees'");
    $query->execute();
    $settings = json_decode((string)($query->fetchColumn() ?: '{}'), true) ?: [];
    $fees = $settings['fees'] ?? [];
    $originalCourtRate = round($courtRate, 2);
    $baseServiceFee = round(max($originalCourtRate * (float)($fees['userServiceRate'] ?? 0.05), (float)($fees['userServiceMin'] ?? 20)), 2);
    $discountType = (string)($promo['discountType'] ?? '');
    $discountValue = (float)($promo['value'] ?? 0);
    $rentalDiscount = match ($discountType) {
        'percent' => round($originalCourtRate * min(100, max(0, $discountValue)) / 100, 2),
        'fixed' => round(min($originalCourtRate, max(0, $discountValue)), 2),
        default => 0.0,
    };
    $discountedCourtRate = round(max(0, $originalCourtRate - $rentalDiscount), 2);
    $serviceFee = $discountType === 'fee-waived'
        ? 0.0
        : round(max($discountedCourtRate * (float)($fees['userServiceRate'] ?? 0.05), (float)($fees['userServiceMin'] ?? 20)), 2);
    $serviceFeeDiscount = round(max(0, $baseServiceFee - $serviceFee), 2);
    $promoDiscount = $promo ? round($rentalDiscount + $serviceFeeDiscount, 2) : 0.0;
    $ownerCommission = round($discountedCourtRate * (float)($fees['ownerCommissionRate'] ?? 0.08), 2);
    return [
        'courtRate' => $discountedCourtRate,
        'originalCourtRate' => $originalCourtRate,
        'promoDiscount' => $promoDiscount,
        'promoRentalDiscount' => $rentalDiscount,
        'promoServiceFeeDiscount' => $serviceFeeDiscount,
        'serviceFee' => $serviceFee,
        'userTotal' => round($discountedCourtRate + $serviceFee, 2),
        'ownerCommission' => $ownerCommission,
        'ownerNet' => round($discountedCourtRate - $ownerCommission, 2),
    ];
}

function readPromoCodes(PDO $db, bool $forUpdate = false): array
{
    $query = $db->prepare(
        'SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = ? LIMIT 1' .
        ($forUpdate ? ' FOR UPDATE' : '')
    );
    $query->execute(['global', 'promo.codes']);
    $row = $query->fetch();
    $codes = $row ? json_decode((string)$row['state_value'], true) : [];
    return [$row ? (int)$row['state_id'] : null, is_array($codes) ? array_values($codes) : []];
}

function savePromoCodes(PDO $db, ?int $stateId, array $codes): void
{
    $value = json_encode(array_values($codes), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    if ($stateId) {
        $save = $db->prepare('UPDATE app_state SET state_value = ?, updated_at = CURRENT_TIMESTAMP WHERE state_id = ?');
        $save->execute([$value, $stateId]);
        return;
    }
    $save = $db->prepare(
        'INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP'
    );
    $save->execute(['global', 'promo.codes', $value]);
}

function findPromoCode(array $codes, string $code): ?array
{
    foreach ($codes as $promo) {
        if (is_array($promo) && strtoupper((string)($promo['code'] ?? '')) === strtoupper($code)) return $promo;
    }
    return null;
}

function validatePromoCode(PDO $db, string $code, float $bookingAmount, bool $forUpdate = false): array
{
    [$stateId, $codes] = readPromoCodes($db, $forUpdate);
    $promo = findPromoCode($codes, $code);
    if (!$promo || empty($promo['active'])) throw new ApiException('This promo code is invalid or inactive.', 404);
    $usageLimit = (int)($promo['usageLimit'] ?? 0);
    if ($usageLimit > 0 && (int)($promo['usedCount'] ?? 0) >= $usageLimit) {
        throw new ApiException('This promo code has reached its usage limit.', 409);
    }
    if ($bookingAmount + 0.01 < (float)($promo['minimumBooking'] ?? 0)) {
        throw new ApiException('This promo code requires a minimum rental booking of ₱' . number_format((float)$promo['minimumBooking'], 2) . '.', 422);
    }
    return [$stateId, $codes, $promo];
}

function checkoutAmounts(array $fees, string $option): array
{
    $courtRate = round((float)$fees['courtRate'], 2);
    $serviceFee = round((float)$fees['serviceFee'], 2);
    $total = round((float)$fees['userTotal'], 2);
    if ($option === 'full') return ['option' => 'full', 'amountToPayNow' => $total, 'remainingBalance' => 0.0];
    if ($option !== 'half') throw new ApiException('Choose full payment or a 50% downpayment.', 422);
    $firstRentalPayment = round($courtRate * 0.5, 2);
    $amountToPayNow = round($firstRentalPayment + $serviceFee, 2);
    return [
        'option' => 'half',
        'amountToPayNow' => $amountToPayNow,
        'remainingBalance' => round($total - $amountToPayNow, 2),
    ];
}

function reservationPaymentMetadata(PDO $db, int $reservationId): array
{
    $query = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = 'reservation.payment' LIMIT 1");
    $query->execute(['reservation:' . $reservationId]);
    $value = json_decode((string)($query->fetchColumn() ?: ''), true);
    return is_array($value) ? $value : [];
}

function reservationFeeSnapshot(PDO $db, int $reservationId, float $courtRate): array
{
    $fees = bookingFeeSnapshot($db, $courtRate);
    $snapshot = reservationPaymentMetadata($db, $reservationId)['fees'] ?? null;
    if (!is_array($snapshot)) return $fees;
    foreach (['courtRate', 'serviceFee', 'userTotal', 'ownerCommission', 'ownerNet'] as $key) {
        if (isset($snapshot[$key]) && is_numeric($snapshot[$key])) $fees[$key] = round((float)$snapshot[$key], 2);
    }
    return $fees;
}

function calculateReservationCancellation(array $reservation, array $fees, array $policy, float $paidAmount, string $cancelledBy = 'user'): array
{
    $courtRate = round((float)$fees['courtRate'], 2);
    $serviceFee = round((float)$fees['serviceFee'], 2);
    $paid = round(max(0, $paidAmount), 2);
    $courtRefund = 0.0;
    $serviceFeeRefund = 0.0;
    $reason = '';
    $facilityOrPlatformCancellation = in_array($cancelledBy, ['owner', 'system', 'admin'], true);
    if ($facilityOrPlatformCancellation) {
        $courtRefund = $courtRate;
        $serviceFeeRefund = $serviceFee;
        $reason = 'The reservation was cancelled by the facility or platform.';
    } elseif ($cancelledBy === 'no-show') {
        $rate = min(1, max(0, (float)($policy['noShowRefundRate'] ?? 0)));
        $courtRefund = round($courtRate * $rate, 2);
        $reason = $courtRefund > 0 ? 'A partial refund applies under the saved no-show policy.' : 'No refund is due under the saved no-show policy.';
    } else {
        $start = new DateTimeImmutable((string)$reservation['reservation_date'] . ' ' . (string)$reservation['start_time']);
        $hoursBefore = ($start->getTimestamp() - time()) / 3600;
        $freeHours = max(0, (float)($policy['freeCancelHours'] ?? 24));
        if ($hoursBefore >= $freeHours) {
            $courtRefund = $courtRate;
            $reason = 'Cancelled within the free-cancellation period in the policy saved with this booking.';
        } else {
            $rate = min(1, max(0, (float)($policy['lateCancelRefundRate'] ?? 0.5)));
            $courtRefund = round($courtRate * $rate, 2);
            $reason = 'A partial rental refund applies under the late-cancellation policy saved with this booking.';
        }
    }
    if (!$facilityOrPlatformCancellation) {
        // The complete service fee is collected with the first payment. Customer
        // refunds can therefore only return rental money that was actually paid.
        $courtRefund = min($courtRefund, max(0, $paid - $serviceFee));
    }
    $requestedRefund = round($courtRefund + $serviceFeeRefund, 2);
    $totalRefunded = min($requestedRefund, $paid);
    $courtRefund = min($courtRefund, $totalRefunded);
    $serviceFeeRefund = round(max(0, $totalRefunded - $courtRefund), 2);
    return [
        'courtRate' => $courtRate,
        'serviceFee' => $serviceFee,
        'userTotal' => (float)$fees['userTotal'],
        'courtRateRefund' => $courtRefund,
        'serviceFeeRefund' => $serviceFeeRefund,
        'serviceFeeNonRefundable' => round(max(0, $serviceFee - $serviceFeeRefund), 2),
        'totalRefunded' => $totalRefunded,
        'total' => $totalRefunded,
        'retainedAmount' => round(max(0, $paid - $totalRefunded), 2),
        'retainedDeposit' => round(max(0, $paid - $totalRefunded), 2),
        'reason' => $reason,
        'refundStatus' => $totalRefunded > 0 ? 'Pending processing' : 'No refund due',
    ];
}

function normalizePaymentMobile(mixed $value): string
{
    if (!is_string($value)) throw new ApiException('Enter a valid GCash or Maya mobile number.', 422);
    $digits = preg_replace('/\D+/', '', trim($value)) ?? '';
    if (str_starts_with($digits, '63') && strlen($digits) === 12) $digits = '0' . substr($digits, 2);
    if (!preg_match('/^09\d{9}$/D', $digits)) throw new ApiException('Enter a valid Philippine mobile number, such as 09XXXXXXXXX.', 422);
    return $digits;
}

function validReceiptImage(mixed $value): bool
{
    if (!is_string($value) || strlen($value) > 700000 ||
        !preg_match('#\Adata:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)\z#', $value, $matches)) return false;
    $binary = base64_decode($matches[2], true);
    if ($binary === false || strlen($binary) > 520000) return false;
    $details = @getimagesizefromstring($binary);
    $expectedMime = $matches[1] === 'jpeg' ? 'image/jpeg' : 'image/' . $matches[1];
    return is_array($details) && ($details['mime'] ?? '') === $expectedMime &&
        (int)($details[0] ?? 0) > 0 && (int)($details[1] ?? 0) > 0 &&
        (int)$details[0] <= 10000 && (int)$details[1] <= 10000;
}

function paymentDataKey(array $config): string
{
    $configuredKey = trim((string)($config['payment_data_key'] ?? ''));
    if (strlen($configuredKey) < 32) throw new ApiException('Saved payment methods are unavailable until the backend PAYMENT_DATA_KEY is configured.', 503);
    return hash('sha256', $configuredKey, true);
}

function encryptPaymentMobile(string $mobile, array $config): string
{
    $iv = random_bytes(12);
    $tag = '';
    $ciphertext = openssl_encrypt($mobile, 'aes-256-gcm', paymentDataKey($config), OPENSSL_RAW_DATA, $iv, $tag, 'reserva-user-payment-method', 16);
    if (!is_string($ciphertext)) throw new RuntimeException('The payment account number could not be encrypted.');
    return base64_encode($iv . $tag . $ciphertext);
}

function decryptPaymentMobile(string $encrypted, array $config): string
{
    $bytes = base64_decode($encrypted, true);
    if (!is_string($bytes) || strlen($bytes) < 29) throw new RuntimeException('The saved payment account could not be decrypted.');
    $mobile = openssl_decrypt(substr($bytes, 28), 'aes-256-gcm', paymentDataKey($config), OPENSSL_RAW_DATA, substr($bytes, 0, 12), substr($bytes, 12, 16), 'reserva-user-payment-method');
    if (!is_string($mobile)) throw new RuntimeException('The saved payment account could not be decrypted.');
    return $mobile;
}

function paymentMobileFingerprint(string $methodType, string $mobile, array $config): string
{
    return hash_hmac('sha256', $methodType . ':' . $mobile, paymentDataKey($config));
}

function paymongoSecretKey(array $config): string
{
    $key = trim((string)($config['payments']['paymongo_secret_key'] ?? ''));
    if (!preg_match('/^sk_(?:test|live)_[A-Za-z0-9]+$/', $key)) {
        throw new ApiException('Secure card checkout is not configured. Add PAYMONGO_SECRET_KEY to the backend .env file.', 503);
    }
    return $key;
}

function requirePaymongoCheckoutConfig(array $config): void
{
    paymongoSecretKey($config);
    if (trim((string)($config['payments']['paymongo_webhook_secret'] ?? '')) === '') {
        throw new ApiException('Secure card checkout is not ready. Configure PAYMONGO_WEBHOOK_SECRET and register the payment webhook first.', 503);
    }
    if (!function_exists('curl_init')) throw new ApiException('Secure card checkout is unavailable because the PHP cURL extension is missing.', 503);
}

function paymongoRequest(array $config, string $method, string $path, ?array $payload = null, string $idempotencyKey = ''): array
{
    $key = paymongoSecretKey($config);
    if (!function_exists('curl_init')) throw new ApiException('Secure card checkout is unavailable because the PHP cURL extension is missing.', 503);
    $headers = ['Authorization: Basic ' . base64_encode($key . ':'), 'Content-Type: application/json', 'Accept: application/json'];
    if ($idempotencyKey !== '') $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
    $url = 'https://api.paymongo.com' . $path;
    $curl = curl_init($url);
    if ($curl === false) throw new ApiException('Secure card checkout is unavailable because the PHP cURL extension is missing.', 503);
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_POSTFIELDS => $payload === null ? null : json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    ]);
    $responseBody = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($curl);
    curl_close($curl);
    if (!is_string($responseBody) || $status < 200 || $status >= 300) {
        error_log('PayMongo request failed: HTTP ' . $status . ($curlError !== '' ? ' ' . $curlError : '') . ' ' . substr((string)$responseBody, 0, 1000));
        throw new ApiException('PayMongo could not start or verify the card checkout. Please try again.', 502);
    }
    $decoded = json_decode($responseBody, true);
    if (!is_array($decoded)) throw new ApiException('PayMongo returned an unreadable checkout response.', 502);
    return $decoded;
}

function verifyPaymongoWebhook(string $rawBody, string $signatureHeader, string $secret, bool $liveMode): bool
{
    $parts = [];
    foreach (explode(',', $signatureHeader) as $part) {
        $pair = explode('=', trim($part), 2);
        if (count($pair) === 2) $parts[$pair[0]] = $pair[1];
    }
    $timestamp = (string)($parts['t'] ?? '');
    $signature = (string)($parts[$liveMode ? 'li' : 'te'] ?? '');
    if (!ctype_digit($timestamp) || $signature === '') return false;
    return hash_equals(hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret), $signature);
}

function applyPaymongoCheckoutPaid(PDO $db, array $session): void
{
    $sessionId = trim((string)($session['id'] ?? ''));
    $attributes = $session['attributes'] ?? [];
    $metadata = $attributes['metadata'] ?? [];
    $paymentId = filter_var($metadata['payment_id'] ?? null, FILTER_VALIDATE_INT);
    $reservationId = filter_var($metadata['reservation_id'] ?? null, FILTER_VALIDATE_INT);
    if ($sessionId === '' || !$paymentId || !$reservationId) throw new ApiException('Payment session metadata is invalid.', 422);

    $paidPayment = null;
    foreach (($attributes['payments'] ?? []) as $attempt) {
        if (($attempt['attributes']['status'] ?? '') === 'paid') { $paidPayment = $attempt; break; }
    }
    if (!$paidPayment) throw new ApiException('The provider event does not contain a paid card transaction.', 422);
    $providerPaymentId = trim((string)($paidPayment['id'] ?? ''));
    $paidAttributes = $paidPayment['attributes'] ?? [];
    $intentAmount = $attributes['payment_intent']['attributes']['amount'] ?? null;
    $reportedAmount = is_numeric($intentAmount) ? (int)$intentAmount : (int)($paidAttributes['amount'] ?? -1);
    if ($providerPaymentId === '' || strtoupper((string)($paidAttributes['currency'] ?? '')) !== 'PHP') {
        throw new ApiException('The provider payment details are invalid.', 422);
    }

    $db->beginTransaction();
    try {
        $sessionState = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = 'payment.card.checkout' FOR UPDATE");
        $sessionState->execute(['payment:' . (int)$paymentId]);
        $storedSession = json_decode((string)($sessionState->fetchColumn() ?: 'null'), true);
        if (!is_array($storedSession) || !hash_equals((string)($storedSession['checkoutSessionId'] ?? ''), $sessionId)) {
            throw new ApiException('The payment session does not match this reservation.', 409);
        }

        $query = $db->prepare(
            "SELECT p.payment_id, p.reservation_id, p.amount, p.payment_status, r.status AS reservation_status,
                    r.user_id, r.facility_id, u.full_name, f.name AS facility_name, f.owner_id
             FROM payments p JOIN reservations r ON r.reservation_id = p.reservation_id
             JOIN users u ON u.user_id = r.user_id JOIN facilities f ON f.facility_id = r.facility_id
             WHERE p.payment_id = ? AND p.reservation_id = ? AND p.method_id = (SELECT method_id FROM payment_methods WHERE method_name = 'Card' LIMIT 1)
             FOR UPDATE"
        );
        $query->execute([(int)$paymentId, (int)$reservationId]);
        $record = $query->fetch();
        if (!$record) throw new ApiException('The reservation payment record was not found.', 404);
        if ((int)round((float)$record['amount'] * 100) !== $reportedAmount) throw new ApiException('The provider payment amount does not match the reservation.', 409);

        if ($record['payment_status'] !== 'paid') {
            $update = $db->prepare("UPDATE payments SET payment_status = 'paid', paid_at = COALESCE(paid_at, NOW()), transaction_reference = ? WHERE payment_id = ? AND payment_status = 'pending'");
            $update->execute([$providerPaymentId, (int)$paymentId]);
            if ($record['reservation_status'] === 'Pending payment') {
                $db->prepare("UPDATE reservations SET status = 'Pending' WHERE reservation_id = ? AND status = 'Pending payment'")->execute([(int)$reservationId]);
            }
            updatePaymentLedgerStatus($db, (int)$paymentId, 'Paid', $providerPaymentId);

            $ownerScope = 'user:' . (int)$record['owner_id'];
            $earningsQuery = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = 'owner.earnings' FOR UPDATE");
            $earningsQuery->execute([$ownerScope]);
            $earnings = json_decode((string)($earningsQuery->fetchColumn() ?: '[]'), true) ?: [];
            $earningsChanged = false;
            foreach ($earnings as &$earning) {
                if (is_array($earning) && (string)($earning['reservationId'] ?? '') === (string)$reservationId) {
                    $earning['reservationStatus'] = 'Pending';
                    $earning['paymentStatus'] = 'paid';
                    $earningsChanged = true;
                }
            }
            unset($earning);
            if ($earningsChanged) {
                $saveEarnings = $db->prepare("UPDATE app_state SET state_value = ?, updated_at = CURRENT_TIMESTAMP WHERE scope_key = ? AND state_key = 'owner.earnings'");
                $saveEarnings->execute([json_encode($earnings, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $ownerScope]);
            }

            storeNotification($db, (int)$record['user_id'], 'Card payment received', 'Your card payment for ' . $record['facility_name'] . ' was verified. The facility is reviewing your reservation request.');
            if (!empty($record['owner_id'])) storeNotification($db, (int)$record['owner_id'], 'Paid reservation request', $record['full_name'] . ' paid for a reservation at ' . $record['facility_name'] . '. Please review the request.');
            storeRoleNotifications($db, 'Admin', 'Card payment received', $record['full_name'] . ' paid for a reservation at ' . $record['facility_name'] . '.');
        }
        $db->commit();
    } catch (Throwable $error) {
        if ($db->inTransaction()) $db->rollBack();
        throw $error;
    }
}

function writeFinancialLedgerEntry(PDO $db, array $entry): void
{
    $query = $db->prepare(
        'INSERT INTO financial_ledger_entries
           (idempotency_key, entry_type, reservation_id, payment_id, user_id, owner_id, amount, status, external_reference, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE idempotency_key = VALUES(idempotency_key)'
    );
    $metadata = $entry['metadata'] ?? null;
    $query->execute([
        (string)$entry['idempotencyKey'],
        (string)$entry['type'],
        $entry['reservationId'] ?? null,
        $entry['paymentId'] ?? null,
        $entry['userId'] ?? null,
        $entry['ownerId'] ?? null,
        round((float)$entry['amount'], 2),
        (string)$entry['status'],
        $entry['reference'] ?? null,
        $metadata === null ? null : json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    ]);
}

function updatePaymentLedgerStatus(PDO $db, int $paymentId, string $status, ?string $reference = null): void
{
    $update = $db->prepare("UPDATE financial_ledger_entries SET status = ?, external_reference = COALESCE(?, external_reference) WHERE payment_id = ? AND entry_type IN ('customer_payment', 'platform_service_fee')");
    $update->execute([$status, $reference, $paymentId]);
}

function reservationCreateResult(PDO $db, int $reservationId, int $userId, string $requestId, string $message): ?array
{
        $query = $db->prepare(
        'SELECT r.reservation_id, r.user_id, r.facility_id, r.reservation_date, r.start_time, r.end_time,
                r.status, r.total_amount, r.created_at, r.completed_at, u.full_name, u.email, f.owner_id, f.name,
                (SELECT p.amount FROM payments p WHERE p.reservation_id = r.reservation_id ORDER BY p.payment_id ASC LIMIT 1) AS deposit_amount,
                (SELECT p.payment_id FROM payments p WHERE p.reservation_id = r.reservation_id ORDER BY p.payment_id ASC LIMIT 1) AS payment_id,
                (SELECT p.payment_status FROM payments p WHERE p.reservation_id = r.reservation_id ORDER BY p.payment_id ASC LIMIT 1) AS payment_status,
                (SELECT p.payment_type FROM payments p WHERE p.reservation_id = r.reservation_id ORDER BY p.payment_id ASC LIMIT 1) AS payment_type,
                (SELECT pm.method_name FROM payments p LEFT JOIN payment_methods pm ON pm.method_id = p.method_id WHERE p.reservation_id = r.reservation_id ORDER BY p.payment_id ASC LIMIT 1) AS payment_method,
                (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.reservation_id = r.reservation_id AND p.payment_status = \'paid\') AS paid_amount,
                (SELECT COUNT(*) FROM reservation_courts rc WHERE rc.reservation_id = r.reservation_id) AS court_count
         FROM reservations r
         JOIN users u ON u.user_id = r.user_id
         LEFT JOIN facilities f ON f.facility_id = r.facility_id
         WHERE r.reservation_id = ? AND r.user_id = ?
         LIMIT 1'
    );
    $query->execute([$reservationId, $userId]);
    $row = $query->fetch();
    if (!$row) return null;

    $startTime = substr((string)$row['start_time'], 0, 5);
    $endTime = substr((string)$row['end_time'], 0, 5);
    $courtRate = (float)$row['total_amount'];
    $paymentMetadata = reservationPaymentMetadata($db, $reservationId);
    $fees = reservationFeeSnapshot($db, $reservationId, $courtRate);
    $userTotal = (float)$fees['userTotal'];
    $duration = max(1, (strtotime((string)$row['end_time']) - strtotime((string)$row['start_time'])) / 3600);
    $courtSchedulesQuery = $db->prepare(
        'SELECT rc.court_id, c.court_number, c.court_name,
                COALESCE(rc.start_time, r.start_time) AS start_time,
                COALESCE(rc.end_time, r.end_time) AS end_time,
                rc.hourly_rate
         FROM reservation_courts rc
         JOIN reservations r ON r.reservation_id = rc.reservation_id
         JOIN courts c ON c.court_id = rc.court_id
         WHERE rc.reservation_id = ?
         ORDER BY CAST(SUBSTRING(c.court_number, 2) AS UNSIGNED), c.court_id'
    );
    $courtSchedulesQuery->execute([$reservationId]);
    $courtSchedules = array_map(static function (array $court) use ($courtRate, $row): array {
        $courtStart = substr((string)$court['start_time'], 0, 5);
        $courtEnd = substr((string)$court['end_time'], 0, 5);
        $courtDuration = max(1, (strtotime($courtEnd) - strtotime($courtStart)) / 3600);
        $courtCount = max(1, (int)$row['court_count']);
        $hourlyRate = $court['hourly_rate'] === null
            ? round($courtRate / ($courtCount * $courtDuration), 2)
            : (float)$court['hourly_rate'];
        return [
            'courtId' => (int)$court['court_id'],
            'courtNumber' => (int)preg_replace('/\D+/', '', (string)$court['court_number']),
            'courtName' => $court['court_name'],
            'startTime' => $courtStart,
            'endTime' => $courtEnd,
            'duration' => $courtDuration,
            'hourlyRate' => $hourlyRate,
            'courtRate' => round($hourlyRate * $courtDuration, 2),
        ];
    }, $courtSchedulesQuery->fetchAll());
    $equipmentLines = reservationEquipmentLines($db, $reservationId);
    $courtCharges = round(array_sum(array_map(static fn(array $court): float => (float)$court['courtRate'], $courtSchedules)), 2);
    $equipmentTotal = round(array_sum(array_column($equipmentLines, 'lineTotal')), 2);
    $reservation = [
        'id' => (int)$row['reservation_id'],
        'source' => 'database',
        'userId' => (int)$row['user_id'],
        'user' => $row['full_name'],
        'email' => $row['email'],
        'facilityId' => (int)$row['facility_id'],
        'ownerId' => $row['owner_id'] === null ? null : (int)$row['owner_id'],
        'name' => $row['name'],
        'date' => (string)$row['reservation_date'],
        'time' => $startTime . ' - ' . $endTime,
        'startTime' => $startTime,
        'endTime' => $endTime,
        'duration' => $duration,
        'quantity' => max(1, (int)$row['court_count']),
        'courtIds' => array_column($courtSchedules, 'courtId'),
        'courtNames' => array_column($courtSchedules, 'courtName'),
        'courtSchedules' => $courtSchedules,
        'courtCharges' => (float)($paymentMetadata['courtCharges'] ?? $courtCharges),
        'equipmentItems' => $equipmentLines,
        'equipmentTotal' => (float)($paymentMetadata['equipmentTotal'] ?? $equipmentTotal),
        'status' => $row['status'],
        ...$fees,
        'userTotal' => $userTotal,
        'total' => $userTotal,
        'paymentMethod' => $row['payment_method'],
        'paymentStatus' => $row['payment_status'] ?? 'pending',
        'depositAmount' => (float)($row['deposit_amount'] ?? 0),
        'initialPaymentAmount' => (float)($row['deposit_amount'] ?? 0),
        'paymentType' => $row['payment_type'] ?? 'legacy',
        'paymentOption' => $paymentMetadata['paymentOption'] ?? 'full',
        'balanceSettlement' => $paymentMetadata['balanceSettlement'] ?? null,
        'paidAmount' => (float)($row['paid_amount'] ?? 0),
        'balanceDue' => max(0, round((float)($paymentMetadata['remainingBalance'] ?? ($userTotal - (float)($row['paid_amount'] ?? 0))), 2)),
        'paymentId' => $row['payment_id'] === null ? null : (int)$row['payment_id'],
        'hasPaymentProof' => true,
        'createdAt' => $row['created_at'],
        'completedAt' => $row['completed_at'],
        'refundedAmount' => 0,
        'refunds' => [],
        'requestId' => $requestId,
    ];
    return [
        'success' => true,
        'message' => $message,
        'reservation_id' => (int)$row['reservation_id'],
        'status' => $row['status'],
        'request_id' => $requestId,
        'reservation' => $reservation,
    ];
}

function createReservationRecord(PDO $db, array $body, array $user, array $config): array
{
    if ($user['role'] !== 'User') throw new ApiException('Only players can submit facility reservations.', 403);

    $requestId = trim((string)($body['requestId'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_-]{16,80}$/', $requestId)) {
        throw new ApiException('Reservation request identifier is missing or invalid. Please return to the schedule and try again.', 422);
    }
    $facilityId = filter_var($body['facilityId'] ?? null, FILTER_VALIDATE_INT);
    $date = trim((string)($body['date'] ?? ''));
    $startTime = trim((string)($body['startTime'] ?? ''));
    $endTime = trim((string)($body['endTime'] ?? ''));
    $duration = filter_var($body['duration'] ?? null, FILTER_VALIDATE_INT);
    $quantity = filter_var($body['quantity'] ?? 1, FILTER_VALIDATE_INT);
    $requestedCourtIds = $body['courtIds'] ?? [];
    $courtBookingsInput = $body['courtBookings'] ?? null;
    $equipmentSelections = $body['equipmentItems'] ?? [];
    $paymentMethod = trim((string)($body['paymentMethod'] ?? ''));
    $paymentOption = trim((string)($body['paymentOption'] ?? 'full'));
    $balanceSettlement = trim((string)($body['balanceSettlement'] ?? ''));
    $savedPaymentMethodId = filter_var($body['savedPaymentMethodId'] ?? null, FILTER_VALIDATE_INT);
    $paymentAccountName = trim((string)($body['paymentAccountName'] ?? ''));
    $paymentMobileRaw = $body['paymentMobile'] ?? '';
    $submittedTotal = is_numeric($body['totalAmount'] ?? null) ? (float)$body['totalAmount'] : -1;
    $submittedPayNow = is_numeric($body['amountToPayNow'] ?? null) ? (float)$body['amountToPayNow'] : null;
    $paymentProof = $body['paymentProof'] ?? null;
    $paymentReference = trim((string)($body['paymentReference'] ?? ''));
    $promoCode = strtoupper(trim((string)($body['promoCode'] ?? '')));
    $isCardPayment = $paymentMethod === 'Card';
    $proofIsValid = $isCardPayment || validReceiptImage($paymentProof);
    if ($isCardPayment) requirePaymongoCheckoutConfig($config);
    if (!$facilityId || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) ||
        !preg_match('/^(?:[01]\d|2[0-3]):00$/', $startTime) ||
        !preg_match('/^(?:[01]\d|2[0-3]):00$/', $endTime) ||
        !$duration || $duration < 1 || !$quantity || $quantity < 1 ||
        !in_array($paymentMethod, ['GCash', 'Maya', 'Card'], true) || $submittedTotal <= 0 ||
        !in_array($paymentOption, ['full', 'half'], true) ||
        !is_array($requestedCourtIds) || count($requestedCourtIds) !== (int)$quantity || !is_array($equipmentSelections) || !$proofIsValid ||
        strlen($paymentReference) > 100) {
        throw new ApiException('Choose a valid facility, date, time range, courts, payment method, and upload payment proof.', 422);
    }
    if ($paymentOption === 'half' && !in_array($balanceSettlement, ['cash-checkin', 'online-checkin'], true)) {
        throw new ApiException('Choose how the remaining balance will be settled at check-in.', 422);
    }
    if ($paymentOption === 'full') $balanceSettlement = '';
    if ($isCardPayment && $savedPaymentMethodId) throw new ApiException('Card details are entered securely on PayMongo checkout and cannot be stored in RESERVA.', 422);
    $paymentMobile = null;
    if (in_array($paymentMethod, ['GCash', 'Maya'], true) && !$savedPaymentMethodId) {
        if ($paymentAccountName === '' || strlen($paymentAccountName) > 150) throw new ApiException('Enter the name registered to your GCash or Maya account.', 422);
        $paymentMobile = normalizePaymentMobile($paymentMobileRaw);
    }
    if ($savedPaymentMethodId && !in_array($paymentMethod, ['GCash', 'Maya'], true)) {
        throw new ApiException('The saved payment account does not match the selected method.', 422);
    }
    $requestedCourtIds = array_values(array_unique(array_filter(array_map('intval', $requestedCourtIds), static fn(int $id): bool => $id > 0)));
    if (count($requestedCourtIds) !== (int)$quantity) throw new ApiException('Select a different court for each requested court.', 422);

    $courtBookings = [];
    if (is_array($courtBookingsInput)) {
        if (count($courtBookingsInput) !== (int)$quantity) throw new ApiException('Add one schedule for each selected court.', 422);
        foreach ($courtBookingsInput as $booking) {
            if (!is_array($booking)) throw new ApiException('A court schedule is invalid.', 422);
            $courtId = filter_var($booking['courtId'] ?? null, FILTER_VALIDATE_INT);
            $courtStart = trim((string)($booking['startTime'] ?? ''));
            $courtEnd = trim((string)($booking['endTime'] ?? ''));
            $courtDuration = filter_var($booking['duration'] ?? null, FILTER_VALIDATE_INT);
            if (!$courtId || !preg_match('/^(?:[01]\d|2[0-3]):00$/', $courtStart) ||
                !preg_match('/^(?:[01]\d|2[0-3]):00$/', $courtEnd) || !$courtDuration || $courtDuration < 1) {
                throw new ApiException('Each court needs a valid hourly time range.', 422);
            }
            $courtStartMinutes = (int)substr($courtStart, 0, 2) * 60;
            $courtEndMinutes = (int)substr($courtEnd, 0, 2) * 60;
            if ($courtStartMinutes < 480 || $courtEndMinutes > 1320 || $courtEndMinutes - $courtStartMinutes !== $courtDuration * 60) {
                throw new ApiException('A court schedule is invalid or outside facility hours.', 422);
            }
            $courtBookings[] = [
                'courtId' => (int)$courtId,
                'startTime' => $courtStart,
                'endTime' => $courtEnd,
                'duration' => (int)$courtDuration,
            ];
        }
        $scheduleCourtIds = array_column($courtBookings, 'courtId');
        if (count(array_unique($scheduleCourtIds)) !== (int)$quantity ||
            count(array_diff($requestedCourtIds, $scheduleCourtIds)) !== 0 ||
            count(array_diff($scheduleCourtIds, $requestedCourtIds)) !== 0) {
            throw new ApiException('Assign one independent schedule to each selected court.', 422);
        }
        $expectedStart = min(array_column($courtBookings, 'startTime'));
        $expectedEnd = max(array_column($courtBookings, 'endTime'));
        if ($startTime !== $expectedStart || $endTime !== $expectedEnd) {
            throw new ApiException('The reservation summary does not match the selected court schedules.', 422);
        }
    } else {
        foreach ($requestedCourtIds as $courtId) {
            $courtBookings[] = ['courtId' => $courtId, 'startTime' => $startTime, 'endTime' => $endTime, 'duration' => (int)$duration];
        }
    }

    $fingerprintValues = [
        (int)$facilityId, $date, $startTime, $endTime, (int)$duration, (int)$quantity,
        $paymentMethod, $paymentOption, $balanceSettlement, (int)($savedPaymentMethodId ?: 0),
        $paymentAccountName, $paymentMobile, round($submittedTotal, 2), $requestedCourtIds, $courtBookings, $equipmentSelections,
    ];
    if ($promoCode !== '') $fingerprintValues[] = $promoCode;
    $fingerprint = hash('sha256', json_encode($fingerprintValues, JSON_THROW_ON_ERROR));
    $lock = $db->prepare("SELECT GET_LOCK('reserva_reservations', 8)");
    $lock->execute();
    if ((int)$lock->fetchColumn() !== 1) throw new ApiException('Booking service is busy. Please retry in a moment.', 503);

    try {
        $db->beginTransaction();
        try {
            $userId = (int)$user['id'];
            $scope = 'user:' . $userId;
            $requestStateQuery = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'reservation.requests' FOR UPDATE");
            $requestStateQuery->execute([$scope]);
            $requestStateRow = $requestStateQuery->fetch();
            $requestMap = $requestStateRow ? (json_decode($requestStateRow['state_value'], true) ?: []) : [];
            $existingRequest = $requestMap[$requestId] ?? null;
            if (is_array($existingRequest) && !hash_equals((string)($existingRequest['fingerprint'] ?? ''), $fingerprint)) {
                throw new ApiException('This request identifier was already used for different reservation details.', 409);
            }
            $existingReservationId = is_array($existingRequest)
                ? filter_var($existingRequest['reservation_id'] ?? null, FILTER_VALIDATE_INT)
                : filter_var($existingRequest, FILTER_VALIDATE_INT);
            if ($existingReservationId) {
                $existingResult = reservationCreateResult(
                    $db,
                    (int)$existingReservationId,
                    $userId,
                    $requestId,
                    'Your reservation was already submitted and is awaiting confirmation.',
                );
                if ($existingResult) {
                    $db->commit();
                    $existingResult['already_submitted'] = true;
                    return $existingResult;
                }
                unset($requestMap[$requestId]);
            }

            $bookingTimezone = new DateTimeZone('Asia/Manila');
            $bookingNow = new DateTimeImmutable('now', $bookingTimezone);
            $bookingToday = $bookingNow->format('Y-m-d');
            $bookingTime = $bookingNow->format('H:i');
            $parsedDate = DateTimeImmutable::createFromFormat('!Y-m-d', $date, $bookingTimezone);
            $dateErrors = DateTimeImmutable::getLastErrors();
            if (!$parsedDate || ($dateErrors !== false && ($dateErrors['warning_count'] || $dateErrors['error_count'])) || $parsedDate->format('Y-m-d') !== $date) {
                throw new ApiException('Choose a valid reservation date.', 422);
            }
            if ($date < $bookingToday) throw new ApiException('The reservation date has already passed. Choose a future date.', 422);
            if ($date === $bookingToday && $startTime <= $bookingTime) {
                throw new ApiException('The selected start time has already started or passed. Choose another time.', 422);
            }
            $startMinutes = ((int)substr($startTime, 0, 2) * 60) + (int)substr($startTime, 3, 2);
            $endMinutes = ((int)substr($endTime, 0, 2) * 60) + (int)substr($endTime, 3, 2);
            if ($startMinutes < 480 || $endMinutes > 1320 || $endMinutes <= $startMinutes ||
                $endMinutes - $startMinutes !== (int)$duration * 60) {
                throw new ApiException('The selected time range is invalid or falls outside facility hours.', 422);
            }
            foreach ($courtBookings as $booking) {
                if ($date === $bookingToday && $booking['startTime'] <= $bookingTime) {
                    throw new ApiException('A selected court time has already started or passed. Choose another schedule.', 422);
                }
            }

            $facilityQuery = $db->prepare("SELECT f.facility_id, f.owner_id, f.name, f.hourly_rate FROM facilities f WHERE f.facility_id = ? AND f.status = 'Active' AND NOT EXISTS (SELECT 1 FROM app_state removed WHERE removed.scope_key = CONCAT('facility:', f.facility_id) AND removed.state_key = 'facility.removal') FOR UPDATE");
            $facilityQuery->execute([(int)$facilityId]);
            $facility = $facilityQuery->fetch();
            if (!$facility) throw new ApiException('The selected facility is no longer available.', 404);
            $amenityQuery = $db->prepare('SELECT a.amenity_name FROM facility_amenities fa JOIN amenities a ON a.amenity_id = fa.amenity_id WHERE fa.facility_id = ?');
            $amenityQuery->execute([(int)$facilityId]);
            $facilityAmenities = $amenityQuery->fetchAll(PDO::FETCH_COLUMN);

            $courtQuery = $db->prepare('SELECT court_id FROM courts WHERE facility_id = ? AND is_active = 1 ORDER BY CAST(SUBSTRING(court_number, 2) AS UNSIGNED), court_id FOR UPDATE');
            $courtQuery->execute([(int)$facilityId]);
            $courtIds = array_map('intval', $courtQuery->fetchAll(PDO::FETCH_COLUMN));
            if (!$courtIds || (int)$quantity > count($courtIds)) {
                throw new ApiException('The requested number of courts is not available at this facility.', 409);
            }

            $hourlyRate = (float)$facility['hourly_rate'];
            $courtRate = 0.0;
            foreach ($courtBookings as &$booking) {
                $booking['hourlyRate'] = $hourlyRate;
                $booking['courtRate'] = round($hourlyRate * (int)$booking['duration'], 2);
                $courtRate += $booking['courtRate'];
            }
            unset($booking);
            $courtRate = round($courtRate, 2);
            $equipmentLines = validateReservationEquipment($db, (int)$facilityId, $facilityAmenities, $equipmentSelections, $date, $courtBookings);
            $equipmentTotal = round(array_sum(array_column($equipmentLines, 'lineTotal')), 2);
            $rentalTotal = round($courtRate + $equipmentTotal, 2);
            $promo = null;
            $promoStateId = null;
            $promoCodes = [];
            if ($promoCode !== '') {
                if (!preg_match('/^[A-Z0-9_-]{4,32}$/', $promoCode)) throw new ApiException('The promo code format is invalid.', 422);
                [$promoStateId, $promoCodes, $promo] = validatePromoCode($db, $promoCode, $rentalTotal, true);
            }
            $feeSnapshot = bookingFeeSnapshot($db, $rentalTotal, $promo);
            if ($feeSnapshot['userTotal'] <= 0) throw new ApiException('The applied promo code must leave a positive amount due to submit this booking.', 422);
            if (abs($submittedTotal - $feeSnapshot['userTotal']) > 0.01) {
                throw new ApiException('The booking total changed. Review the updated total and submit again.', 409);
            }
            $checkout = checkoutAmounts($feeSnapshot, $paymentOption);
            if ($submittedPayNow !== null && abs($submittedPayNow - $checkout['amountToPayNow']) > 0.01) {
                throw new ApiException('The amount due now changed. Review the updated checkout and submit again.', 409);
            }

            $savedPaymentMethod = null;
            if ($savedPaymentMethodId) {
                $savedMethodQuery = $db->prepare('SELECT saved_payment_method_id, method_type, account_name FROM user_payment_methods WHERE saved_payment_method_id = ? AND user_id = ? FOR UPDATE');
                $savedMethodQuery->execute([$savedPaymentMethodId, $userId]);
                $savedPaymentMethod = $savedMethodQuery->fetch();
                if (!$savedPaymentMethod || $savedPaymentMethod['method_type'] !== $paymentMethod) {
                    throw new ApiException('The saved payment method is unavailable or belongs to a different payment type.', 404);
                }
            }

            $methodName = $paymentMethod === 'Bank' ? 'Bank Transfer' : $paymentMethod;
            if ($paymentMethod === 'Cash' || $isCardPayment) $db->prepare('INSERT IGNORE INTO payment_methods (method_name) VALUES (?)')->execute([$methodName]);
            $methodQuery = $db->prepare('SELECT method_id FROM payment_methods WHERE method_name = ? LIMIT 1');
            $methodQuery->execute([$methodName]);
            $paymentMethodId = $methodQuery->fetchColumn();
            if (!$paymentMethodId) throw new ApiException('The selected payment method is not configured.', 503);

            if (count(array_intersect($requestedCourtIds, $courtIds)) !== (int)$quantity) {
                throw new ApiException('One or more selected courts are no longer active at this facility.', 409);
            }
            $sqlBookings = $db->prepare(
                "SELECT 1 FROM reservation_courts rc JOIN reservations r ON r.reservation_id = rc.reservation_id
                 WHERE rc.court_id = ? AND r.facility_id = ? AND r.reservation_date = ? AND r.status IN ('Pending', 'Pending payment', 'Payment verification', 'Confirmed', 'Checked in', 'Disputed')
                   AND COALESCE(rc.start_time, r.start_time) < ? AND COALESCE(rc.end_time, r.end_time) > ? LIMIT 1 FOR UPDATE"
            );
            $maintenance = $db->prepare(
                "SELECT 1 FROM court_unavailable_slots
                 WHERE court_id = ? AND slot_date = ? AND slot_status = 'Unavailable'
                   AND slot_time >= ? AND slot_time < ? LIMIT 1"
            );
            foreach ($courtBookings as $booking) {
                $courtStart = $booking['startTime'] . ':00';
                $courtEnd = $booking['endTime'] . ':00';
                $sqlBookings->execute([(int)$booking['courtId'], (int)$facilityId, $date, $courtEnd, $courtStart]);
                if ($sqlBookings->fetchColumn()) {
                    throw new ApiException('One of the selected courts was just booked for that time. Review the refreshed schedule.', 409);
                }
                $maintenance->execute([(int)$booking['courtId'], $date, $courtStart, $courtEnd]);
                if ($maintenance->fetchColumn()) {
                    throw new ApiException('A selected time for one of the courts is blocked. Review the refreshed schedule.', 409);
                }
            }

            if ($promo) {
                foreach ($promoCodes as &$storedPromo) {
                    if (($storedPromo['id'] ?? null) === ($promo['id'] ?? null)) {
                        $storedPromo['usedCount'] = (int)($storedPromo['usedCount'] ?? 0) + 1;
                        $storedPromo['lastUsedAt'] = date(DATE_ATOM);
                        break;
                    }
                }
                unset($storedPromo);
                savePromoCodes($db, $promoStateId, $promoCodes);
            }

            $reservationStatus = $isCardPayment ? 'Pending payment' : 'Pending';
            $insertReservation = $db->prepare(
                'INSERT INTO reservations (user_id, facility_id, reservation_date, start_time, end_time, status, total_amount)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            );
            $insertReservation->execute([$userId, (int)$facilityId, $date, $startTime . ':00', $endTime . ':00', $reservationStatus, $feeSnapshot['courtRate']]);
            $reservationId = (int)$db->lastInsertId();

            $insertCourt = $db->prepare('INSERT INTO reservation_courts (reservation_id, court_id, start_time, end_time, hourly_rate) VALUES (?, ?, ?, ?, ?)');
            foreach ($courtBookings as $booking) {
                $insertCourt->execute([
                    $reservationId,
                    (int)$booking['courtId'],
                    $booking['startTime'] . ':00',
                    $booking['endTime'] . ':00',
                    $booking['hourlyRate'],
                ]);
            }
            if ($equipmentLines) {
                $insertEquipment = $db->prepare(
                    'INSERT INTO reservation_equipment_items
                     (reservation_id, equipment_item_id, category_name_snapshot, item_name_snapshot, billing_unit_snapshot, unit_price_snapshot, quantity, billed_hours, line_total, image_data_snapshot, image_mime_snapshot)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                foreach ($equipmentLines as $line) {
                    $insertEquipment->execute([
                        $reservationId, $line['itemId'], $line['categoryName'], $line['itemName'], $line['billingUnit'],
                        $line['unitPrice'], $line['quantity'], $line['billedHours'], $line['lineTotal'],
                        $line['imageBinary'], $line['imageMime'],
                    ]);
                }
            }

            $insertPayment = $db->prepare(
                "INSERT INTO payments (reservation_id, method_id, user_payment_method_id, amount, payment_type, payment_status, transaction_reference, idempotency_key, paid_at)
                 VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, NULL)"
            );
            $paymentType = $paymentOption === 'half' ? 'downpayment' : 'full';
            $insertPayment->execute([
                $reservationId,
                (int)$paymentMethodId,
                $savedPaymentMethod ? (int)$savedPaymentMethod['saved_payment_method_id'] : null,
                $checkout['amountToPayNow'],
                $paymentType,
                $paymentReference !== '' ? $paymentReference : null,
                'reservation:' . $requestId . ':initial',
            ]);
            $paymentId = (int)$db->lastInsertId();
            if (!$isCardPayment) {
                $db->prepare('UPDATE payments SET proof_location = ? WHERE payment_id = ?')->execute(['payment:' . $paymentId, $paymentId]);
                $proofPayload = [
                    'paymentId' => $paymentId,
                    'reservationId' => $reservationId,
                    'image' => $paymentProof,
                    'reference' => $paymentReference,
                    'submittedBy' => $userId,
                    'uploadedAt' => date(DATE_ATOM),
                ];
                $saveProof = $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'payment.proof', ?) ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), user_id = VALUES(user_id)");
                $saveProof->execute(['payment:' . $paymentId, $userId, json_encode($proofPayload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
            }

            $platformSettingsQuery = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = 'global' AND state_key = 'platform.fees' LIMIT 1");
            $platformSettingsQuery->execute();
            $platformSettings = json_decode((string)($platformSettingsQuery->fetchColumn() ?: '{}'), true) ?: [];
            $refundPolicy = $platformSettings['refundPolicy'] ?? [
                'freeCancelHours' => 24,
                'lateCancelRefundRate' => 0.5,
                'noShowRefundRate' => 0,
                'requestExpiryHours' => 24,
                'disputeWindowHours' => 48,
            ];
            $paymentSnapshot = [
                'fees' => $feeSnapshot,
                'courtCharges' => $courtRate,
                'equipmentTotal' => $equipmentTotal,
                'paymentOption' => $paymentOption,
                'balanceSettlement' => $paymentOption === 'half' ? $balanceSettlement : null,
                'amountToPayNow' => $checkout['amountToPayNow'],
                'remainingBalance' => $checkout['remainingBalance'],
                'promo' => $promo ? [
                    'code' => $promo['code'],
                    'discountType' => $promo['discountType'],
                    'value' => (float)$promo['value'],
                    'discountAmount' => $feeSnapshot['promoDiscount'],
                    'rentalDiscount' => $feeSnapshot['promoRentalDiscount'],
                    'serviceFeeDiscount' => $feeSnapshot['promoServiceFeeDiscount'],
                ] : null,
                'paymentProvider' => $isCardPayment ? 'PayMongo' : null,
                'refundPolicy' => $refundPolicy,
                'createdAt' => date(DATE_ATOM),
            ];
            $savePaymentSnapshot = $db->prepare(
                "INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'reservation.payment', ?)
                 ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP"
            );
            $savePaymentSnapshot->execute(['reservation:' . $reservationId, $userId, json_encode($paymentSnapshot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);

            writeFinancialLedgerEntry($db, [
                'idempotencyKey' => 'payment:' . $paymentId . ':customer', 'type' => 'customer_payment',
                'reservationId' => $reservationId, 'paymentId' => $paymentId, 'userId' => $userId,
                'ownerId' => (int)$facility['owner_id'], 'amount' => $checkout['amountToPayNow'],
                'status' => $isCardPayment ? 'Pending' : 'Pending verification', 'reference' => $paymentReference ?: null,
                'metadata' => ['paymentType' => $paymentType, 'method' => $paymentMethod],
            ]);
            writeFinancialLedgerEntry($db, [
                'idempotencyKey' => 'reservation:' . $reservationId . ':service-fee', 'type' => 'platform_service_fee',
                'reservationId' => $reservationId, 'paymentId' => $paymentId, 'userId' => $userId,
                'ownerId' => (int)$facility['owner_id'], 'amount' => $feeSnapshot['serviceFee'],
                'status' => $isCardPayment ? 'Pending' : 'Pending verification', 'metadata' => ['collectedWith' => $paymentType],
            ]);
            if ($promo && $feeSnapshot['promoDiscount'] > 0) {
                writeFinancialLedgerEntry($db, [
                    'idempotencyKey' => 'reservation:' . $reservationId . ':promo', 'type' => 'promo_discount',
                    'reservationId' => $reservationId, 'paymentId' => $paymentId, 'userId' => $userId,
                    'ownerId' => (int)$facility['owner_id'], 'amount' => -$feeSnapshot['promoDiscount'],
                    'status' => 'Applied', 'metadata' => [
                        'code' => $promo['code'], 'discountType' => $promo['discountType'],
                        'value' => (float)$promo['value'], 'rentalDiscount' => $feeSnapshot['promoRentalDiscount'],
                        'serviceFeeDiscount' => $feeSnapshot['promoServiceFeeDiscount'],
                    ],
                ]);
            }
            writeFinancialLedgerEntry($db, [
                'idempotencyKey' => 'reservation:' . $reservationId . ':owner-pending', 'type' => 'owner_pending_balance',
                'reservationId' => $reservationId, 'userId' => $userId, 'ownerId' => (int)$facility['owner_id'],
                'amount' => $feeSnapshot['ownerNet'], 'status' => 'Held',
                'metadata' => ['releaseAfterCompletionHours' => (int)($refundPolicy['disputeWindowHours'] ?? 48)],
            ]);

            $ownerScope = 'user:' . (int)$facility['owner_id'];
            $earningsQuery = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'owner.earnings' FOR UPDATE");
            $earningsQuery->execute([$ownerScope]);
            $earningsRow = $earningsQuery->fetch();
            $ownerEarnings = $earningsRow ? (json_decode((string)$earningsRow['state_value'], true) ?: []) : [];
            if (!is_array($ownerEarnings)) $ownerEarnings = [];
            if (!array_filter($ownerEarnings, static fn(mixed $earning): bool => is_array($earning) && (string)($earning['reservationId'] ?? '') === (string)$reservationId)) {
                $releaseHours = max(0, (int)($refundPolicy['disputeWindowHours'] ?? 48));
                $releaseAt = (new DateTimeImmutable($date . ' ' . $endTime))->modify('+' . $releaseHours . ' hours')->format(DATE_ATOM);
                array_unshift($ownerEarnings, [
                    'id' => 'E-' . $reservationId, 'ownerId' => (int)$facility['owner_id'], 'reservationId' => $reservationId,
                    'date' => $date, 'endTime' => $endTime, 'releaseAt' => $releaseAt, 'user' => $user['name'], 'facility' => $facility['name'],
                    'courtRate' => $feeSnapshot['courtRate'], 'serviceFee' => $feeSnapshot['serviceFee'],
                    'ownerCommission' => $feeSnapshot['ownerCommission'], 'ownerNet' => $feeSnapshot['ownerNet'],
                    'courtCharges' => $courtRate, 'equipmentTotal' => $equipmentTotal,
                    'status' => 'Pending', 'reservationStatus' => $reservationStatus, 'paymentStatus' => 'pending',
                    'paymentOption' => $paymentOption,
                ]);
                $saveEarnings = $db->prepare(
                    'INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP'
                );
                $saveEarnings->execute([$ownerScope, (int)$facility['owner_id'], 'owner.earnings', json_encode($ownerEarnings, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
            }

            storeNotification(
                $db,
                $userId,
                $isCardPayment ? 'Complete card payment' : 'Reservation submitted',
                $isCardPayment
                    ? 'Your reservation for ' . $facility['name'] . ' is waiting for you to complete secure PayMongo card checkout.'
                    : 'Your reservation for ' . $facility['name'] . ' was submitted. Your ' . ($paymentOption === 'half' ? '50% downpayment' : 'full payment') . ' proof is awaiting verification before the booking can be confirmed.',
            );
            if (!$isCardPayment) {
                if (!empty($facility['owner_id'])) {
                    storeNotification($db, (int)$facility['owner_id'], 'New reservation request', $user['name'] . ' submitted a reservation for ' . $facility['name'] . '.');
                }
                storeRoleNotifications($db, 'Admin', 'New reservation request', $user['name'] . ' submitted a reservation for ' . $facility['name'] . '.');
            }

            $requestMap[$requestId] = ['reservation_id' => $reservationId, 'fingerprint' => $fingerprint];
            $saveRequests = $db->prepare(
                'INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP'
            );
            $saveRequests->execute([
                $scope,
                $userId,
                'reservation.requests',
                json_encode($requestMap, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            ]);
            $db->commit();

            return reservationCreateResult(
                $db,
                $reservationId,
                $userId,
                $requestId,
                'Your reservation was submitted and is awaiting confirmation.',
            ) ?? throw new RuntimeException('The saved reservation could not be read back.');
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
    } finally {
        $db->query("SELECT RELEASE_LOCK('reserva_reservations')");
    }
}

try {
    $config = require __DIR__ . '/config.php';
    session_set_cookie_params([
        'httponly' => true,
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'samesite' => 'Lax',
    ]);
    $sessionPath = getenv('PHP_SESSION_PATH');
    if ($sessionPath && is_dir($sessionPath)) session_save_path($sessionPath);
    if (!in_array(($_GET['action'] ?? ''), ['auth.oauth.callback', 'payments.card.webhook'], true)) session_start();

    $db = new PDO(
        "mysql:host={$config['host']};port={$config['port']};dbname={$config['database']};charset=utf8mb4",
        $config['username'],
        $config['password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
    $action = $_GET['action'] ?? '';
    $rawRequestBody = '';
    $body = input($rawRequestBody);

    if ($action === 'payments.card.webhook') {
        $webhookSecret = trim((string)($config['payments']['paymongo_webhook_secret'] ?? ''));
        if ($webhookSecret === '') fail('PayMongo webhook signing secret is not configured.', 503);
        $headers = function_exists('getallheaders') ? getallheaders() : [];
        $signature = (string)($headers['Paymongo-Signature'] ?? $headers['paymongo-signature'] ?? $_SERVER['HTTP_PAYMONGO_SIGNATURE'] ?? '');
        $eventData = is_array($body['data'] ?? null) ? $body['data'] : [];
        $eventAttributes = is_array($eventData['attributes'] ?? null) ? $eventData['attributes'] : [];
        $liveMode = (bool)($eventAttributes['livemode'] ?? $eventData['livemode'] ?? $body['livemode'] ?? false);
        if (!verifyPaymongoWebhook($rawRequestBody, $signature, $webhookSecret, $liveMode)) fail('Invalid PayMongo webhook signature.', 401);
        $eventId = trim((string)($eventData['id'] ?? $eventAttributes['id'] ?? ''));
        $eventType = trim((string)($eventAttributes['type'] ?? $eventData['type'] ?? $body['event_type'] ?? ''));
        if ($eventType !== 'checkout_session.payment.paid') respond(['success' => true, 'ignored' => true]);
        $checkoutSession = $eventAttributes['data'] ?? $eventData['data'] ?? null;
        if (!is_array($checkoutSession) || $eventId === '') fail('PayMongo webhook event is incomplete.', 422);
        $eventLockName = 'reserva_paymongo_' . substr(hash('sha256', $eventId), 0, 32);
        $eventLock = $db->prepare('SELECT GET_LOCK(?, 8)');
        $eventLock->execute([$eventLockName]);
        if ((int)$eventLock->fetchColumn() !== 1) fail('Payment event is being processed. PayMongo can retry this event.', 503);
        try {
            $seenQuery = $db->prepare("SELECT state_id FROM app_state WHERE scope_key = ? AND state_key = 'paymongo.event' LIMIT 1");
            $seenQuery->execute(['paymongo-event:' . $eventId]);
            $duplicateEvent = (bool)$seenQuery->fetchColumn();
            if (!$duplicateEvent) {
                applyPaymongoCheckoutPaid($db, $checkoutSession);
                $saveEvent = $db->prepare("INSERT INTO app_state (scope_key, state_key, state_value) VALUES (?, 'paymongo.event', ?)");
                $saveEvent->execute(['paymongo-event:' . $eventId, json_encode(['eventId' => $eventId, 'receivedAt' => date(DATE_ATOM)], JSON_THROW_ON_ERROR)]);
            }
        } finally {
            $release = $db->prepare('SELECT RELEASE_LOCK(?)');
            $release->execute([$eventLockName]);
        }
        respond(['success' => true, 'duplicate' => $duplicateEvent]);
    }

    if ($action === 'auth.oauth.start') {
        try {
            $provider = strtolower(trim((string)($_GET['provider'] ?? '')));
            $flowId = $_GET['flowId'] ?? null;
            $intent = $_GET['intent'] ?? null;
            $authorizeUrl = oauthStart($db, $config, $provider, $_GET['returnTo'] ?? null, $flowId, $intent);
            unset($_SESSION['oauth_completed_flow_id'], $_SESSION['oauth_completed_intent']);
            $_SESSION['oauth_flow_id'] = (string)$flowId;
            $_SESSION['oauth_intent'] = (string)$intent;
            header('Cache-Control: no-store');
            header('Location: ' . $authorizeUrl, true, 302);
            exit;
        } catch (OAuthFlowException $error) {
            $intent = ($_GET['intent'] ?? null) === 'signup' ? 'signup' : 'login';
            redirectOAuthResult($config, $error->reason, oauthSafeReturnTo($_GET['returnTo'] ?? null), ['intent' => $intent]);
        } catch (Throwable $error) {
            error_log('Social sign-in could not start: ' . $error->getMessage());
            $intent = ($_GET['intent'] ?? null) === 'signup' ? 'signup' : 'login';
            redirectOAuthResult($config, 'provider_unavailable', oauthSafeReturnTo($_GET['returnTo'] ?? null), ['intent' => $intent]);
        }
    }
    if ($action === 'auth.oauth.callback') {
        try {
            $oauthResponse = $_GET + $_POST + $body;
            $identity = oauthComplete($db, $config, $oauthResponse);
            $ticket = oauthCreateTicket($db, (int)$identity['userId'], (string)$identity['flowId'], (string)$identity['returnTo'], (string)$identity['intent']);
            redirectOAuthResult($config, 'verified', (string)$identity['returnTo'], ['ticket' => $ticket, 'flowId' => $identity['flowId'], 'intent' => $identity['intent']]);
        } catch (OAuthFlowException $error) {
            redirectOAuthResult($config, $error->reason, $error->returnTo, ['intent' => $error->intent]);
        } catch (Throwable $error) {
            error_log('Social sign-in callback failed: ' . $error->getMessage());
            redirectOAuthResult($config, 'provider_unavailable');
        }
    }
    if ($action === 'auth.oauth.finish') {
        try {
            oauthConsumeTicket($db, (string)($body['ticket'] ?? ''), (string)($body['flowId'] ?? ''), (string)($body['intent'] ?? ''));
        } catch (OAuthFlowException $error) {
            fail($error->reason, 401);
        }
        respond(['ok' => true, 'user' => currentUser($db)]);
    }

    if ($action === 'auth.session') {
        respond(['user' => empty($_SESSION['user_id']) ? null : currentUser($db)]);
    }
    if ($action === 'presence.heartbeat' || $action === 'presence.leave') {
        $user = currentUser($db);
        $clientId = trim((string)($body['clientId'] ?? ''));
        if (!preg_match('/^[A-Za-z0-9_-]{16,80}$/', $clientId)) fail('A valid presence client ID is required.', 422);
        $online = refreshPresence(
            $db,
            (int)$user['id'],
            $clientId,
            $action === 'presence.heartbeat',
            hash('sha256', session_id()),
        );
        respond(['online' => $online, 'lastSeen' => date(DATE_ATOM)]);
    }
    if ($action === 'auth.logout') {
        $userId = (int)($_SESSION['user_id'] ?? 0);
        $clientId = trim((string)($body['clientId'] ?? ''));
        if ($userId) {
            try {
                refreshPresence(
                    $db,
                    $userId,
                    preg_match('/^[A-Za-z0-9_-]{16,80}$/', $clientId) ? $clientId : null,
                    false,
                    hash('sha256', session_id()),
                    true,
                );
            } catch (Throwable $error) {
                error_log('Could not clear presence on logout: ' . $error->getMessage());
            }
        }
        $_SESSION = [];
        session_destroy();
        respond(['ok' => true]);
    }
    if ($action === 'auth.login') {
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $query = $db->prepare(
            'SELECT u.user_id, u.full_name, u.email, u.password_hash, u.account_status, r.role_name
             FROM users u LEFT JOIN roles r ON r.role_id = u.role_id WHERE u.email = ? LIMIT 1'
        );
        $query->execute([$email]);
        $user = $query->fetch();
        if (!$user || !password_verify((string)($body['password'] ?? ''), $user['password_hash'])) {
            fail('Email or password is incorrect.', 422);
        }
        if ($user['account_status'] !== 'Active') fail('This account is suspended.', 403);
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$user['user_id'];
        respond(['ok' => true, 'user' => currentUser($db)]);
    }
    if ($action === 'auth.signup') {
        $name = trim((string)($body['fullName'] ?? ''));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $password = (string)($body['password'] ?? '');
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8) {
            fail('Enter a name, valid email, and password of at least 8 characters.', 422);
        }
        $insert = $db->prepare(
            "INSERT INTO users (full_name, email, phone, password_hash, role_id) VALUES (?, ?, ?, ?, (SELECT role_id FROM roles WHERE role_name = 'User'))"
        );
        try {
            $insert->execute([$name, $email, trim((string)($body['phone'] ?? '')), password_hash($password, PASSWORD_DEFAULT)]);
        } catch (PDOException $error) {
            if ($error->getCode() === '23000') fail('An account with this email already exists.', 409);
            throw $error;
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$db->lastInsertId();
        respond(['ok' => true, 'user' => currentUser($db)], 201);
    }
    if ($action === 'owner.register') {
        $name = trim((string)($body['fullName'] ?? ''));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $password = (string)($body['password'] ?? '');
        $phone = trim((string)($body['phone'] ?? ''));
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8) fail('Enter a name, valid email, and password of at least 8 characters.', 422);
        $role = $db->prepare("SELECT role_id FROM roles WHERE role_name = 'Facility Owner'");
        $role->execute();
        $roleId = $role->fetchColumn();
        if (!$roleId) fail('The Facility Owner role is missing from the database.', 500);
        $existing = $db->prepare('SELECT user_id FROM users WHERE email = ? LIMIT 1');
        $existing->execute([$email]);
        $existingId = $existing->fetchColumn();
        if ($existingId && (int)($_SESSION['user_id'] ?? 0) === (int)$existingId) {
            $promote = $db->prepare('UPDATE users SET full_name = ?, phone = ?, role_id = ? WHERE user_id = ?');
            $promote->execute([$name, $phone, $roleId, $existingId]);
            $ownerId = (int)$existingId;
        } else {
          try {
            $insert = $db->prepare('INSERT INTO users (full_name, email, phone, password_hash, role_id) VALUES (?, ?, ?, ?, ?)');
            $insert->execute([$name, $email, $phone, password_hash($password, PASSWORD_DEFAULT), $roleId]);
            $ownerId = (int)$db->lastInsertId();
        } catch (PDOException $error) {
            if ($error->getCode() === '23000') fail('An account with this email already exists.', 409);
            throw $error;
        }
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = $ownerId;
        respond(['ok' => true, 'owner' => currentUser($db)], 201);
    }
    if ($action === 'auth.recover') {
        fail('Password recovery is not configured for this server.', 501);
    }

    if ($action === 'profile.get') respond(['data' => profilePayload($db, currentUser($db))]);
    if ($action === 'profile.save') {
        $user = currentUser($db);
        $name = trim((string)($body['name'] ?? $user['name']));
        $email = strtolower(trim((string)($body['email'] ?? $user['email'])));
        $phone = trim((string)($body['phone'] ?? $user['phone']));
        $sports = $body['preferredSports'] ?? $user['preferredSports'];
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || !is_array($sports)) fail('Enter a valid name, email address, and sports list.', 422);
        $emailCheck = $db->prepare('SELECT user_id FROM users WHERE email = ? AND user_id <> ? LIMIT 1');
        $emailCheck->execute([$email, (int)$user['id']]);
        if ($emailCheck->fetchColumn()) fail('An account with this email address already exists.', 409);
        $addressRequested = array_key_exists('address', $body);
        $oldAddress = $addressRequested ? profileAddress($db, (int)$user['id']) : '';
        $newAddress = $addressRequested ? trim((string)$body['address']) : $oldAddress;
        if (strlen($newAddress) > 500) fail('The address must be 500 characters or fewer.', 422);
        $addressChanged = $addressRequested && $newAddress !== $oldAddress;
        $pictureRequested = array_key_exists('profilePicture', $body);
        $oldPicture = $pictureRequested ? profilePicture($db, (int)$user['id']) : null;
        $newPicture = $oldPicture;
        if ($pictureRequested) {
            $candidate = $body['profilePicture'];
            if ($candidate === null || $candidate === '') {
                $newPicture = null;
            } elseif (!is_string($candidate) || strlen($candidate) > 350000 || !preg_match('/\\Adata:image\\/(png|jpeg|webp);base64,([A-Za-z0-9+\\/=]+)\\z/', $candidate, $pictureParts)) {
                fail('Choose a valid PNG, JPEG, or WebP profile picture under 256 KB after resizing.', 422);
            } else {
                $pictureBytes = base64_decode($pictureParts[2], true);
                try {
                    $pictureInfo = $pictureBytes === false ? false : getimagesizefromstring($pictureBytes);
                } catch (Throwable) {
                    $pictureInfo = false;
                }
                $allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];
                if ($pictureBytes === false || strlen($pictureBytes) > 262144 || !$pictureInfo ||
                    !in_array($pictureInfo['mime'] ?? '', $allowedMimeTypes, true) ||
                    (int)($pictureInfo[0] ?? 0) > 768 || (int)($pictureInfo[1] ?? 0) > 768) {
                    fail('The profile picture is invalid or too large. Choose an image no larger than 768 × 768 pixels.', 422);
                }
                $newPicture = $candidate;
            }
        }
        $pictureChanged = $pictureRequested && $newPicture !== $oldPicture;
        $db->beginTransaction();
        try {
            $save = $db->prepare('UPDATE users SET full_name = ?, email = ?, phone = ?, preferred_sports = ? WHERE user_id = ?');
            $save->execute([$name, $email, $phone, json_encode(array_values($sports)), $user['id']]);
            if ($addressChanged) {
                if ($newAddress === '') {
                    $removeAddress = $db->prepare("DELETE FROM app_state WHERE scope_key = ? AND state_key = 'profile.address'");
                    $removeAddress->execute(['user:' . $user['id']]);
                } else {
                    $saveAddress = $db->prepare(
                        "INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'profile.address', ?)\n                         ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP"
                    );
                    $saveAddress->execute(['user:' . $user['id'], (int)$user['id'], json_encode($newAddress, JSON_THROW_ON_ERROR)]);
                }
            }
            if ($pictureChanged) {
                if ($newPicture === null) {
                    $remove = $db->prepare("DELETE FROM app_state WHERE scope_key = ? AND state_key = 'profile.picture'");
                    $remove->execute(['user:' . $user['id']]);
                } else {
                    $savePicture = $db->prepare(
                        "INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'profile.picture', ?)\n                         ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP"
                    );
                    $savePicture->execute(['user:' . $user['id'], (int)$user['id'], json_encode($newPicture, JSON_THROW_ON_ERROR)]);
                }
                storeNotification($db, (int)$user['id'], 'Profile picture updated', 'Your profile picture was successfully updated.');
            }
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            if ($error instanceof PDOException && $error->getCode() === '23000') fail('An account with this email address already exists.', 409);
            throw $error;
        }
        respond(['data' => profilePayload($db, currentUser($db))]);
    }
    if ($action === 'sports.list') {
        $query = $db->query('SELECT sport_id AS id, name FROM sports ORDER BY name');
        $colors = readSportColors($db);
        $sports = array_map(static function (array $row) use ($colors): array {
            $id = (int)$row['id'];
            $color = $colors[(string)$id] ?? $colors[$id] ?? defaultSportColor($id, (string)$row['name']);
            return ['id' => $id, 'name' => $row['name'], 'color' => $color];
        }, $query->fetchAll());
        respond(['data' => $sports]);
    }
    if (in_array($action, ['sports.create', 'sports.update', 'sports.delete', 'sports.color.update'], true)) {
        $user = currentUser($db);
        if ($action === 'sports.color.update') {
            if (!in_array($user['role'], ['Admin', 'Facility Owner'], true)) fail('Owner or administrator access is required.', 403);
            $sportId = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
            $color = strtolower(trim((string)($body['color'] ?? '')));
            if (!$sportId || !preg_match('/^#[0-9a-f]{6}$/', $color)) fail('Choose a valid sport and a six-digit color.', 422);
            $db->beginTransaction();
            $exists = $db->prepare('SELECT sport_id FROM sports WHERE sport_id = ? FOR UPDATE');
            $exists->execute([$sportId]);
            if (!$exists->fetchColumn()) {
                $db->rollBack();
                fail('Sport not found.', 404);
            }
            $colors = readSportColors($db);
            $colors[(string)$sportId] = $color;
            writeSportColors($db, $colors);
            $db->commit();
            respond(['data' => ['id' => (int)$sportId, 'color' => $color]]);
        }

        if ($user['role'] !== 'Admin') fail('Only administrators can manage sport types.', 403);
        if ($action === 'sports.create') {
            $name = trim((string)($body['name'] ?? ''));
            if ($name === '' || strlen($name) > 80) fail('Enter a sport name up to 80 characters long.', 422);
            $duplicate = $db->prepare('SELECT sport_id FROM sports WHERE LOWER(name) = LOWER(?) LIMIT 1');
            $duplicate->execute([$name]);
            if ($duplicate->fetchColumn()) fail('That sport type already exists.', 409);
            $db->beginTransaction();
            try {
                $insert = $db->prepare('INSERT INTO sports (name) VALUES (?)');
                $insert->execute([$name]);
                $sportId = (int)$db->lastInsertId();
                $colors = readSportColors($db);
                $color = defaultSportColor($sportId, $name);
                $colors[(string)$sportId] = $color;
                writeSportColors($db, $colors);
                $db->commit();
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                if ($error instanceof PDOException && $error->getCode() === '23000') fail('That sport type already exists.', 409);
                throw $error;
            }
            respond(['data' => ['id' => $sportId, 'name' => $name, 'color' => $color]], 201);
        }

        $sportId = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$sportId) fail('A valid sport id is required.', 422);
        $db->beginTransaction();
        $find = $db->prepare('SELECT name FROM sports WHERE sport_id = ? FOR UPDATE');
        $find->execute([$sportId]);
        $oldName = $find->fetchColumn();
        if ($oldName === false) {
            $db->rollBack();
            fail('Sport not found.', 404);
        }
        if ($action === 'sports.update') {
            $name = trim((string)($body['name'] ?? ''));
            if ($name === '' || strlen($name) > 80) {
                $db->rollBack();
                fail('Enter a sport name up to 80 characters long.', 422);
            }
            $duplicate = $db->prepare('SELECT sport_id FROM sports WHERE LOWER(name) = LOWER(?) AND sport_id <> ? LIMIT 1');
            $duplicate->execute([$name, $sportId]);
            if ($duplicate->fetchColumn()) {
                $db->rollBack();
                fail('That sport type already exists.', 409);
            }
            $update = $db->prepare('UPDATE sports SET name = ? WHERE sport_id = ?');
            $update->execute([$name, $sportId]);
            if (strcasecmp((string)$oldName, $name) !== 0) {
                $users = $db->query('SELECT user_id, preferred_sports FROM users');
                $saveUser = $db->prepare('UPDATE users SET preferred_sports = ? WHERE user_id = ?');
                foreach ($users->fetchAll() as $row) {
                    $preferred = preferredSportsList($row['preferred_sports']);
                    $changed = false;
                    foreach ($preferred as $index => $sport) {
                        if (strcasecmp($sport, (string)$oldName) === 0) {
                            $preferred[$index] = $name;
                            $changed = true;
                        }
                    }
                    if ($changed) $saveUser->execute([json_encode(array_values(array_unique($preferred)), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), (int)$row['user_id']]);
                }
            }
            $colors = readSportColors($db);
            $color = $colors[(string)$sportId] ?? $colors[$sportId] ?? defaultSportColor($sportId, $name);
            $db->commit();
            respond(['data' => ['id' => (int)$sportId, 'name' => $name, 'color' => $color]]);
        }

        $usedByFacilities = $db->prepare('SELECT COUNT(*) FROM facilities WHERE sport_id = ?');
        $usedByFacilities->execute([$sportId]);
        $facilityCount = (int)$usedByFacilities->fetchColumn();
        if ($facilityCount > 0) {
            $db->rollBack();
            $affectedFacilities = $facilityCount === 1 ? '1 facility' : $facilityCount . ' facilities';
            fail('This sport is assigned to ' . $affectedFacilities . '. Reassign those facilities before deleting it.', 409);
        }
        $users = $db->query('SELECT user_id, preferred_sports FROM users');
        $saveUser = $db->prepare('UPDATE users SET preferred_sports = ? WHERE user_id = ?');
        foreach ($users->fetchAll() as $row) {
            $preferred = preferredSportsList($row['preferred_sports']);
            $remaining = array_values(array_filter($preferred, static fn(string $sport): bool => strcasecmp($sport, (string)$oldName) !== 0));
            if (count($remaining) !== count($preferred)) $saveUser->execute([json_encode($remaining, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), (int)$row['user_id']]);
        }
        $delete = $db->prepare('DELETE FROM sports WHERE sport_id = ?');
        $delete->execute([$sportId]);
        $colors = readSportColors($db);
        unset($colors[(string)$sportId], $colors[$sportId]);
        writeSportColors($db, $colors);
        $db->commit();
        respond(['ok' => true, 'id' => (int)$sportId]);
    }
    if ($action === 'amenities.list') {
        $query = $db->query('SELECT amenity_id AS id, amenity_name AS name FROM amenities ORDER BY amenity_name');
        $amenities = array_map(static fn(array $row): array => ['id' => (int)$row['id'], 'name' => $row['name']], $query->fetchAll());
        respond(['data' => $amenities]);
    }
    if ($action === 'notifications.list') {
        $user = currentUser($db);
        migrateLegacyNotifications($db, (int)$user['id']);
        $query = $db->prepare('SELECT notification_id, title, message, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, notification_id DESC');
        $query->execute([(int)$user['id']]);
        $notifications = array_map('notificationPayload', $query->fetchAll());
        respond(['data' => $notifications]);
    }
    if ($action === 'notifications.create') {
        $user = currentUser($db);
        $title = trim((string)($body['title'] ?? ''));
        $message = trim((string)($body['message'] ?? ''));
        $titleLength = function_exists('mb_strlen') ? mb_strlen($title) : strlen($title);
        if ($title === '' || $titleLength > 150 || $message === '' || strlen($message) > 10000) {
            fail('Enter a notification title of up to 150 characters and a non-empty message.', 422);
        }
        $id = storeNotification($db, (int)$user['id'], $title, $message);
        $query = $db->prepare('SELECT notification_id, title, message, is_read, created_at FROM notifications WHERE notification_id = ? AND user_id = ?');
        $query->execute([$id, (int)$user['id']]);
        $notification = notificationPayload($query->fetch());
        $notification['type'] = in_array($body['type'] ?? '', ['success', 'info', 'warning', 'danger'], true) ? $body['type'] : 'info';
        respond(['data' => $notification], 201);
    }
    if ($action === 'notifications.read') {
        $user = currentUser($db);
        $notificationId = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$notificationId || $notificationId < 1) fail('Choose a valid notification.', 422);
        migrateLegacyNotifications($db, (int)$user['id']);
        $update = $db->prepare('UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?');
        $update->execute([$notificationId, (int)$user['id']]);
        $query = $db->prepare('SELECT notification_id, title, message, is_read, created_at FROM notifications WHERE notification_id = ? AND user_id = ?');
        $query->execute([$notificationId, (int)$user['id']]);
        $row = $query->fetch();
        if (!$row) fail('Notification not found.', 404);
        respond(['data' => notificationPayload($row)]);
    }
    if ($action === 'notifications.read-all') {
        $user = currentUser($db);
        migrateLegacyNotifications($db, (int)$user['id']);
        $update = $db->prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0');
        $update->execute([(int)$user['id']]);
        respond(['ok' => true]);
    }
    if ($action === 'facilities.create' || $action === 'facilities.update') {
        $user = currentUser($db);
        if (!in_array($user['role'], ['Admin', 'Facility Owner'], true)) fail('Owner or administrator access is required.', 403);
        $facilityId = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        $ownerId = filter_var($body['ownerId'] ?? ($body['owner']['id'] ?? $user['id']), FILTER_VALIDATE_INT) ?: (int)$user['id'];
        if ($user['role'] === 'Facility Owner' && $ownerId !== (int)$user['id']) fail('You can only manage your own facilities.', 403);
        $name = trim((string)($body['name'] ?? ''));
        $sport = trim((string)($body['sport'] ?? ''));
        $rate = (float)($body['hourlyRate'] ?? 0);
        $courtCount = filter_var($body['courtCount'] ?? 1, FILTER_VALIDATE_INT);
        if ($name === '' || $sport === '' || $rate <= 0 || !$courtCount || $courtCount > 20) fail('Enter a facility name, sport, positive hourly rate, and 1–20 courts.', 422);
        $sportQuery = $db->prepare('SELECT sport_id FROM sports WHERE name = ? LIMIT 1');
        $sportQuery->execute([$sport]);
        $sportId = $sportQuery->fetchColumn();
        if (!$sportId) fail('Choose a sport listed in the database.', 422);
        $amenityNames = $body['amenities'] ?? [];
        if (!is_array($amenityNames)) fail('Choose amenities listed in the database.', 422);
        foreach ($amenityNames as $amenityName) {
            if (!is_string($amenityName)) fail('Choose amenities listed in the database.', 422);
        }
        $amenityNames = array_values(array_unique($amenityNames));
        $equipmentCatalog = array_key_exists('equipmentCategories', $body)
            ? normalizeEquipmentCatalog($body['equipmentCategories'])
            : null;
        if ($action === 'facilities.create' && $equipmentCatalog === null) $equipmentCatalog = [];
        $amenityIds = [];
        $amenityQuery = $db->prepare('SELECT amenity_id FROM amenities WHERE amenity_name = ? LIMIT 1');
        foreach ($amenityNames as $amenityName) {
            $amenityQuery->execute([$amenityName]);
            $amenityId = $amenityQuery->fetchColumn();
            if (!$amenityId) fail('Choose amenities listed in the database.', 422);
            $amenityIds[] = (int)$amenityId;
        }
        if ($action === 'facilities.update') {
            if (!$facilityId) fail('A facility id is required.', 422);
            $ownership = $db->prepare("SELECT f.owner_id FROM facilities f WHERE f.facility_id = ? AND NOT EXISTS (SELECT 1 FROM app_state removed WHERE removed.scope_key = CONCAT('facility:', f.facility_id) AND removed.state_key = 'facility.removal')");
            $ownership->execute([$facilityId]);
            $actualOwner = $ownership->fetchColumn();
            if ($actualOwner === false || ($user['role'] !== 'Admin' && (int)$actualOwner !== (int)$user['id'])) fail('Facility not found or access denied.', 404);
            $appearance = facilityPresentation($db, (int)$facilityId);
        } else {
            $colors = facilityColorOptions();
            $appearance = ['image' => null, 'color' => $colors[random_int(0, count($colors) - 1)]];
        }
        if (array_key_exists('image', $body)) $appearance['image'] = validateFacilityImage($body['image']);
        if (array_key_exists('color', $body)) {
            if (!is_string($body['color'])) fail('Choose one of the available facility card colors.', 422);
            $color = strtolower(trim((string)$body['color']));
            if (!in_array($color, facilityColorOptions(), true)) fail('Choose one of the available facility card colors.', 422);
            $appearance['color'] = $color;
        }
        if ($action === 'facilities.update') {
            $db->beginTransaction();
            $update = $db->prepare('UPDATE facilities SET owner_id = ?, name = ?, sport_id = ?, hourly_rate = ?, status = ? WHERE facility_id = ?');
            $update->execute([$ownerId, $name, $sportId, $rate, !empty($body['active']) ? 'Active' : 'Inactive', $facilityId]);
            $disable = $db->prepare('UPDATE courts SET is_active = 0 WHERE facility_id = ?');
            $disable->execute([$facilityId]);
            $court = $db->prepare('INSERT INTO courts (facility_id, court_number, court_name, is_active) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE is_active = 1');
            for ($number = 1; $number <= $courtCount; $number++) $court->execute([$facilityId, 'C' . $number, 'Court ' . $number]);
            if (array_key_exists('amenities', $body)) {
                $removeAmenities = $db->prepare('DELETE FROM facility_amenities WHERE facility_id = ?');
                $removeAmenities->execute([$facilityId]);
                $linkAmenity = $db->prepare('INSERT INTO facility_amenities (facility_id, amenity_id) VALUES (?, ?)');
                foreach ($amenityIds as $amenityId) $linkAmenity->execute([$facilityId, $amenityId]);
            }
            if ($equipmentCatalog !== null) replaceFacilityEquipment($db, (int)$facilityId, $equipmentCatalog);
            saveFacilityPresentation($db, (int)$facilityId, $appearance['image'], $appearance['color']);
            $db->commit();
        } else {
            $db->beginTransaction();
            $insert = $db->prepare('INSERT INTO facilities (owner_id, sport_id, name, hourly_rate, status) VALUES (?, ?, ?, ?, ?)');
            $insert->execute([$ownerId, $sportId, $name, $rate, !empty($body['active']) ? 'Active' : 'Inactive']);
            $facilityId = (int)$db->lastInsertId();
            $court = $db->prepare('INSERT INTO courts (facility_id, court_number, court_name) VALUES (?, ?, ?)');
            for ($number = 1; $number <= $courtCount; $number++) $court->execute([$facilityId, 'C' . $number, 'Court ' . $number]);
            $linkAmenity = $db->prepare('INSERT INTO facility_amenities (facility_id, amenity_id) VALUES (?, ?)');
            foreach ($amenityIds as $amenityId) $linkAmenity->execute([$facilityId, $amenityId]);
            replaceFacilityEquipment($db, $facilityId, $equipmentCatalog ?? []);
            saveFacilityPresentation($db, $facilityId, $appearance['image'], $appearance['color']);
            $db->commit();
        }
        respond(['data' => ['id' => $facilityId, 'name' => $name, 'sport' => $sport, 'hourlyRate' => $rate, 'courtCount' => $courtCount, 'active' => !empty($body['active']), 'ownerId' => $ownerId, ...$appearance]]);
    }
    if ($action === 'facilities.list' || $action === 'facilities.get' || $action === 'facilities.manage.list') {
        if ($action === 'facilities.manage.list') {
            $user = currentUser($db);
            if (!in_array($user['role'], ['Admin', 'Facility Owner'], true)) fail('Owner or administrator access is required.', 403);
        }
        $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
        if ($action === 'facilities.get' && !$id) fail('A valid facility id is required.', 422);
        $sql = "SELECT f.facility_id AS id, f.owner_id AS ownerId, owner.full_name AS ownerName, owner.email AS ownerEmail, f.name, COALESCE(s.name, 'Other') AS sport,
                       f.hourly_rate AS hourlyRate, f.status = 'Active' AS active, f.status AS listingStatus,
                       COUNT(DISTINCT c.court_id) AS courtCount,
                       GROUP_CONCAT(DISTINCT a.amenity_name ORDER BY a.amenity_name SEPARATOR ',') AS amenities
                FROM facilities f LEFT JOIN sports s ON s.sport_id = f.sport_id
                LEFT JOIN users owner ON owner.user_id = f.owner_id
                LEFT JOIN app_state removed ON removed.scope_key = CONCAT('facility:', f.facility_id) AND removed.state_key = 'facility.removal'
                LEFT JOIN courts c ON c.facility_id = f.facility_id AND c.is_active = 1
                LEFT JOIN facility_amenities fa ON fa.facility_id = f.facility_id
                LEFT JOIN amenities a ON a.amenity_id = fa.amenity_id
                WHERE removed.state_id IS NULL";
        $params = [];
        if ($action === 'facilities.manage.list' && $user['role'] === 'Facility Owner') {
            $sql .= ' AND f.owner_id = ?';
            $params[] = $user['id'];
        }
        if ($action !== 'facilities.manage.list') $sql .= " AND f.status IN ('Active', 'Inactive')";
        if ($action === 'facilities.get' && $id) {
            $sql .= ' AND f.facility_id = ?';
            $params[] = $id;
        }
        if ($action === 'facilities.list') {
            $category = trim((string)($_GET['category'] ?? 'All'));
            $queryText = trim((string)($_GET['query'] ?? ''));
            if ($category !== '' && $category !== 'All') {
                $sql .= ' AND s.name = ?';
                $params[] = $category;
            }
            if ($queryText !== '') {
                $sql .= ' AND (f.name LIKE ? OR s.name LIKE ?)';
                $searchPattern = '%' . $queryText . '%';
                $params[] = $searchPattern;
                $params[] = $searchPattern;
            }
        }
        $sql .= ' GROUP BY f.facility_id, s.name, owner.full_name, owner.email ORDER BY f.name';
        $query = $db->prepare($sql);
        $query->execute($params);
        $facilityRows = $query->fetchAll();
        $presentations = [];
        if ($facilityRows) {
            $scopes = array_map(static fn(array $facility): string => 'facility:' . (int)$facility['id'], $facilityRows);
            $scopePlaceholders = implode(',', array_fill(0, count($scopes), '?'));
            $presentationQuery = $db->prepare("SELECT scope_key, state_value FROM app_state WHERE state_key = 'facility.presentation' AND scope_key IN ($scopePlaceholders)");
            $presentationQuery->execute($scopes);
            foreach ($presentationQuery->fetchAll() as $presentationRow) {
                if (preg_match('/^facility:(\\d+)$/', $presentationRow['scope_key'], $scopeMatch)) {
                    $decoded = json_decode($presentationRow['state_value'], true);
                    if (is_array($decoded)) $presentations[(int)$scopeMatch[1]] = $decoded;
                }
            }
        }
        $facilities = array_map(static function (array $facility) use ($presentations): array {
            $facility['id'] = (int)$facility['id'];
            $facility['ownerId'] = $facility['ownerId'] === null ? null : (int)$facility['ownerId'];
            $facility['active'] = (bool)$facility['active'];
            $facility['hourlyRate'] = (float)$facility['hourlyRate'];
            $facility['price'] = '₱' . number_format((float)$facility['hourlyRate'], 2) . '/hr';
            $facility['courtCount'] = (int)$facility['courtCount'];
            $facility['availability'] = ($facility['courtCount'] * 14) . ' slots';
            $facility['amenities'] = $facility['amenities'] ? explode(',', $facility['amenities']) : [];
            $facility['equipmentRental'] = hasEquipmentRentalAmenity($facility['amenities']);
            $facility['location'] = '';
            $facility['rating'] = 0;
            $facility['reviews'] = 0;
            $presentation = $presentations[(int)$facility['id']] ?? [];
            $image = $presentation['image'] ?? null;
            $color = strtolower((string)($presentation['color'] ?? ''));
            $facility['image'] = is_string($image) ? $image : null;
            $facility['color'] = in_array($color, facilityColorOptions(), true) ? $color : defaultFacilityColor((int)$facility['id']);
            return $facility;
        }, $facilityRows);
        if ($action === 'facilities.get') {
            $facility = $facilities[0] ?? null;
            if (!$facility) fail('Facility not found.', 404);
            $facility['equipmentCategories'] = $facility['equipmentRental']
                ? readFacilityEquipmentCatalog($db, (int)$facility['id'])
                : [];
            respond(['data' => $facility]);
        }
        respond(['data' => $facilities]);
    }
    if ($action === 'facilities.remove') {
        $user = currentUser($db);
        if (!in_array($user['role'], ['Admin', 'Facility Owner'], true)) fail('Owner or administrator access is required.', 403);
        $facilityId = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        $reasonInput = $body['reason'] ?? null;
        if (!$facilityId || $facilityId < 1) fail('Choose a valid facility to remove.', 422);
        if (!is_string($reasonInput) || trim($reasonInput) === '') fail('Enter a reason for removing this facility.', 422);
        $reason = trim($reasonInput);
        $reasonLength = function_exists('mb_strlen') ? mb_strlen($reason) : strlen($reason);
        if ($reasonLength > 1000) fail('The removal reason must be 1,000 characters or fewer.', 422);

        $db->beginTransaction();
        try {
            $find = $db->prepare('SELECT facility_id, owner_id, name FROM facilities WHERE facility_id = ? FOR UPDATE');
            $find->execute([$facilityId]);
            $facility = $find->fetch();
            if (!$facility) throw new ApiException('Facility not found.', 404);
            if ($user['role'] === 'Facility Owner' && (int)$facility['owner_id'] !== (int)$user['id']) {
                throw new ApiException('You can only remove your own facilities.', 403);
            }

            $scope = 'facility:' . (int)$facility['facility_id'];
            $alreadyRemoved = $db->prepare("SELECT state_id FROM app_state WHERE scope_key = ? AND state_key = 'facility.removal' FOR UPDATE");
            $alreadyRemoved->execute([$scope]);
            if ($alreadyRemoved->fetchColumn()) throw new ApiException('This facility has already been removed.', 409);

            $removedAt = date(DATE_ATOM);
            $removalRecord = [
                'facilityId' => (int)$facility['facility_id'],
                'facilityName' => (string)$facility['name'],
                'reason' => $reason,
                'removedBy' => (int)$user['id'],
                'removedByName' => (string)$user['name'],
                'removedByRole' => (string)$user['role'],
                'removedAt' => $removedAt,
            ];
            $save = $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, NULL, 'facility.removal', ?)");
            $save->execute([$scope, json_encode($removalRecord, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);

            $notificationMessage = 'Facility "' . $facility['name'] . '" was removed by ' . $user['name'] . ' (' . $user['role'] . '). Reason: ' . $reason;
            foreach (['User', 'Admin', 'Facility Owner'] as $role) {
                storeRoleNotifications($db, $role, 'Facility removed', $notificationMessage);
            }
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }

        respond(['success' => true, 'data' => $removalRecord]);
    }
    if ($action === 'facilities.availability') {
        $facilityId = filter_var($_GET['facilityId'] ?? null, FILTER_VALIDATE_INT);
        $date = (string)($_GET['date'] ?? date('Y-m-d'));
        $manageSchedule = filter_var($_GET['manage'] ?? false, FILTER_VALIDATE_BOOLEAN);
        if (!$facilityId || !DateTime::createFromFormat('Y-m-d', $date)) fail('A valid facility and date are required.', 422);
        $listedFacility = $db->prepare("SELECT f.facility_id, f.status, f.owner_id FROM facilities f WHERE f.facility_id = ? AND f.status IN ('Active', 'Inactive') AND NOT EXISTS (SELECT 1 FROM app_state removed WHERE removed.scope_key = CONCAT('facility:', f.facility_id) AND removed.state_key = 'facility.removal')");
        $listedFacility->execute([$facilityId]);
        $facilityAvailability = $listedFacility->fetch();
        if (!$facilityAvailability) fail('The selected facility is no longer available.', 404);
        if ($manageSchedule) {
            $user = currentUser($db);
            if (!in_array($user['role'], ['Admin', 'Facility Owner'], true)) fail('Owner or administrator access is required.', 403);
            if ($user['role'] === 'Facility Owner' && (int)$facilityAvailability['owner_id'] !== (int)$user['id']) fail('You cannot edit this facility schedule.', 403);
        }
        $courtsQuery = $db->prepare('SELECT court_id, court_number, court_name FROM courts WHERE facility_id = ? AND is_active = 1 ORDER BY CAST(SUBSTRING(court_number, 2) AS UNSIGNED), court_id');
        $courtsQuery->execute([$facilityId]);
        $courts = $courtsQuery->fetchAll();
        $unavailableQuery = $db->prepare('SELECT us.court_id, us.slot_time, us.reason FROM court_unavailable_slots us JOIN courts c ON c.court_id = us.court_id WHERE c.facility_id = ? AND us.slot_date = ? AND us.slot_status = \'Unavailable\'');
        $unavailableQuery->execute([$facilityId, $date]);
        $unavailableSlots = [];
        foreach ($unavailableQuery->fetchAll() as $row) $unavailableSlots[$row['court_id'] . ':' . substr((string)$row['slot_time'], 0, 5)] = (string)($row['reason'] ?: 'Maintenance');
        $excludeReservationId = filter_var($_GET['excludeReservationId'] ?? null, FILTER_VALIDATE_INT) ?: 0;
        $reservationSql = "SELECT rc.court_id, COALESCE(rc.start_time, r.start_time) AS start_time, COALESCE(rc.end_time, r.end_time) AS end_time FROM reservation_courts rc JOIN reservations r ON r.reservation_id = rc.reservation_id WHERE r.facility_id = ? AND r.reservation_date = ? AND r.status IN ('Pending', 'Confirmed')";
        $reservationParams = [$facilityId, $date];
        if ($excludeReservationId > 0) {
            $reservationSql .= ' AND r.reservation_id <> ?';
            $reservationParams[] = $excludeReservationId;
        }
        $reservationQuery = $db->prepare($reservationSql);
        $reservationQuery->execute($reservationParams);
        $databaseIntervals = [];
        foreach ($reservationQuery->fetchAll() as $row) $databaseIntervals[$row['court_id']][] = [substr((string)$row['start_time'], 0, 5), substr((string)$row['end_time'], 0, 5)];
        $courtSlots = [];
        $slotStep = 60;
        foreach ($courts as $court) {
            $slots = [];
            $dateBlocked = true;
            $dateBlockReason = null;
            for ($blockedMinute = 8 * 60; $blockedMinute < 22 * 60; $blockedMinute += 30) {
                $blockedTime = sprintf('%02d:%02d', intdiv($blockedMinute, 60), $blockedMinute % 60);
                $blockedReason = $unavailableSlots[$court['court_id'] . ':' . $blockedTime] ?? null;
                if ($blockedReason === null) {
                    $dateBlocked = false;
                    break;
                }
                if ($dateBlockReason === null) $dateBlockReason = $blockedReason;
                elseif ($dateBlockReason !== $blockedReason) {
                    $dateBlocked = false;
                    break;
                }
            }
            for ($minute = 8 * 60; $minute < 22 * 60; $minute += $slotStep) {
                $endMinute = min($minute + $slotStep, 22 * 60);
                $start = sprintf('%02d:%02d:00', intdiv($minute, 60), $minute % 60);
                $end = sprintf('%02d:%02d:00', intdiv($endMinute, 60), $endMinute % 60);
                $sqlReserved = false;
                foreach ($databaseIntervals[$court['court_id']] ?? [] as [$reservationStart, $reservationEnd]) {
                    if ($reservationStart < substr($end, 0, 5) && $reservationEnd > substr($start, 0, 5)) {
                        $sqlReserved = true;
                        break;
                    }
                }
                $maintenanceReason = null;
                foreach ($unavailableSlots as $slotKey => $reason) {
                    [$unavailableCourtId, $unavailableTime] = explode(':', $slotKey, 2);
                    $unavailableMinute = ((int)substr($unavailableTime, 0, 2) * 60) + (int)substr($unavailableTime, 3, 2);
                    if ((int)$unavailableCourtId === (int)$court['court_id'] && $unavailableMinute >= $minute && $unavailableMinute < $endMinute) {
                        $maintenanceReason = $reason;
                        break;
                    }
                }
                $slots[] = [
                    'label' => sprintf('%02d:%02d', intdiv($minute, 60), $minute % 60),
                    'status' => $sqlReserved ? 'taken' : ($maintenanceReason !== null ? 'maintenance' : 'available'),
                    'reason' => $maintenanceReason,
                ];
            }
            $courtSlots[] = [
                'courtId' => (int)$court['court_id'],
                'courtNumber' => (int)preg_replace('/\D+/', '', $court['court_number']),
                'courtName' => $court['court_name'],
                'dateBlocked' => $dateBlocked,
                'dateBlockReason' => $dateBlocked ? $dateBlockReason : null,
                'slots' => $slots,
            ];
        }
        respond(['data' => ['facilityId' => $facilityId, 'date' => $date, 'active' => $facilityAvailability['status'] === 'Active', 'slotMinutes' => $slotStep, 'courtCount' => count($courtSlots), 'courts' => $courtSlots]]);
    }
    if ($action === 'dispute.created') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Only the customer who filed this dispute can submit it.', 403);
        $disputeId = trim((string)($body['id'] ?? ''));
        $reservationId = filter_var($body['reservationId'] ?? null, FILTER_VALIDATE_INT);
        if ($disputeId === '' || strlen($disputeId) > 50 || !$reservationId) fail('Dispute details are invalid.', 422);

        $db->beginTransaction();
        try {
            $scope = 'user:' . (int)$user['id'];
            [$disputeStateId, $disputes] = readStateCollection($db, $scope, 'disputes', true);
            $disputeIndex = null;
            foreach ($disputes as $index => $candidate) {
                if (is_array($candidate) && (string)($candidate['id'] ?? '') === $disputeId && (int)($candidate['reservationId'] ?? 0) === (int)$reservationId) {
                    $disputeIndex = $index;
                    break;
                }
            }
            if ($disputeIndex === null || !$disputeStateId) {
                $db->rollBack();
                fail('The saved dispute could not be verified.', 404);
            }
            $dispute = $disputes[$disputeIndex];
            foreach ($disputes as $existing) {
                if (is_array($existing) && (int)($existing['reservationId'] ?? 0) === (int)$reservationId &&
                    (string)($existing['id'] ?? '') !== $disputeId) {
                    $db->rollBack();
                    fail('A problem report has already been submitted for this reservation.', 409);
                }
            }
            $reservationQuery = $db->prepare("SELECT r.reservation_id, r.status, r.user_id, f.owner_id, f.name FROM reservations r JOIN facilities f ON f.facility_id = r.facility_id WHERE r.reservation_id = ? AND r.user_id = ? FOR UPDATE");
            $reservationQuery->execute([(int)$reservationId, (int)$user['id']]);
            $reservation = $reservationQuery->fetch();
            if (!$reservation || $reservation['status'] !== 'Completed') {
                $db->rollBack();
                fail('Only a completed reservation can be disputed.', 409);
            }
            $dispute['reservationSnapshot'] = disputeReservationSnapshot($db, (int)$reservationId);
            $dispute['ownerId'] = (int)$reservation['owner_id'];
            $dispute['userId'] = (int)$user['id'];
            if (!array_key_exists('ownerResponse', $dispute)) $dispute['ownerResponse'] = null;
            if (empty($dispute['ownerResponseStatus'])) $dispute['ownerResponseStatus'] = 'Awaiting owner response';

            $markerScope = 'dispute:' . $disputeId;
            $markerQuery = $db->prepare("SELECT state_id FROM app_state WHERE scope_key = ? AND state_key = 'dispute.created.notified' FOR UPDATE");
            $markerQuery->execute([$markerScope]);
            if ($markerQuery->fetchColumn()) {
                $db->commit();
                respond(['ok' => true, 'alreadyNotified' => true]);
            }
            $disputes[$disputeIndex] = $dispute;
            writeStateCollection($db, $scope, (int)$user['id'], 'disputes', $disputes);

            $databaseDispute = $db->prepare('SELECT dispute_id FROM disputes WHERE dispute_code = ? LIMIT 1 FOR UPDATE');
            $databaseDispute->execute([$disputeId]);
            if (!$databaseDispute->fetchColumn()) {
                $insertDispute = $db->prepare("INSERT INTO disputes (dispute_code, reservation_id, user_id, reason, details, status) VALUES (?, ?, ?, ?, ?, 'Open')");
                $insertDispute->execute([
                    $disputeId,
                    (int)$reservationId,
                    (int)$user['id'],
                    (string)($dispute['reason'] ?? 'Booking dispute'),
                    (string)($dispute['details'] ?? ''),
                ]);
            }

            $ownerLedgerQuery = $db->prepare("SELECT ledger_id, amount FROM financial_ledger_entries WHERE reservation_id = ? AND entry_type = 'owner_pending_balance' LIMIT 1 FOR UPDATE");
            $ownerLedgerQuery->execute([(int)$reservationId]);
            $ownerLedger = $ownerLedgerQuery->fetch();
            if ($ownerLedger) {
                $db->prepare("UPDATE financial_ledger_entries SET status = 'Held' WHERE ledger_id = ?")->execute([(int)$ownerLedger['ledger_id']]);
                writeFinancialLedgerEntry($db, ['idempotencyKey' => 'dispute:' . $disputeId . ':hold', 'type' => 'dispute_hold', 'reservationId' => (int)$reservationId, 'userId' => (int)$user['id'], 'ownerId' => (int)$reservation['owner_id'], 'amount' => (float)$ownerLedger['amount'], 'status' => 'Held', 'metadata' => ['disputeId' => $disputeId]]);
            }

            $summary = 'A dispute was submitted for reservation #' . (int)$reservationId . ' at ' . (string)$reservation['name'] . '. Reason: ' . (string)($dispute['reason'] ?? 'Booking issue') . '.';
            storeNotification($db, (int)$user['id'], 'Dispute submitted', 'Your dispute for reservation #' . (int)$reservationId . ' was submitted for review.');
            if (!empty($reservation['owner_id'])) storeNotification($db, (int)$reservation['owner_id'], 'New booking dispute', $summary);
            storeRoleNotifications($db, 'Admin', 'New booking dispute', $summary);
            writeStateCollection($db, $markerScope, null, 'dispute.created.notified', ['createdAt' => date(DATE_ATOM)]);
            $db->commit();
            respond(['ok' => true]);
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
    }
    if ($action === 'dispute.list') {
        $user = currentUser($db);
        respond(['data' => listDisputesForViewer($db, $user)]);
    }
    if ($action === 'dispute.details') {
        $user = currentUser($db);
        $id = trim((string)($_GET['id'] ?? ''));
        if ($id === '' || strlen($id) > 50) fail('Dispute id is invalid.', 422);
        $target = findDisputeRecordById($db, $id);
        if ($target === null) fail('Dispute not found or access denied.', 404);
        [$stateRow, , , $dispute] = $target;
        $reservationId = filter_var($dispute['reservationId'] ?? null, FILTER_VALIDATE_INT);
        $snapshot = $reservationId ? disputeReservationSnapshot($db, (int)$reservationId) : null;
        if (!$snapshot ||
            ($user['role'] === 'User' && (int)($stateRow['user_id'] ?? 0) !== (int)$user['id']) ||
            ($user['role'] === 'Facility Owner' && (int)($snapshot['ownerId'] ?? 0) !== (int)$user['id']) ||
            !in_array($user['role'], ['User', 'Facility Owner', 'Admin'], true)) fail('Dispute not found or access denied.', 404);
        $dispute['userId'] = (int)($stateRow['user_id'] ?? $dispute['userId'] ?? 0);
        $dispute['user'] = (string)$snapshot['user'];
        $dispute['ownerId'] = (int)($snapshot['ownerId'] ?? 0);
        $dispute['owner'] = (string)($snapshot['ownerName'] ?? 'Facility owner unavailable');
        $dispute['facility'] = (string)$snapshot['name'];
        $dispute['reservationSnapshot'] = $snapshot;
        $dispute['ownerResponseStatus'] = !empty($dispute['ownerResponse']['submittedAt']) ? 'Owner responded' : 'Awaiting owner response';
        $evidence = disputeEvidenceBySide($db, $id);
        $dispute['userEvidence'] = $evidence['user'];
        $dispute['ownerEvidence'] = $evidence['owner'];
        respond(['data' => $dispute]);
    }
    if ($action === 'dispute.evidence.add') {
        $user = currentUser($db);
        $id = trim((string)($body['id'] ?? ''));
        $side = (string)($body['side'] ?? '');
        $evidenceId = preg_replace('/[^A-Za-z0-9-]/', '', (string)($body['evidenceId'] ?? ''));
        $description = trim((string)($body['description'] ?? ''));
        $name = trim(basename((string)($body['name'] ?? 'proof.jpg')));
        if ($id === '' || strlen($id) > 50 || !in_array($side, ['user', 'owner'], true) || strlen($evidenceId) < 8 || strlen($evidenceId) > 48 || $description === '' || strlen($description) > 200) {
            fail('Proof attachment details are invalid. Add a short description and retry.', 422);
        }
        $image = validateDisputeEvidenceImage($body['image'] ?? null);
        $db->beginTransaction();
        try {
            $target = findDisputeRecordById($db, $id, true);
            if ($target === null) {
                $db->rollBack();
                fail('Dispute not found.', 404);
            }
            [$stateRow, $disputes, $index, $dispute] = $target;
            if (($dispute['status'] ?? '') !== 'Open') {
                $db->rollBack();
                fail('Attachments can only be added while the dispute is open.', 409);
            }
            $reservationId = (int)($dispute['reservationId'] ?? 0);
            $reservationQuery = $db->prepare('SELECT r.user_id, f.owner_id FROM reservations r JOIN facilities f ON f.facility_id = r.facility_id WHERE r.reservation_id = ? FOR UPDATE');
            $reservationQuery->execute([$reservationId]);
            $reservation = $reservationQuery->fetch();
            $belongsToSide = $reservation && ($side === 'user'
                ? $user['role'] === 'User' && (int)$reservation['user_id'] === (int)$user['id'] && (int)($stateRow['user_id'] ?? 0) === (int)$user['id'] && empty($dispute['ownerResponse']['submittedAt'])
                : $user['role'] === 'Facility Owner' && (int)$reservation['owner_id'] === (int)$user['id'] && empty($dispute['ownerResponse']['submittedAt']));
            if (!$belongsToSide) {
                $db->rollBack();
                fail('You cannot add evidence to this dispute.', 403);
            }
            $stateKey = 'evidence.' . $side . '.' . $evidenceId;
            $existing = $db->prepare('SELECT state_id FROM app_state WHERE scope_key = ? AND state_key = ? FOR UPDATE');
            $evidenceScope = 'dispute:' . $id;
            $existing->execute([$evidenceScope, $stateKey]);
            if ($existing->fetchColumn()) {
                $db->commit();
                respond(['data' => ['id' => $evidenceId, 'side' => $side, 'alreadySaved' => true]]);
            }
            $proof = [
                'id' => $evidenceId,
                'side' => $side,
                'name' => substr($name ?: 'proof.jpg', 0, 180),
                'description' => $description,
                'data' => $image,
                'uploadedBy' => (int)$user['id'],
                'createdAt' => date(DATE_ATOM),
            ];
            $save = $db->prepare('INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, ?, ?)');
            $save->execute([$evidenceScope, (int)$user['id'], $stateKey, json_encode($proof, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
            $db->commit();
            respond(['data' => ['id' => $evidenceId, 'side' => $side, 'saved' => true]]);
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
    }
    if ($action === 'owner.dispute.respond') {
        $user = currentUser($db);
        if ($user['role'] !== 'Facility Owner') fail('Only the facility owner can submit an owner response.', 403);
        $id = trim((string)($body['id'] ?? ''));
        $details = trim((string)($body['details'] ?? ''));
        if ($id === '' || strlen($id) > 50 || $details === '' || strlen($details) > 2000) fail('Write a response of up to 2,000 characters before submitting.', 422);
        $db->beginTransaction();
        try {
            $target = findDisputeRecordById($db, $id, true);
            if ($target === null) {
                $db->rollBack();
                fail('Dispute not found.', 404);
            }
            [$stateRow, $disputes, $index, $dispute] = $target;
            if (($dispute['status'] ?? '') !== 'Open') {
                $db->rollBack();
                fail('This dispute is no longer open.', 409);
            }
            if (!empty($dispute['ownerResponse']['submittedAt'])) {
                $db->rollBack();
                fail('An owner response has already been submitted for this dispute.', 409);
            }
            $reservationId = (int)($dispute['reservationId'] ?? 0);
            $ownerCheck = $db->prepare('SELECT r.user_id, f.owner_id, f.name FROM reservations r JOIN facilities f ON f.facility_id = r.facility_id WHERE r.reservation_id = ? FOR UPDATE');
            $ownerCheck->execute([$reservationId]);
            $reservation = $ownerCheck->fetch();
            if (!$reservation || (int)$reservation['owner_id'] !== (int)$user['id']) {
                $db->rollBack();
                fail('This dispute does not belong to one of your facilities.', 403);
            }
            $response = ['details' => $details, 'submittedAt' => date(DATE_ATOM), 'ownerId' => (int)$user['id'], 'ownerName' => (string)$user['name']];
            $dispute['ownerResponse'] = $response;
            $dispute['ownerResponseStatus'] = 'Owner responded';
            $disputes[$index] = $dispute;
            $save = $db->prepare('UPDATE app_state SET state_value = ?, updated_at = CURRENT_TIMESTAMP WHERE state_id = ?');
            $save->execute([json_encode($disputes, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), (int)$stateRow['state_id']]);
            $message = 'The facility owner responded to your dispute for reservation #' . $reservationId . ' at ' . $reservation['name'] . '. The administrator can now review both sides.';
            storeNotification($db, (int)$reservation['user_id'], 'Facility owner responded to dispute', $message . ' Owner response: ' . $details);
            storeRoleNotifications($db, 'Admin', 'Owner response submitted', 'The owner responded to dispute ' . $id . ' for reservation #' . $reservationId . '. Review both sides before recording a resolution.');
            $db->commit();
            respond(['data' => $dispute]);
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
    }
    if (str_starts_with($action, 'admin.')) {
        $user = currentUser($db);
        if ($user['role'] !== 'Admin') fail('Administrator access is required.', 403);
        if ($action === 'admin.disputes.list') {
            respond(['data' => listDisputesForViewer($db, $user)]);
        }
        if ($action === 'admin.promos.list') {
            [, $promos] = readPromoCodes($db);
            respond(['data' => $promos]);
        }
        if ($action === 'admin.promos.generate') {
            $discountType = trim((string)($body['discountType'] ?? ''));
            $value = is_numeric($body['value'] ?? null) ? round((float)$body['value'], 2) : -1;
            $minimumBooking = is_numeric($body['minimumBooking'] ?? null) ? round((float)$body['minimumBooking'], 2) : -1;
            $usageLimit = filter_var($body['usageLimit'] ?? null, FILTER_VALIDATE_INT);
            if (!in_array($discountType, ['percent', 'fixed', 'fee-waived'], true) ||
                $minimumBooking < 0 || !$usageLimit || $usageLimit < 1 || $usageLimit > 1000000 ||
                ($discountType === 'percent' && ($value <= 0 || $value > 100)) ||
                ($discountType === 'fixed' && $value <= 0) ||
                ($discountType === 'fee-waived' && abs($value) > 0.001)) {
                fail('Enter a valid discount type, value, minimum booking, and positive usage limit.', 422);
            }
            $namedLock = $db->prepare("SELECT GET_LOCK('reserva_promo_codes', 5)");
            $namedLock->execute();
            if ((int)$namedLock->fetchColumn() !== 1) fail('Promo code generation is busy. Please retry.', 503);
            try {
                $db->beginTransaction();
                try {
                    [$stateId, $promos] = readPromoCodes($db, true);
                    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                    $code = '';
                    for ($attempt = 0; $attempt < 10; $attempt++) {
                        $candidate = 'RSV';
                        for ($index = 0; $index < 8; $index++) $candidate .= $alphabet[random_int(0, strlen($alphabet) - 1)];
                        if (!findPromoCode($promos, $candidate)) { $code = $candidate; break; }
                    }
                    if ($code === '') throw new ApiException('A unique promo code could not be generated. Please retry.', 503);
                    $promo = [
                        'id' => 'PROMO-' . strtoupper(bin2hex(random_bytes(6))),
                        'code' => $code,
                        'discountType' => $discountType,
                        'value' => $discountType === 'fee-waived' ? 0 : $value,
                        'minimumBooking' => $minimumBooking,
                        'usageLimit' => (int)$usageLimit,
                        'usedCount' => 0,
                        'active' => true,
                        'createdAt' => date(DATE_ATOM),
                        'createdBy' => (int)$user['id'],
                    ];
                    array_unshift($promos, $promo);
                    savePromoCodes($db, $stateId, $promos);
                    $db->commit();
                } catch (Throwable $error) {
                    if ($db->inTransaction()) $db->rollBack();
                    throw $error;
                }
            } finally {
                $db->query("SELECT RELEASE_LOCK('reserva_promo_codes')");
            }
            respond(['data' => $promo], 201);
        }
        if ($action === 'admin.users.list') {
            $query = $db->query("SELECT u.user_id AS id, u.full_name AS name, u.email, u.account_status AS status, u.created_at AS joinedAt, CASE WHEN r.role_name = 'Facility Owner' THEN 'Facility owner' ELSE r.role_name END AS role FROM users u LEFT JOIN roles r ON r.role_id = u.role_id ORDER BY u.user_id DESC");
            respond(['data' => $query->fetchAll()]);
        }
        if ($action === 'admin.payments.list') {
            $query = $db->query("SELECT p.payment_id AS id, r.reservation_id AS reservationId, u.full_name AS customer, COALESCE(f.name, 'Facility unavailable') AS facility, COALESCE(pm.method_name, 'Not recorded') AS method, p.amount, p.payment_type AS paymentType, CASE LOWER(p.payment_status) WHEN 'paid' THEN 'Paid' WHEN 'pending' THEN 'Pending' WHEN 'failed' THEN 'Failed' WHEN 'refunded' THEN 'Refunded' WHEN 'held' THEN 'Held' WHEN 'released' THEN 'Released' WHEN 'partially_refunded' THEN 'Partially refunded' ELSE p.payment_status END AS status, p.transaction_reference AS reference, COALESCE(p.paid_at, p.created_at) AS date, EXISTS (SELECT 1 FROM app_state proof WHERE proof.scope_key = CONCAT('payment:', p.payment_id) AND proof.state_key = 'payment.proof') AS hasProof, EXISTS (SELECT 1 FROM app_state refundProof WHERE refundProof.scope_key = CONCAT('payment:', p.payment_id) AND refundProof.state_key = 'payment.refund.proof') AS hasRefundProof FROM payments p JOIN reservations r ON r.reservation_id = p.reservation_id JOIN users u ON u.user_id = r.user_id LEFT JOIN facilities f ON f.facility_id = r.facility_id LEFT JOIN payment_methods pm ON pm.method_id = p.method_id ORDER BY COALESCE(p.created_at, p.paid_at) DESC, p.payment_id DESC");
            respond(['data' => $query->fetchAll()]);
        }
        if ($action === 'admin.payout.accounts.list') {
            $rows = $db->query("SELECT s.user_id, s.state_value, u.full_name AS ownerName, u.email AS ownerEmail FROM app_state s JOIN users u ON u.user_id = s.user_id WHERE s.state_key = 'owner.payoutAccounts' ORDER BY s.updated_at DESC")->fetchAll();
            $accounts = [];
            foreach ($rows as $row) {
                $savedAccounts = json_decode((string)$row['state_value'], true);
                if (!is_array($savedAccounts)) continue;
                foreach ($savedAccounts as $account) {
                    if (!is_array($account)) continue;
                    $status = (string)($account['verificationStatus'] ?? (!empty($account['verified']) ? 'Verified' : 'Pending review'));
                    $accounts[] = [...$account, 'ownerId' => (int)$row['user_id'], 'ownerName' => $row['ownerName'], 'ownerEmail' => $row['ownerEmail'], 'verificationStatus' => $status];
                }
            }
            respond(['data' => $accounts]);
        }
        if ($action === 'admin.payout.account.update') {
            $id = trim((string)($body['id'] ?? ''));
            $status = (string)($body['status'] ?? '');
            $note = trim((string)($body['note'] ?? ''));
            if ($id === '' || !in_array($status, ['Verified', 'Rejected'], true) || $note === '' || strlen($note) > 500) {
                fail('Choose approve or reject and add a review note.', 422);
            }
            $db->beginTransaction();
            try {
                $rows = $db->query("SELECT state_id, user_id, state_value FROM app_state WHERE state_key = 'owner.payoutAccounts' FOR UPDATE")->fetchAll();
                $matched = null;
                foreach ($rows as $row) {
                    $accounts = json_decode((string)$row['state_value'], true);
                    if (!is_array($accounts)) continue;
                    foreach ($accounts as $index => $account) {
                        if (!is_array($account) || (string)($account['id'] ?? '') !== $id) continue;
                        if (!empty($account['verified']) || ($account['verificationStatus'] ?? 'Pending review') !== 'Pending review') {
                            $db->rollBack();
                            fail('This payout destination has already been reviewed.', 409);
                        }
                        $account['verified'] = $status === 'Verified';
                        $account['verificationStatus'] = $status;
                        $account['reviewNote'] = $note;
                        $account['reviewedAt'] = date(DATE_ATOM);
                        $account['reviewedBy'] = (int)$user['id'];
                        $accounts[$index] = $account;
                        $save = $db->prepare('UPDATE app_state SET state_value = ?, updated_at = CURRENT_TIMESTAMP WHERE state_id = ?');
                        $save->execute([json_encode($accounts, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), (int)$row['state_id']]);
                        $matched = [...$account, 'ownerId' => (int)$row['user_id']];
                        break 2;
                    }
                }
                if ($matched === null) {
                    $db->rollBack();
                    fail('Payout destination request not found.', 404);
                }
                $title = $status === 'Verified' ? 'Payout destination approved' : 'Payout destination rejected';
                $message = $status === 'Verified'
                    ? 'Your ' . $matched['type'] . ' payout destination ending in ' . substr((string)$matched['number'], -4) . ' was approved. ' . $note
                    : 'Your ' . $matched['type'] . ' payout destination ending in ' . substr((string)$matched['number'], -4) . ' was rejected. ' . $note;
                storeNotification($db, (int)$matched['ownerId'], $title, $message);
                $auditQuery = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = 'global' AND state_key = 'admin.auditLog' LIMIT 1 FOR UPDATE");
                $auditQuery->execute();
                $auditRow = $auditQuery->fetch();
                $auditEntries = $auditRow ? json_decode((string)$auditRow['state_value'], true) : [];
                if (!is_array($auditEntries)) $auditEntries = [];
                array_unshift($auditEntries, [
                    'id' => 'AUD-' . strtoupper(bin2hex(random_bytes(8))),
                    'action' => $status === 'Verified' ? 'payout-account-approved' : 'payout-account-rejected',
                    'actor' => $user['name'],
                    'targetId' => $id,
                    'note' => $note,
                    'details' => ['ownerId' => (int)$matched['ownerId'], 'type' => $matched['type'], 'lastFour' => substr((string)$matched['number'], -4), 'status' => $status],
                    'createdAt' => date(DATE_ATOM),
                ]);
                $auditJson = json_encode(array_slice($auditEntries, 0, 500), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                if ($auditRow) {
                    $db->prepare('UPDATE app_state SET state_value = ?, updated_at = CURRENT_TIMESTAMP WHERE state_id = ?')->execute([$auditJson, (int)$auditRow['state_id']]);
                } else {
                    $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES ('global', NULL, 'admin.auditLog', ?)")->execute([$auditJson]);
                }
                $db->commit();
                respond(['data' => $matched]);
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
        }
        if ($action === 'admin.user.status') {
            $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
            $status = $body['status'] ?? '';
            if (!$id || !in_array($status, ['Active', 'Suspended'], true)) fail('A valid user and status are required.', 422);
            $update = $db->prepare('UPDATE users SET account_status = ? WHERE user_id = ?');
            $update->execute([$status, $id]);
            respond(['ok' => true]);
        }
        if ($action === 'admin.application.review') {
            $id = (string)($body['id'] ?? '');
            $status = (string)($body['status'] ?? '');
            if ($id === '' || !in_array($status, ['Approved', 'Needs changes', 'Rejected'], true)) fail('Application decision is invalid.', 422);
            $note = trim((string)($body['reviewNote'] ?? ''));
            if ($status === 'Needs changes' && $note === '') fail('Add a note explaining what the applicant should update.', 422);
            $db->beginTransaction();
            try {
                $rows = $db->query("SELECT state_id, user_id, state_value FROM app_state WHERE state_key = 'owner.application' FOR UPDATE")->fetchAll();
                $target = null;
                foreach ($rows as $row) {
                    $candidate = json_decode($row['state_value'], true);
                    if (is_array($candidate) && ($candidate['id'] ?? '') === $id) {
                        $target = [$row, $candidate];
                        break;
                    }
                }
                if ($target === null) {
                    $db->rollBack();
                    fail('Facility application not found.', 404);
                }
                [$row, $application] = $target;
                $currentStatus = (string)($application['status'] ?? '');
                if ($currentStatus === 'Approved' && $status === 'Approved') {
                    $db->commit();
                    respond(['data' => $application]);
                }
                $legacyIncompleteApproval = $currentStatus === 'Approved' && empty($application['facilityId']) && empty($application['detailsComplete']);
                if (!in_array($currentStatus, ['Pending review', 'Needs changes'], true) &&
                    !($legacyIncompleteApproval && $status === 'Needs changes')) {
                    $db->rollBack();
                    fail('This application can no longer be reviewed.', 409);
                }
                if ($status === 'Approved') {
                    if (empty($application['detailsComplete'])) {
                        $db->rollBack();
                        fail('The application is missing required owner, business, or facility details.', 422);
                    }
                    $ownerCheck = $db->prepare("SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ? AND r.role_name = 'Facility Owner' AND u.account_status = 'Active' LIMIT 1");
                    $ownerCheck->execute([(int)$row['user_id']]);
                    if (!$ownerCheck->fetchColumn()) {
                        $db->rollBack();
                        fail('The facility owner account is unavailable.', 409);
                    }
                    $facilities = $application['facilities'] ?? [$application['facility'] ?? []];
                    if (!is_array($facilities) || !$facilities || count($facilities) > 20) {
                        $db->rollBack();
                        fail('The application must contain between 1 and 20 facility listings.', 422);
                    }
                    $facilityIds = [];
                    $sportQuery = $db->prepare('SELECT sport_id FROM sports WHERE name = ? LIMIT 1');
                    $insertFacility = $db->prepare("INSERT INTO facilities (owner_id, sport_id, name, hourly_rate, status) VALUES (?, ?, ?, ?, 'Active')");
                    $insertCourt = $db->prepare('INSERT INTO courts (facility_id, court_number, court_name) VALUES (?, ?, ?)');
                    $amenityQuery = $db->prepare('SELECT amenity_id FROM amenities WHERE amenity_name = ? LIMIT 1');
                    $insertAmenity = $db->prepare('INSERT INTO facility_amenities (facility_id, amenity_id) VALUES (?, ?)');
                    $facilityColors = facilityColorOptions();
                    foreach ($facilities as $facility) {
                        if (!is_array($facility)) {
                            $db->rollBack();
                            fail('A facility listing contains invalid details.', 422);
                        }
                        $facilityName = trim((string)($facility['name'] ?? ''));
                        $sportQuery->execute([(string)($facility['sport'] ?? '')]);
                        $sportId = (int)$sportQuery->fetchColumn();
                        $courtCount = filter_var($facility['courtCount'] ?? null, FILTER_VALIDATE_INT);
                        $hourlyRate = $facility['hourlyRate'] ?? null;
                        $amenities = $facility['amenities'] ?? [];
                        if (!$sportId || $facilityName === '' || strlen($facilityName) > 150 || !$courtCount || $courtCount < 1 || $courtCount > 20 || !is_numeric($hourlyRate) || (float)$hourlyRate <= 0 || !is_array($amenities)) {
                            $db->rollBack();
                            fail('A facility listing is invalid or its sport is no longer available.', 422);
                        }
                        $insertFacility->execute([(int)$row['user_id'], $sportId, $facilityName, (float)$hourlyRate]);
                        $facilityId = (int)$db->lastInsertId();
                        $facilityIds[] = $facilityId;
                        $facilityImage = validateFacilityImage($facility['image'] ?? null);
                        saveFacilityPresentation($db, $facilityId, $facilityImage, $facilityColors[random_int(0, count($facilityColors) - 1)]);
                        for ($number = 1; $number <= $courtCount; $number++) {
                            $insertCourt->execute([$facilityId, 'C' . $number, 'Court ' . $number]);
                        }
                        foreach ($amenities as $amenityName) {
                            if (!is_string($amenityName)) {
                                $db->rollBack();
                                fail('An application amenity is invalid.', 422);
                            }
                            $amenityQuery->execute([$amenityName]);
                            $amenityId = $amenityQuery->fetchColumn();
                            if (!$amenityId) {
                                $db->rollBack();
                                fail('An application amenity is no longer available.', 422);
                            }
                            $insertAmenity->execute([$facilityId, (int)$amenityId]);
                        }
                        $equipmentCatalog = hasEquipmentRentalAmenity($amenities)
                            ? normalizeEquipmentCatalog($facility['equipmentCategories'] ?? [])
                            : [];
                        replaceFacilityEquipment($db, $facilityId, $equipmentCatalog);
                    }
                    $application['facilities'] = $facilities;
                    $application['facility'] = $facilities[0];
                    $application['facilityIds'] = $facilityIds;
                    $application['facilityId'] = $facilityIds[0];
                }
                $application['status'] = $status;
                $application['reviewNote'] = $note;
                $application['reviewedAt'] = date(DATE_ATOM);
                $save = $db->prepare('UPDATE app_state SET state_value = ? WHERE state_id = ?');
                $save->execute([json_encode($application, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $row['state_id']]);
                storeNotification(
                    $db,
                    (int)$row['user_id'],
                    'Facility owner application updated',
                    'Your application status is ' . $status . ($note !== '' ? '. ' . $note : '.'),
                );
                $auditQuery = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = 'global' AND state_key = 'admin.auditLog' LIMIT 1 FOR UPDATE");
                $auditQuery->execute();
                $auditRow = $auditQuery->fetch();
                $auditEntries = $auditRow ? json_decode($auditRow['state_value'], true) : [];
                if (!is_array($auditEntries)) $auditEntries = [];
                array_unshift($auditEntries, [
                    'id' => 'AUD-' . strtoupper(bin2hex(random_bytes(8))),
                    'action' => 'application-reviewed',
                    'actor' => $user['name'],
                    'targetId' => $id,
                    'note' => $note !== '' ? $note : $status,
                    'details' => ['status' => $status],
                    'createdAt' => date(DATE_ATOM),
                ]);
                $auditEntries = array_slice($auditEntries, 0, 500);
                $auditJson = json_encode($auditEntries, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                if ($auditRow) {
                    $saveAudit = $db->prepare('UPDATE app_state SET state_value = ?, updated_at = CURRENT_TIMESTAMP WHERE state_id = ?');
                    $saveAudit->execute([$auditJson, $auditRow['state_id']]);
                } else {
                    $saveAudit = $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES ('global', NULL, 'admin.auditLog', ?)");
                    $saveAudit->execute([$auditJson]);
                }
                $db->commit();
                respond(['data' => $application]);
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
        }
        if ($action === 'admin.payout.update') {
            $id = (string)($body['id'] ?? '');
            $status = (string)($body['status'] ?? '');
            $reason = trim((string)($body['reason'] ?? ''));
            $adminNote = trim((string)($body['note'] ?? ''));
            $reference = trim((string)($body['reference'] ?? ''));
            if ($id === '' || !in_array($status, ['Processing', 'Paid', 'Failed'], true) || $adminNote === '' || strlen($adminNote) > 500 || strlen($reference) > 150) fail('Payout update is invalid.', 422);
            $db->beginTransaction();
            try {
                $rows = $db->prepare("SELECT state_id, user_id, state_value FROM app_state WHERE state_key = 'owner.payouts' FOR UPDATE");
                $rows->execute();
                foreach ($rows->fetchAll() as $row) {
                    $payouts = json_decode($row['state_value'], true);
                    if (!is_array($payouts)) continue;
                    foreach ($payouts as $index => $payout) {
                        if ((string)($payout['id'] ?? '') !== $id) continue;
                        $current = $payout['status'] ?? '';
                        $valid = $status === 'Processing' && $current === 'Requested' || $status === 'Paid' && $current === 'Processing' || $status === 'Failed' && in_array($current, ['Requested', 'Processing'], true);
                        if (!$valid || $status === 'Failed' && $reason === '') fail('Payout status transition is invalid.', 409);
                        $updatedPayout = [...$payout, 'status' => $status, 'reason' => $status === 'Failed' ? $reason : '', 'updatedAt' => date(DATE_ATOM)];
                        if ($status === 'Paid' && $reference !== '') $updatedPayout['reference'] = $reference;
                        $payouts[$index] = $updatedPayout;
                        $save = $db->prepare('UPDATE app_state SET state_value = ? WHERE state_id = ?');
                        $save->execute([json_encode($payouts, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $row['state_id']]);
                        $ownerId = (int)($payout['ownerId'] ?? $row['user_id'] ?? 0);
                        $amount = round((float)($payout['amount'] ?? 0), 2);
                        if ($ownerId && $amount > 0) {
                            if ($status === 'Processing') {
                                writeFinancialLedgerEntry($db, ['idempotencyKey' => 'payout:' . $id . ':hold', 'type' => 'payout_hold', 'ownerId' => $ownerId, 'amount' => $amount, 'status' => 'Held', 'metadata' => ['payoutId' => $id, 'destination' => $payout['destination'] ?? null]]);
                            } elseif ($status === 'Paid') {
                                $db->prepare("UPDATE financial_ledger_entries SET status = 'Released' WHERE idempotency_key = ? AND status = 'Held'")->execute(['payout:' . $id . ':hold']);
                                writeFinancialLedgerEntry($db, ['idempotencyKey' => 'payout:' . $id . ':paid', 'type' => 'payout', 'ownerId' => $ownerId, 'amount' => $amount, 'status' => 'Paid', 'reference' => $updatedPayout['reference'] ?? null, 'metadata' => ['payoutId' => $id, 'fee' => (float)($payout['fee'] ?? 0), 'net' => (float)($payout['net'] ?? 0), 'destination' => $payout['destination'] ?? null]]);
                            } elseif ($status === 'Failed') {
                                $db->prepare("UPDATE financial_ledger_entries SET status = 'Released' WHERE idempotency_key = ? AND status = 'Held'")->execute(['payout:' . $id . ':hold']);
                                writeFinancialLedgerEntry($db, ['idempotencyKey' => 'payout:' . $id . ':release', 'type' => 'payout_release', 'ownerId' => $ownerId, 'amount' => $amount, 'status' => 'Released', 'metadata' => ['payoutId' => $id, 'reason' => $reason]]);
                            }
                        }
                        if ($ownerId > 0) {
                            $notification = match ($status) {
                                'Processing' => ['Withdrawal processing', 'Your withdrawal request for ' . number_format($amount, 2) . ' has been approved and is being processed.'],
                                'Paid' => ['Withdrawal marked paid', 'Your withdrawal of ' . number_format((float)($payout['net'] ?? $amount), 2) . ' was marked paid.' . ($reference !== '' ? ' Transfer reference: ' . $reference . '.' : '')],
                                default => ['Withdrawal failed', 'Your withdrawal request failed. ' . $reason . ' The amount less the withdrawal fee has been returned to your available balance.'],
                            };
                            storeNotification($db, $ownerId, $notification[0], $notification[1]);
                        }
                        $auditQuery = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = 'global' AND state_key = 'admin.auditLog' LIMIT 1 FOR UPDATE");
                        $auditQuery->execute();
                        $auditRow = $auditQuery->fetch();
                        $auditEntries = $auditRow ? json_decode((string)$auditRow['state_value'], true) : [];
                        if (!is_array($auditEntries)) $auditEntries = [];
                        $auditAction = $status === 'Processing' ? 'payout-approved' : ($status === 'Paid' ? 'payout-marked-paid' : ($current === 'Requested' ? 'payout-rejected' : 'payout-marked-failed'));
                        array_unshift($auditEntries, [
                            'id' => 'AUD-' . strtoupper(bin2hex(random_bytes(8))),
                            'action' => $auditAction,
                            'actor' => $user['name'],
                            'targetId' => $id,
                            'note' => $adminNote,
                            'details' => ['payoutId' => $id, 'ownerId' => $ownerId, 'amount' => $amount, 'status' => $status, 'reference' => $updatedPayout['reference'] ?? ''],
                            'createdAt' => date(DATE_ATOM),
                        ]);
                        $auditJson = json_encode(array_slice($auditEntries, 0, 500), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                        if ($auditRow) {
                            $db->prepare('UPDATE app_state SET state_value = ?, updated_at = CURRENT_TIMESTAMP WHERE state_id = ?')->execute([$auditJson, (int)$auditRow['state_id']]);
                        } else {
                            $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES ('global', NULL, 'admin.auditLog', ?)")->execute([$auditJson]);
                        }
                        $db->commit();
                        respond(['data' => $updatedPayout]);
                    }
                }
                $db->rollBack();
                fail('Payout request not found.', 404);
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
        }
        if ($action === 'admin.dispute.resolve') {
            $id = (string)($body['id'] ?? '');
            $resolution = (string)($body['resolution'] ?? '');
            $note = trim((string)($body['note'] ?? ''));
            if ($id === '' || $note === '' || strlen($note) > 1000 || !in_array($resolution, ['full-refund', 'partial-refund', 'reject'], true)) fail('Dispute resolution is invalid.', 422);
            $db->beginTransaction();
            try {
                $rows = $db->query("SELECT state_id, scope_key, user_id, state_value FROM app_state WHERE state_key = 'disputes' FOR UPDATE")->fetchAll();
                $target = null;
                foreach ($rows as $row) {
                    $items = json_decode((string)$row['state_value'], true);
                    if (!is_array($items)) continue;
                    foreach ($items as $index => $item) {
                        if (is_array($item) && (string)($item['id'] ?? '') === $id) {
                            $target = [$row, $items, $index, $item];
                            break 2;
                        }
                    }
                }
                if ($target === null) {
                    $db->rollBack();
                    fail('Dispute not found.', 404);
                }
                [$stateRow, $disputes, $index, $dispute] = $target;
                if (($dispute['status'] ?? '') !== 'Open') {
                    $db->rollBack();
                    fail('This dispute has already been resolved.', 409);
                }
                if (empty($dispute['ownerResponse']['submittedAt']) || trim((string)($dispute['ownerResponse']['details'] ?? '')) === '') {
                    $db->rollBack();
                    fail('The facility owner must submit their response before an administrator can resolve this dispute.', 409);
                }
                $reservationId = filter_var($dispute['reservationId'] ?? null, FILTER_VALIDATE_INT);
                $userId = filter_var($dispute['userId'] ?? $stateRow['user_id'] ?? null, FILTER_VALIDATE_INT);
                if (!$reservationId || !$userId) {
                    $db->rollBack();
                    fail('The dispute is missing its reservation or customer reference.', 409);
                }
                $reservationQuery = $db->prepare('SELECT r.reservation_id, r.user_id, r.total_amount, r.completed_at, f.owner_id, f.name FROM reservations r LEFT JOIN facilities f ON f.facility_id = r.facility_id WHERE r.reservation_id = ? AND r.user_id = ? FOR UPDATE');
                $reservationQuery->execute([(int)$reservationId, (int)$userId]);
                $reservation = $reservationQuery->fetch();
                if (!$reservation) {
                    $db->rollBack();
                    fail('The reservation linked to this dispute no longer exists.', 404);
                }
                $ownerId = $reservation['owner_id'] === null ? null : (int)$reservation['owner_id'];
                $paidQuery = $db->prepare("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE reservation_id = ? AND LOWER(payment_status) = 'paid'");
                $paidQuery->execute([(int)$reservationId]);
                $paidTotal = round((float)$paidQuery->fetchColumn(), 2);
                $alreadyRefunded = recordedRefundTotal($db, (int)$reservationId);
                $refundable = round(max(0, $paidTotal - $alreadyRefunded), 2);
                $refundAmount = 0.0;
                if ($resolution === 'full-refund') {
                    $refundAmount = $refundable;
                } elseif ($resolution === 'partial-refund') {
                    if (!is_numeric($body['amount'] ?? null)) {
                        $db->rollBack();
                        fail('Enter a valid partial refund amount.', 422);
                    }
                    $refundAmount = round((float)$body['amount'], 2);
                    if ($refundAmount <= 0 || $refundAmount > $refundable) {
                        $db->rollBack();
                        fail('The refund must be greater than zero and cannot exceed the remaining paid amount of ₱' . number_format($refundable, 2) . '.', 422);
                    }
                }
                if (in_array($resolution, ['full-refund', 'partial-refund'], true) && $refundAmount <= 0) {
                    $db->rollBack();
                    fail('No refundable paid amount remains for this reservation.', 409);
                }

                writeFinancialLedgerEntry($db, [
                    'idempotencyKey' => 'dispute:' . $id . ':resolution',
                    'type' => 'dispute_resolution',
                    'reservationId' => (int)$reservationId,
                    'userId' => (int)$userId,
                    'ownerId' => $ownerId,
                    'amount' => 0,
                    'status' => $resolution === 'reject' ? 'Rejected' : 'Refund approved',
                    'metadata' => ['disputeId' => $id, 'resolution' => $resolution, 'refundAmount' => $refundAmount, 'note' => $note],
                ]);

                $resolvedAt = date(DATE_ATOM);
                $refund = null;
                if ($refundAmount > 0) {
                    $refundId = 'REF-' . $id;
                    $refund = [
                        'id' => $refundId,
                        'refundId' => $refundId,
                        'type' => 'refund',
                        'reservationId' => (int)$reservationId,
                        'userId' => (int)$userId,
                        'ownerId' => $ownerId,
                        'disputeId' => $id,
                        'totalRefunded' => $refundAmount,
                        'amount' => $refundAmount,
                        'status' => 'pending',
                        'resolution' => $resolution,
                        'reason' => $note,
                        'createdAt' => $resolvedAt,
                    ];
                    if ($ownerId !== null) {
                        [$ownerRefundStateId, $ownerRefunds] = readStateCollection($db, 'user:' . $ownerId, 'owner.refunds', true);
                        if (array_filter($ownerRefunds, static fn(mixed $item): bool => is_array($item) && (string)($item['refundId'] ?? $item['id'] ?? '') === $refundId)) {
                            $db->rollBack();
                            fail('This dispute already has a refund record.', 409);
                        }
                        array_unshift($ownerRefunds, $refund);
                        writeStateCollection($db, 'user:' . $ownerId, $ownerId, 'owner.refunds', $ownerRefunds);

                        [$earningStateId, $earnings] = readStateCollection($db, 'user:' . $ownerId, 'owner.earnings', true);
                        $earningChanged = false;
                        foreach ($earnings as $earningIndex => $earning) {
                            if (!is_array($earning) || (string)($earning['reservationId'] ?? '') !== (string)$reservationId) continue;
                            $earnings[$earningIndex]['refundedAmount'] = round((float)($earning['refundedAmount'] ?? 0) + $refundAmount, 2);
                            $earnings[$earningIndex]['refundStatus'] = 'pending';
                            $earnings[$earningIndex]['refundId'] = $refundId;
                            $earningChanged = true;
                        }
                        if ($earningChanged) writeStateCollection($db, 'user:' . $ownerId, $ownerId, 'owner.earnings', $earnings);
                    }

                    writeFinancialLedgerEntry($db, [
                        'idempotencyKey' => 'refund:' . $refundId,
                        'type' => 'refund',
                        'reservationId' => (int)$reservationId,
                        'userId' => (int)$userId,
                        'ownerId' => $ownerId,
                        'amount' => $refundAmount,
                        'status' => 'Pending processing',
                        'metadata' => ['disputeId' => $id, 'resolution' => $resolution, 'reason' => $note],
                    ]);

                    [$paymentStateId, $payments] = readStateCollection($db, 'global', 'payments', true);
                    array_unshift($payments, $refund);
                    writeStateCollection($db, 'global', null, 'payments', $payments);
                } elseif ($ownerId !== null) {
                    [$earningStateId, $earnings] = readStateCollection($db, 'user:' . $ownerId, 'owner.earnings', true);
                    $earningChanged = false;
                    foreach ($earnings as $earningIndex => $earning) {
                        if (!is_array($earning) || (string)($earning['reservationId'] ?? '') !== (string)$reservationId) continue;
                        if (($earning['reservationStatus'] ?? '') === 'Disputed') {
                            $earnings[$earningIndex]['reservationStatus'] = 'Completed';
                            $earningChanged = true;
                        }
                    }
                    if ($earningChanged) writeStateCollection($db, 'user:' . $ownerId, $ownerId, 'owner.earnings', $earnings);
                    $db->prepare("UPDATE financial_ledger_entries SET status = 'Released' WHERE idempotency_key = ? AND status = 'Held'")->execute(['dispute:' . $id . ':hold']);
                    $db->prepare("UPDATE financial_ledger_entries SET status = 'Held' WHERE reservation_id = ? AND entry_type = 'owner_pending_balance'")->execute([(int)$reservationId]);
                    $snapshot = reservationPaymentMetadata($db, (int)$reservationId);
                    $refundPolicy = $snapshot['refundPolicy'] ?? [];
                    $releaseHours = max(0, (int)($refundPolicy['disputeWindowHours'] ?? 48));
                    $paidTotalQuery = $db->prepare("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE reservation_id = ? AND payment_status = 'paid'");
                    $paidTotalQuery->execute([(int)$reservationId]);
                    $feeSnapshot = reservationFeeSnapshot($db, (int)$reservationId, (float)$reservation['total_amount']);
                    $windowElapsed = !empty($reservation['completed_at']) && (new DateTimeImmutable((string)$reservation['completed_at']))->modify('+' . $releaseHours . ' hours') <= new DateTimeImmutable();
                    $fullyPaid = (float)$paidTotalQuery->fetchColumn() + 0.01 >= (float)$feeSnapshot['userTotal'];
                    if ($windowElapsed && $fullyPaid) {
                        $ownerPending = $db->prepare("SELECT ledger_id, amount FROM financial_ledger_entries WHERE reservation_id = ? AND entry_type = 'owner_pending_balance' LIMIT 1 FOR UPDATE");
                        $ownerPending->execute([(int)$reservationId]);
                        if ($pendingEntry = $ownerPending->fetch()) {
                            $db->prepare("UPDATE financial_ledger_entries SET status = 'Released' WHERE ledger_id = ?")->execute([(int)$pendingEntry['ledger_id']]);
                            writeFinancialLedgerEntry($db, ['idempotencyKey' => 'reservation:' . (int)$reservationId . ':owner-release', 'type' => 'owner_balance_release', 'reservationId' => (int)$reservationId, 'userId' => (int)$userId, 'ownerId' => $ownerId, 'amount' => (float)$pendingEntry['amount'], 'status' => 'Released', 'metadata' => ['releasedAt' => date(DATE_ATOM), 'disputeWindowHours' => $releaseHours, 'disputeId' => $id]]);
                        }
                    }
                }

                $dispute['status'] = 'Resolved';
                $dispute['resolution'] = $resolution;
                $dispute['resolutionNote'] = $note;
                $dispute['resolvedBy'] = $user['name'];
                $dispute['resolvedAt'] = $resolvedAt;
                $dispute['refund'] = $refund ? [
                    'id' => $refund['id'],
                    'totalRefunded' => $refundAmount,
                    'status' => 'pending',
                    'approvedAt' => $resolvedAt,
                ] : null;
                $disputes[$index] = $dispute;
                $save = $db->prepare('UPDATE app_state SET state_value = ?, updated_at = CURRENT_TIMESTAMP WHERE state_id = ?');
                $save->execute([json_encode($disputes, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $stateRow['state_id']]);

                $databaseDispute = $db->prepare('SELECT dispute_id FROM disputes WHERE dispute_code = ? LIMIT 1 FOR UPDATE');
                $databaseDispute->execute([$id]);
                $databaseDisputeId = $databaseDispute->fetchColumn();
                if ($databaseDisputeId) {
                    $db->prepare("UPDATE disputes SET status = 'Resolved' WHERE dispute_id = ?")->execute([(int)$databaseDisputeId]);
                } else {
                    $db->prepare("INSERT INTO disputes (dispute_code, reservation_id, user_id, reason, details, status) VALUES (?, ?, ?, ?, ?, 'Resolved')")
                        ->execute([$id, (int)$reservationId, (int)$userId, (string)($dispute['reason'] ?? 'Booking dispute'), (string)($dispute['details'] ?? '')]);
                }

                $refundDescription = $refundAmount > 0
                    ? ' A refund of ₱' . number_format($refundAmount, 2) . ' has been approved and is pending processing.'
                    : '';
                $userOutcome = $resolution === 'reject'
                    ? 'Your dispute for reservation #' . (int)$reservationId . ' was rejected. No refund was approved.'
                    : 'Your dispute for reservation #' . (int)$reservationId . ' was approved for a ' . ($resolution === 'full-refund' ? 'full' : 'partial') . ' refund of ₱' . number_format($refundAmount, 2) . '. The refund is pending processing.';
                storeNotification($db, (int)$userId, 'Dispute resolution recorded', $userOutcome . ' Note to both sides: ' . $note);
                if ($ownerId !== null) {
                    storeNotification($db, $ownerId, 'Dispute resolution recorded', 'The dispute for reservation #' . (int)$reservationId . ' was resolved as ' . $resolution . '.' . ($refundAmount > 0 ? ' A ₱' . number_format($refundAmount, 2) . ' refund is pending processing; the earning remains on hold.' : ' The earning hold has been released.') . ' Note: ' . $note);
                }
                storeRoleNotifications($db, 'Admin', 'Dispute resolution recorded', 'Dispute ' . $id . ' for reservation #' . (int)$reservationId . ' was resolved as ' . $resolution . ($refundAmount > 0 ? ' with a ₱' . number_format($refundAmount, 2) . ' refund pending processing.' : '.') . ' Note: ' . $note);

                [$auditStateId, $auditEntries] = readStateCollection($db, 'global', 'admin.auditLog', true);
                array_unshift($auditEntries, [
                    'id' => 'AUD-' . strtoupper(bin2hex(random_bytes(8))),
                    'action' => 'dispute-' . $resolution,
                    'actor' => $user['name'],
                    'targetId' => (string)$reservationId,
                    'note' => $note,
                    'details' => ['disputeId' => $id, 'refundId' => $refund['id'] ?? null, 'refundAmount' => $refundAmount, 'refundStatus' => $refund['status'] ?? null],
                    'createdAt' => $resolvedAt,
                ]);
                writeStateCollection($db, 'global', null, 'admin.auditLog', array_slice($auditEntries, 0, 500));

                $db->commit();
                respond(['data' => [...$dispute, 'reservationId' => (int)$reservationId, 'ownerId' => $ownerId, 'userId' => (int)$userId]]);
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
        }
    }
    if ($action === 'facilities.availability.update') {
        $user = currentUser($db);
        $facilityId = filter_var($body['facilityId'] ?? null, FILTER_VALIDATE_INT);
        $courtNumber = filter_var($body['courtNumber'] ?? null, FILTER_VALIDATE_INT);
        $date = (string)($body['date'] ?? '');
        $changes = $body['changes'] ?? null;
        $blockDate = !empty($body['blockDate']);
        $blockReason = trim((string)($body['reason'] ?? ''));
        if (!in_array($user['role'], ['Admin', 'Facility Owner'], true)) fail('Owner or administrator access is required.', 403);
        $parsedDate = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        $dateErrors = DateTimeImmutable::getLastErrors();
        if (!$facilityId || !$courtNumber || !$parsedDate || ($dateErrors !== false && ($dateErrors['warning_count'] || $dateErrors['error_count'])) || $parsedDate->format('Y-m-d') !== $date || $date < date('Y-m-d')) fail('Choose a valid facility, court, and current or future date.', 422);
        $sql = "SELECT c.court_id, c.court_name, f.name AS facility_name, f.owner_id FROM courts c JOIN facilities f ON f.facility_id = c.facility_id WHERE c.facility_id = ? AND c.court_number = ? AND NOT EXISTS (SELECT 1 FROM app_state removed WHERE removed.scope_key = CONCAT('facility:', f.facility_id) AND removed.state_key = 'facility.removal')";
        $params = [$facilityId, 'C' . $courtNumber];
        if ($user['role'] === 'Facility Owner') { $sql .= ' AND f.owner_id = ?'; $params[] = $user['id']; }
        $find = $db->prepare($sql);
        $find->execute($params);
        $court = $find->fetch();
        if (!$court) fail('Court not found or access denied.', 404);
        $courtId = (int)$court['court_id'];
        if ($blockDate) {
            if ($blockReason === '' || strlen($blockReason) > 1000) fail('Enter a reason up to 1,000 characters to block this date.', 422);
            $changes = [];
            for ($minute = 8 * 60; $minute < 22 * 60; $minute += 60) {
                $changes[] = ['time' => sprintf('%02d:%02d', intdiv($minute, 60), $minute % 60), 'status' => 'unavailable', 'reason' => $blockReason];
            }
        } elseif (!is_array($changes) || !$changes || count($changes) > 14) {
            fail('Add at least one valid schedule change.', 422);
        }
        $normalizedChanges = [];
        foreach ($changes as $change) {
            if (!is_array($change)) fail('A schedule change is invalid.', 422);
            $time = trim((string)($change['time'] ?? ''));
            $status = (string)($change['status'] ?? '');
            $reason = trim((string)($change['reason'] ?? ''));
            if (!preg_match('/^(?:0[8-9]|1\d|2[01]):00$/', $time) || !in_array($status, ['available', 'unavailable'], true) || ($status === 'unavailable' && ($reason === '' || strlen($reason) > 1000))) fail('Use a valid one-hour slot and provide a reason for each blocked time.', 422);
            $normalizedChanges[$time] = ['time' => $time, 'status' => $status, 'reason' => $reason];
        }
        $lock = $db->prepare("SELECT GET_LOCK('reserva_reservations', 8)");
        $lock->execute();
        if ((int)$lock->fetchColumn() !== 1) fail('Booking service is busy. Please retry in a moment.', 503);
        try {
            $changedEntries = [];
            if ($blockDate) {
                $hasBookings = $db->prepare("SELECT 1 FROM reservations r JOIN reservation_courts rc ON rc.reservation_id = r.reservation_id WHERE rc.court_id = ? AND r.reservation_date = ? AND r.status IN ('Pending', 'Confirmed') LIMIT 1 FOR UPDATE");
                $hasBookings->execute([(int)$courtId, $date]);
                if ($hasBookings->fetchColumn()) throw new ApiException('This court already has reservations on that date. Resolve them before blocking the full date.', 409);
            }
            $db->beginTransaction();
            try {
                $reservationCheck = $db->prepare("SELECT 1 FROM reservations r JOIN reservation_courts rc ON rc.reservation_id = r.reservation_id WHERE rc.court_id = ? AND r.reservation_date = ? AND r.status IN ('Pending', 'Confirmed') AND COALESCE(rc.start_time, r.start_time) < ? AND COALESCE(rc.end_time, r.end_time) > ? LIMIT 1");
                $findBlock = $db->prepare("SELECT reason FROM court_unavailable_slots WHERE court_id = ? AND slot_date = ? AND slot_time = ? AND slot_status = 'Unavailable' LIMIT 1 FOR UPDATE");
                $saveBlock = $db->prepare("UPDATE court_unavailable_slots SET reason = ?, created_by = ? WHERE court_id = ? AND slot_date = ? AND slot_time = ? AND slot_status = 'Unavailable'");
                $insertBlock = $db->prepare("INSERT INTO court_unavailable_slots (court_id, slot_date, slot_time, slot_status, reason, created_by) VALUES (?, ?, ?, 'Unavailable', ?, ?)");
                $removeBlock = $db->prepare("DELETE FROM court_unavailable_slots WHERE court_id = ? AND slot_date = ? AND slot_time = ? AND slot_status = 'Unavailable'");
                foreach ($normalizedChanges as $change) {
                    $time = $change['time'];
                    $timeMinute = (int)substr($time, 0, 2) * 60 + (int)substr($time, 3, 2);
                    $endMinute = $timeMinute + 60;
                    $endTime = sprintf('%02d:%02d:00', intdiv($endMinute, 60), $endMinute % 60);
                    if ($change['status'] === 'unavailable') {
                        $reservationCheck->execute([(int)$courtId, $date, $endTime, $time . ':00']);
                        if ($reservationCheck->fetchColumn()) throw new ApiException('This slot overlaps an existing reservation and cannot be blocked.', 409);
                        $entryChanged = false;
                        foreach ([$timeMinute, $timeMinute + 30] as $blockedMinute) {
                            $blockedTime = sprintf('%02d:%02d:00', intdiv($blockedMinute, 60), $blockedMinute % 60);
                            $findBlock->execute([(int)$courtId, $date, $blockedTime]);
                            $existingReason = $findBlock->fetchColumn();
                            if ($existingReason !== false) {
                                if ((string)$existingReason !== $change['reason']) {
                                    $saveBlock->execute([$change['reason'], (int)$user['id'], $courtId, $date, $blockedTime]);
                                    $entryChanged = true;
                                }
                            } else {
                                $insertBlock->execute([$courtId, $date, $blockedTime, $change['reason'], (int)$user['id']]);
                                $entryChanged = true;
                            }
                        }
                        if ($entryChanged) $changedEntries[] = ['time' => $time, 'status' => 'blocked', 'reason' => $change['reason']];
                    } else {
                        $entryChanged = false;
                        foreach ([$timeMinute, $timeMinute + 30] as $blockedMinute) {
                            $blockedTime = sprintf('%02d:%02d:00', intdiv($blockedMinute, 60), $blockedMinute % 60);
                            $removeBlock->execute([$courtId, $date, $blockedTime]);
                            if ($removeBlock->rowCount() > 0) $entryChanged = true;
                        }
                        if ($entryChanged) $changedEntries[] = ['time' => $time, 'status' => 'available', 'reason' => ''];
                    }
                }
                if ($changedEntries) {
                    $blockedChanges = array_values(array_filter($changedEntries, static fn(array $change): bool => $change['status'] === 'blocked'));
                    $availableChanges = array_values(array_filter($changedEntries, static fn(array $change): bool => $change['status'] === 'available'));
                    $formatTimes = static function (array $items): string {
                        $times = array_column($items, 'time');
                        $preview = implode(', ', array_slice($times, 0, 6));
                        return count($times) > 6 ? $preview . ' +' . (count($times) - 6) . ' more' : $preview;
                    };
                    $summary = [];
                    if ($blockedChanges) {
                        $summary[] = 'Blocked: ' . $formatTimes($blockedChanges);
                        $reasons = array_values(array_unique(array_map(static fn(array $change): string => $change['reason'], $blockedChanges)));
                        $summary[] = 'Reason: ' . substr(implode('; ', array_slice($reasons, 0, 2)), 0, 180);
                    }
                    if ($availableChanges) $summary[] = 'Reopened: ' . $formatTimes($availableChanges);
                    $notificationMessage = $court['facility_name'] . ' · ' . $court['court_name'] . ' on ' . $date . ' has schedule changes: ' . implode('; ', $summary);
                    if (!empty($court['owner_id'])) storeNotification($db, (int)$court['owner_id'], 'Facility schedule changed', $notificationMessage);
                    storeRoleNotifications($db, 'User', 'Facility schedule changed', $notificationMessage);
                    storeRoleNotifications($db, 'Admin', 'Facility schedule changed', $notificationMessage);
                }
                $db->commit();
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
        } finally {
            $db->query("SELECT RELEASE_LOCK('reserva_reservations')");
        }
        respond(['success' => true, 'data' => ['facilityId' => (int)$facilityId, 'courtId' => $courtId, 'date' => $date, 'saved' => count($changedEntries), 'changed' => $changedEntries]]);
    }
    if ($action === 'promo.validate') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Only players can apply a booking promo code.', 403);
        $code = strtoupper(trim((string)($_GET['code'] ?? '')));
        $bookingAmount = is_numeric($_GET['bookingAmount'] ?? null) ? round((float)$_GET['bookingAmount'], 2) : 0;
        if (!preg_match('/^[A-Z0-9_-]{4,32}$/', $code) || $bookingAmount <= 0) {
            fail('Enter a valid promo code and booking amount.', 422);
        }
        [, , $promo] = validatePromoCode($db, $code, $bookingAmount);
        $fees = bookingFeeSnapshot($db, $bookingAmount, $promo);
        if ($fees['userTotal'] <= 0) fail('This promo code would make the booking free, which is not supported by the current checkout. Choose another code.', 422);
        respond(['data' => [
            'promo' => [
                'code' => $promo['code'],
                'discountType' => $promo['discountType'],
                'value' => (float)$promo['value'],
                'minimumBooking' => (float)$promo['minimumBooking'],
                'discountAmount' => $fees['promoDiscount'],
            ],
            'fees' => $fees,
        ]]);
    }
    if ($action === 'reservation.create') {
        $user = currentUser($db);
        $result = createReservationRecord($db, $body, $user, $config);
        respond($result, !empty($result['already_submitted']) ? 200 : 201);
    }
    if ($action === 'reservations.list') {
        $user = currentUser($db);
        $db->exec("UPDATE reservations SET status = 'Completed', completed_at = COALESCE(completed_at, NOW()) WHERE status IN ('Confirmed', 'Checked in') AND CONCAT(reservation_date, ' ', end_time) <= NOW()");
        $heldBalances = $db->query("SELECT l.ledger_id, l.reservation_id, l.owner_id, l.amount, r.user_id, r.status AS reservation_status, r.completed_at, r.total_amount, state.state_value AS payment_snapshot, (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.reservation_id = r.reservation_id AND p.payment_status = 'paid') AS paid_amount FROM financial_ledger_entries l JOIN reservations r ON r.reservation_id = l.reservation_id LEFT JOIN app_state state ON state.scope_key = CONCAT('reservation:', r.reservation_id) AND state.state_key = 'reservation.payment' WHERE l.entry_type = 'owner_pending_balance' AND l.status = 'Held' AND r.status IN ('Completed', 'No-show', 'Cancelled') AND r.completed_at IS NOT NULL")->fetchAll();
        $releaseLedger = $db->prepare("UPDATE financial_ledger_entries SET status = 'Released' WHERE ledger_id = ? AND status = 'Held'");
        foreach ($heldBalances as $heldBalance) {
            $snapshot = json_decode((string)($heldBalance['payment_snapshot'] ?? ''), true) ?: [];
            $hours = max(0, (int)($snapshot['refundPolicy']['disputeWindowHours'] ?? 48));
            $eligibleAt = (new DateTimeImmutable((string)$heldBalance['completed_at']))->modify('+' . $hours . ' hours');
            $feeSnapshot = $snapshot['fees'] ?? bookingFeeSnapshot($db, (float)$heldBalance['total_amount']);
            $totalDue = (float)($feeSnapshot['userTotal'] ?? $heldBalance['total_amount']);
            $paymentRequirementMet = in_array($heldBalance['reservation_status'], ['No-show', 'Cancelled'], true)
                ? true
                : (float)$heldBalance['paid_amount'] + 0.01 >= $totalDue;
            if ($eligibleAt <= new DateTimeImmutable() && $paymentRequirementMet) {
                $db->beginTransaction();
                try {
                    $releaseLedger->execute([(int)$heldBalance['ledger_id']]);
                    if ($releaseLedger->rowCount() > 0) writeFinancialLedgerEntry($db, [
                        'idempotencyKey' => 'reservation:' . (int)$heldBalance['reservation_id'] . ':owner-release',
                        'type' => 'owner_balance_release',
                        'reservationId' => (int)$heldBalance['reservation_id'],
                        'userId' => (int)$heldBalance['user_id'],
                        'ownerId' => (int)$heldBalance['owner_id'],
                        'amount' => (float)$heldBalance['amount'],
                        'status' => 'Released',
                        'metadata' => ['releasedAt' => date(DATE_ATOM), 'disputeWindowHours' => $hours],
                    ]);
                    $db->commit();
                } catch (Throwable $error) {
                    if ($db->inTransaction()) $db->rollBack();
                    throw $error;
                }
            }
        }
        $requestIdsByReservation = [];
        if ($user['role'] === 'User') {
            $requestQuery = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = 'reservation.requests'");
            $requestQuery->execute(['user:' . (int)$user['id']]);
            $requestMap = json_decode((string)($requestQuery->fetchColumn() ?: '{}'), true) ?: [];
            foreach ($requestMap as $requestId => $request) {
                $reservationId = is_array($request) ? ($request['reservation_id'] ?? null) : $request;
                if (filter_var($reservationId, FILTER_VALIDATE_INT)) $requestIdsByReservation[(string)$reservationId] = (string)$requestId;
            }
        }
        $sql = "SELECT r.reservation_id AS id, r.user_id AS userId, u.full_name AS `user`, u.email,
                       r.facility_id AS facilityId, f.owner_id AS ownerId, f.name, s.name AS sport,
                       r.reservation_date AS date, r.start_time AS startTime, r.end_time AS endTime,
                       r.status, r.total_amount AS courtRate, r.created_at AS createdAt, r.completed_at AS completedAt,
                       (SELECT COUNT(*) FROM reservation_courts rc WHERE rc.reservation_id = r.reservation_id) AS quantity,
                       (SELECT GROUP_CONCAT(rc.court_id ORDER BY rc.court_id) FROM reservation_courts rc WHERE rc.reservation_id = r.reservation_id) AS courtIds,
                       (SELECT GROUP_CONCAT(c.court_name ORDER BY c.court_id SEPARATOR ', ') FROM reservation_courts rc JOIN courts c ON c.court_id = rc.court_id WHERE rc.reservation_id = r.reservation_id) AS courtNames,
                       (SELECT pm.method_name FROM payments p JOIN payment_methods pm ON pm.method_id = p.method_id WHERE p.reservation_id = r.reservation_id ORDER BY p.payment_id ASC LIMIT 1) AS paymentMethod,
                       (SELECT p.payment_id FROM payments p WHERE p.reservation_id = r.reservation_id ORDER BY CASE WHEN p.payment_status = 'pending' THEN 0 ELSE 1 END, p.payment_id DESC LIMIT 1) AS paymentId,
                       (SELECT p.payment_type FROM payments p WHERE p.reservation_id = r.reservation_id ORDER BY CASE WHEN p.payment_status = 'pending' THEN 0 ELSE 1 END, p.payment_id DESC LIMIT 1) AS paymentType,
                       (SELECT p.amount FROM payments p WHERE p.reservation_id = r.reservation_id ORDER BY CASE WHEN p.payment_status = 'pending' THEN 0 ELSE 1 END, p.payment_id DESC LIMIT 1) AS latestPaymentAmount,
                       (SELECT p.amount FROM payments p WHERE p.reservation_id = r.reservation_id ORDER BY p.payment_id ASC LIMIT 1) AS depositAmount,
                       (SELECT p.payment_status FROM payments p WHERE p.reservation_id = r.reservation_id ORDER BY CASE WHEN p.payment_status = 'pending' THEN 0 ELSE 1 END, p.payment_id DESC LIMIT 1) AS paymentStatus,
                       (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.reservation_id = r.reservation_id AND LOWER(p.payment_status) = 'paid') AS paidAmount,
                       EXISTS (SELECT 1 FROM payments p JOIN app_state proof ON proof.scope_key = CONCAT('payment:', p.payment_id) AND proof.state_key = 'payment.proof' WHERE p.reservation_id = r.reservation_id) AS hasPaymentProof
                FROM reservations r JOIN users u ON u.user_id = r.user_id
                LEFT JOIN facilities f ON f.facility_id = r.facility_id
                LEFT JOIN sports s ON s.sport_id = f.sport_id WHERE 1 = 1";
        $params = [];
        if ($user['role'] === 'Facility Owner') { $sql .= ' AND f.owner_id = ?'; $params[] = $user['id']; }
        elseif ($user['role'] !== 'Admin') { $sql .= ' AND r.user_id = ?'; $params[] = $user['id']; }
        $sql .= $user['role'] === 'Facility Owner'
            ? ' ORDER BY r.created_at DESC, r.reservation_id DESC'
            : ' ORDER BY r.reservation_date DESC, r.start_time DESC';
        $query = $db->prepare($sql);
        $query->execute($params);
        $rows = array_map(static function (array $row) use ($db, $requestIdsByReservation): array {
            $rate = (float)$row['courtRate'];
            $paymentMetadata = reservationPaymentMetadata($db, (int)$row['id']);
            $fees = reservationFeeSnapshot($db, (int)$row['id'], $rate);
            $userTotal = (float)$fees['userTotal'];
            $paidAmount = (float)$row['paidAmount'];
            $courtQuery = $db->prepare(
                'SELECT rc.court_id, c.court_number, c.court_name,
                        COALESCE(rc.start_time, r.start_time) AS startTime,
                        COALESCE(rc.end_time, r.end_time) AS endTime,
                        rc.hourly_rate
                 FROM reservation_courts rc
                 JOIN reservations r ON r.reservation_id = rc.reservation_id
                 JOIN courts c ON c.court_id = rc.court_id
                 WHERE rc.reservation_id = ?
                 ORDER BY CAST(SUBSTRING(c.court_number, 2) AS UNSIGNED), c.court_id'
            );
            $courtQuery->execute([(int)$row['id']]);
            $courtSchedules = array_map(static function (array $court) use ($row, $rate): array {
                $courtStart = substr((string)$court['startTime'], 0, 5);
                $courtEnd = substr((string)$court['endTime'], 0, 5);
                $courtDuration = max(1, (strtotime($courtEnd) - strtotime($courtStart)) / 3600);
                $reservationDuration = max(1, (strtotime((string)$row['endTime']) - strtotime((string)$row['startTime'])) / 3600);
                $courtCount = max(1, (int)$row['quantity']);
                $hourlyRate = $court['hourly_rate'] === null
                    ? round($rate / ($courtCount * $reservationDuration), 2)
                    : (float)$court['hourly_rate'];
                return [
                    'courtId' => (int)$court['court_id'],
                    'courtNumber' => (int)preg_replace('/\D+/', '', (string)$court['court_number']),
                    'courtName' => (string)$court['court_name'],
                    'startTime' => $courtStart,
                    'endTime' => $courtEnd,
                    'duration' => $courtDuration,
                    'hourlyRate' => $hourlyRate,
                    'courtRate' => round($hourlyRate * $courtDuration, 2),
                ];
            }, $courtQuery->fetchAll());
            $equipmentLines = reservationEquipmentLines($db, (int)$row['id']);
            $courtCharges = round(array_sum(array_map(static fn(array $court): float => (float)$court['courtRate'], $courtSchedules)), 2);
            $equipmentTotal = round(array_sum(array_column($equipmentLines, 'lineTotal')), 2);
            return [
                'id' => (int)$row['id'], 'source' => 'database', 'userId' => (int)$row['userId'],
                'user' => $row['user'], 'email' => $row['email'], 'facilityId' => (int)$row['facilityId'],
                'ownerId' => $row['ownerId'] === null ? null : (int)$row['ownerId'], 'name' => $row['name'],
                'sport' => $row['sport'], 'date' => (string)$row['date'], 'startTime' => substr((string)$row['startTime'], 0, 5),
                'endTime' => substr((string)$row['endTime'], 0, 5),
                'time' => substr((string)$row['startTime'], 0, 5) . ' - ' . substr((string)$row['endTime'], 0, 5),
                'duration' => max(1, (strtotime((string)$row['endTime']) - strtotime((string)$row['startTime'])) / 3600),
                'quantity' => max(1, (int)$row['quantity']), 'status' => $row['status'],
                'courtIds' => array_column($courtSchedules, 'courtId'),
                'courtNames' => array_column($courtSchedules, 'courtName'),
                'courtSchedules' => $courtSchedules,
                'courtCharges' => (float)($paymentMetadata['courtCharges'] ?? $courtCharges),
                'equipmentItems' => $equipmentLines,
                'equipmentTotal' => (float)($paymentMetadata['equipmentTotal'] ?? $equipmentTotal),
                ...$fees,
                'userTotal' => $userTotal, 'total' => $userTotal, 'paymentMethod' => $row['paymentMethod'],
                'paymentStatus' => $row['paymentStatus'] ?? 'pending', 'paymentType' => $row['paymentType'] ?? 'legacy',
                'latestPaymentAmount' => (float)($row['latestPaymentAmount'] ?? 0),
                'paymentOption' => $paymentMetadata['paymentOption'] ?? 'full',
                'balanceSettlement' => $paymentMetadata['balanceSettlement'] ?? null,
                'amountToPayNow' => (float)($paymentMetadata['amountToPayNow'] ?? $row['depositAmount'] ?? 0),
                'depositAmount' => (float)($row['depositAmount'] ?? 0),
                'initialPaymentAmount' => (float)($paymentMetadata['amountToPayNow'] ?? $row['depositAmount'] ?? 0),
                'paymentId' => $row['paymentId'] === null ? null : (int)$row['paymentId'],
                'paidAmount' => $paidAmount, 'balanceDue' => max(0, round($userTotal - $paidAmount, 2)),
                'hasPaymentProof' => (bool)$row['hasPaymentProof'], 'refundedAmount' => 0,
                'createdAt' => $row['createdAt'], 'completedAt' => $row['completedAt'], 'refunds' => [], 'isPaymentReservation' => true,
                'requestId' => $requestIdsByReservation[(string)$row['id']] ?? null,
            ];
        }, $query->fetchAll());
        respond(['data' => $rows]);
    }
    if ($action === 'inquiries.create') {
        $user = currentUser($db);
        $facilityId = filter_var($body['facilityId'] ?? null, FILTER_VALIDATE_INT);
        $subject = trim((string)($body['subject'] ?? ''));
        $category = trim((string)($body['category'] ?? 'Other'));
        $message = trim((string)($body['message'] ?? ''));
        $categories = ['Booking', 'Payment', 'Facility maintenance', 'Safety', 'Staff', 'Other'];
        if (!$facilityId || $subject === '' || strlen($subject) > 100 || strlen($message) < 10 || !in_array($category, $categories, true)) fail('Choose a facility and issue category, add a subject, and enter at least 10 message characters.', 422);
        $facility = $db->prepare("SELECT f.facility_id, f.owner_id, f.name FROM facilities f WHERE f.facility_id = ? AND NOT EXISTS (SELECT 1 FROM app_state removed WHERE removed.scope_key = CONCAT('facility:', f.facility_id) AND removed.state_key = 'facility.removal')");
        $facility->execute([$facilityId]);
        $facilityRow = $facility->fetch();
        if (!$facilityRow) fail('Facility not found.', 404);
        $db->beginTransaction();
        $insert = $db->prepare("INSERT INTO inquiries (user_id, subject, message, status) VALUES (?, ?, ?, 'Open')");
        $insert->execute([$user['id'], '[' . $category . '] ' . $subject, $message]);
        $inquiryId = (int)$db->lastInsertId();
        $details = $db->prepare('INSERT INTO inquiry_details (inquiry_id, facility_id, replies) VALUES (?, ?, ?)');
        $details->execute([$inquiryId, $facilityId, '[]']);
        $notificationMessage = $user['name'] . ' sent an inquiry about ' . $facilityRow['name'] . '.';
        if (!empty($facilityRow['owner_id'])) storeNotification($db, (int)$facilityRow['owner_id'], 'New facility inquiry', $notificationMessage);
        storeRoleNotifications($db, 'Admin', 'New facility inquiry', $notificationMessage);
        $db->commit();
        respond(['ok' => true, 'id' => $inquiryId], 201);
    }
    if (in_array($action, ['owner.inquiries.list', 'owner.inquiry.read', 'owner.inquiry.reply'], true)) {
        $user = currentUser($db);
        if (!in_array($user['role'], ['Facility Owner', 'Admin'], true)) fail('Owner or administrator access is required.', 403);
        if ($action === 'owner.inquiries.list') {
            $sql = "SELECT i.inquiry_id AS id, i.user_id AS userId, u.full_name AS customer, u.email, i.subject, i.message AS preview, i.created_at AS createdAt, d.owner_read, d.replies, f.name AS facility FROM inquiries i JOIN users u ON u.user_id = i.user_id JOIN inquiry_details d ON d.inquiry_id = i.inquiry_id JOIN facilities f ON f.facility_id = d.facility_id WHERE 1 = 1";
            $params = [];
            if ($user['role'] !== 'Admin') { $sql .= ' AND f.owner_id = ?'; $params[] = $user['id']; }
            $sql .= ' ORDER BY i.created_at DESC';
            $query = $db->prepare($sql);
            $query->execute($params);
            $data = array_map(static function (array $row): array {
                $replies = json_decode($row['replies'] ?: '[]', true) ?: [];
                $messages = [['id' => 'inquiry-' . $row['id'], 'author' => 'customer', 'text' => $row['preview'], 'sentAt' => $row['createdAt']], ...$replies];
                return ['id' => (int)$row['id'], 'customer' => $row['customer'], 'email' => $row['email'], 'subject' => $row['subject'], 'preview' => $replies ? end($replies)['text'] : $row['preview'], 'status' => $replies ? 'Replied' : ($row['owner_read'] ? 'Read' : 'Unread'), 'messages' => $messages, 'facility' => $row['facility']];
            }, $query->fetchAll());
            respond(['data' => $data]);
        }
        $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$id) fail('Inquiry id is required.', 422);
        $scope = $db->prepare('SELECT d.replies, f.owner_id, i.user_id, f.name AS facility FROM inquiry_details d JOIN facilities f ON f.facility_id = d.facility_id JOIN inquiries i ON i.inquiry_id = d.inquiry_id WHERE d.inquiry_id = ?');
        $scope->execute([$id]);
        $record = $scope->fetch();
        if (!$record || ($user['role'] !== 'Admin' && (int)$record['owner_id'] !== (int)$user['id'])) fail('Inquiry not found or access denied.', 404);
        if ($action === 'owner.inquiry.read') {
            $db->prepare('UPDATE inquiry_details SET owner_read = 1 WHERE inquiry_id = ?')->execute([$id]);
            respond(['ok' => true]);
        }
        $text = trim((string)($body['text'] ?? ''));
        if ($text === '') fail('Enter a reply before sending.', 422);
        $replies = json_decode($record['replies'] ?: '[]', true) ?: [];
        $message = ['id' => 'reply-' . bin2hex(random_bytes(8)), 'author' => 'owner', 'text' => $text, 'sentAt' => date(DATE_ATOM)];
        $replies[] = $message;
        $db->prepare('UPDATE inquiry_details SET owner_read = 1, replies = ? WHERE inquiry_id = ?')->execute([json_encode($replies, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $id]);
        $db->prepare("UPDATE inquiries SET status = 'In Progress' WHERE inquiry_id = ?")->execute([$id]);
        storeNotification(
            $db,
            (int)$record['user_id'],
            'Facility replied to your inquiry',
            'The facility ' . $record['facility'] . " replied to your inquiry:\n\n" . $text,
        );
        respond(['data' => $message]);
    }
    if ($action === 'reviews.list') {
        $query = $db->query('SELECT r.review_id AS id, r.reservation_id AS reservationId, r.user_id AS userId, u.full_name AS user, r.rating, r.comment AS text, f.name AS facility, r.created_at AS createdAt FROM reviews r JOIN users u ON u.user_id = r.user_id JOIN facilities f ON f.facility_id = r.facility_id ORDER BY r.created_at DESC');
        respond(['data' => $query->fetchAll()]);
    }
    if ($action === 'reviews.create') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Only players can submit a review.', 403);
        $facilityId = filter_var($body['facilityId'] ?? null, FILTER_VALIDATE_INT);
        $reservationId = filter_var($body['reservationId'] ?? null, FILTER_VALIDATE_INT);
        $rating = filter_var($body['rating'] ?? null, FILTER_VALIDATE_INT);
        $comment = trim((string)($body['text'] ?? ''));
        if (!$facilityId || !$rating || $rating < 1 || $rating > 5 || strlen($comment) < 8) fail('Choose a facility, a 1–5 rating, and a comment of at least 8 characters.', 422);
        if (!$reservationId) fail('Choose a completed reservation to review.', 422);
        $db->exec("UPDATE reservations SET status = 'Completed' WHERE status = 'Confirmed' AND CONCAT(reservation_date, ' ', end_time) <= NOW()");
        $eligible = $db->prepare("SELECT reservation_id FROM reservations WHERE reservation_id = ? AND user_id = ? AND facility_id = ? AND status = 'Completed'");
        $eligible->execute([$reservationId, $user['id'], $facilityId]);
        if (!$eligible->fetchColumn()) fail('Reviews are available after your booked facility time is complete.', 409);
        $duplicate = $db->prepare('SELECT review_id FROM reviews WHERE reservation_id = ? LIMIT 1');
        $duplicate->execute([$reservationId]);
        if ($duplicate->fetchColumn()) fail('You have already reviewed this reservation.', 409);
        $insert = $db->prepare('INSERT INTO reviews (reservation_id, user_id, facility_id, rating, comment) VALUES (?, ?, ?, ?, ?)');
        $insert->execute([$reservationId, $user['id'], $facilityId, $rating, $comment]);
        respond(['data' => ['id' => (int)$db->lastInsertId(), 'user' => $user['name'], 'rating' => $rating, 'text' => $comment]], 201);
    }
    if ($action === 'payments.card.checkout.create') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Card checkout is available to customer accounts only.', 403);
        $reservationId = filter_var($body['reservationId'] ?? null, FILTER_VALIDATE_INT);
        if (!$reservationId) fail('Reservation ID is required to start card checkout.', 422);
        requirePaymongoCheckoutConfig($config);
        $query = $db->prepare(
            "SELECT p.payment_id, p.reservation_id, p.amount, p.payment_status, r.status AS reservation_status,
                    r.facility_id, f.name AS facility_name, u.full_name, u.email
             FROM payments p JOIN reservations r ON r.reservation_id = p.reservation_id
             JOIN facilities f ON f.facility_id = r.facility_id JOIN users u ON u.user_id = r.user_id
             WHERE p.reservation_id = ? AND r.user_id = ? AND p.method_id = (SELECT method_id FROM payment_methods WHERE method_name = 'Card' LIMIT 1)
             ORDER BY p.payment_id DESC LIMIT 1"
        );
        $query->execute([(int)$reservationId, (int)$user['id']]);
        $payment = $query->fetch();
        if (!$payment) fail('Card payment record was not found for this reservation.', 404);
        if ($payment['payment_status'] === 'paid') respond(['success' => true, 'data' => ['paid' => true, 'reservationId' => (int)$reservationId]]);
        if ($payment['payment_status'] !== 'pending' || in_array($payment['reservation_status'], ['Cancelled', 'Refunded'], true)) {
            fail('This reservation is no longer awaiting card payment.', 409);
        }

        $paymentId = (int)$payment['payment_id'];
        $lockName = 'reserva_paymongo_checkout_' . $paymentId;
        $lockQuery = $db->prepare('SELECT GET_LOCK(?, 8)');
        $lockQuery->execute([$lockName]);
        if ((int)$lockQuery->fetchColumn() !== 1) fail('Card checkout is being prepared. Please try again shortly.', 503);
        try {
            $scope = 'payment:' . $paymentId;
            $savedQuery = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = 'payment.card.checkout' LIMIT 1");
            $savedQuery->execute([$scope]);
            $savedCheckout = json_decode((string)($savedQuery->fetchColumn() ?: 'null'), true);
            $savedUrl = is_array($savedCheckout) ? (string)($savedCheckout['checkoutUrl'] ?? '') : '';
            if ($savedUrl !== '' && parse_url($savedUrl, PHP_URL_HOST) === 'checkout.paymongo.com') {
                $checkoutUrl = $savedUrl;
                $sessionId = (string)$savedCheckout['checkoutSessionId'];
            } else {
                $amountCents = (int)round((float)$payment['amount'] * 100);
                if ($amountCents < 100) fail('The card payment amount is below PayMongo’s minimum.', 422);
                $frontendUrl = rtrim((string)($config['oauth']['frontend_url'] ?? ''), '/');
                if (!preg_match('/^https:\/\//', $frontendUrl) && !in_array(parse_url($frontendUrl, PHP_URL_HOST), ['localhost', '127.0.0.1'], true)) {
                    fail('Set RESERVA_FRONTEND_URL to the public HTTPS app address before enabling PayMongo checkout.', 503);
                }
                $returnUrl = $frontendUrl . '/confirm-booking?cardPayment=return&reservationId=' . (int)$reservationId;
                $response = paymongoRequest($config, 'POST', '/v2/checkout_sessions', [
                    'data' => ['attributes' => [
                        'line_items' => [[
                            'name' => substr('RESERVA booking - ' . (string)$payment['facility_name'], 0, 120),
                            'amount' => $amountCents,
                            'currency' => 'PHP',
                            'quantity' => 1,
                        ]],
                        'payment_method_types' => ['card'],
                        'success_url' => $returnUrl . '&result=success',
                        'cancel_url' => $returnUrl . '&result=cancelled',
                        'reference_number' => 'RES-' . (int)$reservationId . '-' . $paymentId,
                        'send_email_receipt' => true,
                        'metadata' => ['reservation_id' => (string)$reservationId, 'payment_id' => (string)$paymentId],
                    ]],
                ], 'reserva-payment-' . $paymentId);
                $session = $response['data'] ?? [];
                $sessionAttributes = $session['attributes'] ?? [];
                $sessionId = trim((string)($session['id'] ?? ''));
                $checkoutUrl = trim((string)($sessionAttributes['checkout_url'] ?? ''));
                if (!str_starts_with($sessionId, 'cs_') || parse_url($checkoutUrl, PHP_URL_HOST) !== 'checkout.paymongo.com') {
                    error_log('PayMongo checkout response did not include a valid session ID and hosted URL.');
                    fail('PayMongo did not return a valid secure checkout link. Please retry.', 502);
                }
                $savedCheckout = ['checkoutSessionId' => $sessionId, 'checkoutUrl' => $checkoutUrl, 'createdAt' => date(DATE_ATOM)];
                $save = $db->prepare(
                    "INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'payment.card.checkout', ?)
                     ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), user_id = VALUES(user_id), updated_at = CURRENT_TIMESTAMP"
                );
                $save->execute([$scope, (int)$user['id'], json_encode($savedCheckout, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
            }
        } finally {
            $release = $db->prepare('SELECT RELEASE_LOCK(?)');
            $release->execute([$lockName]);
        }
        respond(['success' => true, 'data' => ['checkoutUrl' => $checkoutUrl, 'checkoutSessionId' => $sessionId, 'reservationId' => (int)$reservationId]]);
    }
    if ($action === 'payments.card.status') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Card payment status is available to customer accounts only.', 403);
        $reservationId = filter_var($_GET['reservationId'] ?? null, FILTER_VALIDATE_INT);
        if (!$reservationId) fail('Reservation ID is required.', 422);
        $query = $db->prepare(
            "SELECT r.reservation_id, r.status AS reservationStatus, p.payment_status AS paymentStatus
             FROM reservations r JOIN payments p ON p.reservation_id = r.reservation_id
             JOIN payment_methods pm ON pm.method_id = p.method_id AND pm.method_name = 'Card'
             WHERE r.reservation_id = ? AND r.user_id = ? ORDER BY p.payment_id DESC LIMIT 1"
        );
        $query->execute([(int)$reservationId, (int)$user['id']]);
        $status = $query->fetch();
        if (!$status) fail('Card payment record was not found for this reservation.', 404);
        respond(['success' => true, 'data' => [
            'reservationId' => (int)$status['reservation_id'],
            'reservationStatus' => $status['reservationStatus'],
            'paymentStatus' => $status['paymentStatus'],
            'paid' => $status['paymentStatus'] === 'paid',
        ]]);
    }
    if ($action === 'payment.methods.list') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Saved booking payment methods are available to customer accounts only.', 403);
        $query = $db->prepare('SELECT saved_payment_method_id AS id, method_type AS methodType, account_name AS accountName, mobile_ciphertext AS mobileCiphertext, is_default AS isDefault, created_at AS createdAt FROM user_payment_methods WHERE user_id = ? ORDER BY is_default DESC, created_at DESC, saved_payment_method_id DESC');
        $query->execute([(int)$user['id']]);
        $methods = array_map(static function (array $row) use ($config): array {
            $mobile = decryptPaymentMobile((string)$row['mobileCiphertext'], $config);
            return [
                'id' => (int)$row['id'],
                'methodType' => $row['methodType'],
                'accountName' => $row['accountName'],
                'mobileMasked' => '••••' . substr($mobile, -4),
                'isDefault' => (bool)$row['isDefault'],
                'createdAt' => $row['createdAt'],
            ];
        }, $query->fetchAll());
        respond(['data' => $methods]);
    }
    if ($action === 'payment.methods.save') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Saved booking payment methods are available to customer accounts only.', 403);
        $methodType = trim((string)($body['methodType'] ?? ''));
        $accountName = trim((string)($body['accountName'] ?? ''));
        if (!in_array($methodType, ['GCash', 'Maya'], true) || $accountName === '' || strlen($accountName) > 150) {
            fail('Choose GCash or Maya and enter the account holder name.', 422);
        }
        $mobile = normalizePaymentMobile($body['mobileNumber'] ?? '');
        $key = paymentDataKey($config);
        $fingerprint = hash_hmac('sha256', $methodType . ':' . $mobile, $key);
        $encryptedMobile = encryptPaymentMobile($mobile, $config);
        $userId = (int)$user['id'];
        $requestedDefault = !empty($body['isDefault']);
        $db->beginTransaction();
        try {
            $existingQuery = $db->prepare('SELECT saved_payment_method_id, is_default FROM user_payment_methods WHERE user_id = ? AND method_type = ? AND account_fingerprint = ? FOR UPDATE');
            $existingQuery->execute([$userId, $methodType, $fingerprint]);
            $existing = $existingQuery->fetch();
            $countQuery = $db->prepare('SELECT COUNT(*) FROM user_payment_methods WHERE user_id = ?');
            $countQuery->execute([$userId]);
            $makeDefault = $requestedDefault || (int)$countQuery->fetchColumn() === 0;
            if ($makeDefault) $db->prepare('UPDATE user_payment_methods SET is_default = 0 WHERE user_id = ?')->execute([$userId]);
            if ($existing) {
                $savedId = (int)$existing['saved_payment_method_id'];
                $save = $db->prepare('UPDATE user_payment_methods SET account_name = ?, mobile_ciphertext = ?, is_default = ? WHERE saved_payment_method_id = ? AND user_id = ?');
                $save->execute([$accountName, $encryptedMobile, $makeDefault || (bool)$existing['is_default'] ? 1 : 0, $savedId, $userId]);
            } else {
                $save = $db->prepare('INSERT INTO user_payment_methods (user_id, method_type, account_name, mobile_ciphertext, account_fingerprint, is_default) VALUES (?, ?, ?, ?, ?, ?)');
                $save->execute([$userId, $methodType, $accountName, $encryptedMobile, $fingerprint, $makeDefault ? 1 : 0]);
                $savedId = (int)$db->lastInsertId();
            }
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
        respond(['data' => [
            'id' => $savedId,
            'methodType' => $methodType,
            'accountName' => $accountName,
            'mobileMasked' => '••••' . substr($mobile, -4),
            'isDefault' => $makeDefault || (bool)($existing['is_default'] ?? false),
        ]], $existing ? 200 : 201);
    }
    if ($action === 'payment.methods.default') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Saved booking payment methods are available to customer accounts only.', 403);
        $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$id) fail('Choose a saved payment method.', 422);
        $db->beginTransaction();
        try {
            $find = $db->prepare('SELECT saved_payment_method_id FROM user_payment_methods WHERE saved_payment_method_id = ? AND user_id = ? FOR UPDATE');
            $find->execute([$id, (int)$user['id']]);
            if (!$find->fetchColumn()) fail('Saved payment method not found.', 404);
            $db->prepare('UPDATE user_payment_methods SET is_default = 0 WHERE user_id = ?')->execute([(int)$user['id']]);
            $db->prepare('UPDATE user_payment_methods SET is_default = 1 WHERE saved_payment_method_id = ? AND user_id = ?')->execute([$id, (int)$user['id']]);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
        respond(['data' => ['id' => (int)$id, 'isDefault' => true]]);
    }
    if ($action === 'payment.methods.remove') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Saved booking payment methods are available to customer accounts only.', 403);
        $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$id) fail('Choose a saved payment method.', 422);
        $userId = (int)$user['id'];
        $db->beginTransaction();
        try {
            $find = $db->prepare('SELECT is_default FROM user_payment_methods WHERE saved_payment_method_id = ? AND user_id = ? FOR UPDATE');
            $find->execute([$id, $userId]);
            $wasDefault = $find->fetchColumn();
            if ($wasDefault === false) fail('Saved payment method not found.', 404);
            $db->prepare('DELETE FROM user_payment_methods WHERE saved_payment_method_id = ? AND user_id = ?')->execute([$id, $userId]);
            if ((bool)$wasDefault) {
                $next = $db->prepare('SELECT saved_payment_method_id FROM user_payment_methods WHERE user_id = ? ORDER BY created_at DESC, saved_payment_method_id DESC LIMIT 1 FOR UPDATE');
                $next->execute([$userId]);
                $nextId = $next->fetchColumn();
                if ($nextId) $db->prepare('UPDATE user_payment_methods SET is_default = 1 WHERE saved_payment_method_id = ? AND user_id = ?')->execute([(int)$nextId, $userId]);
            }
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
        respond(['data' => ['id' => (int)$id, 'removed' => true]]);
    }
    if ($action === 'reservation.payment.audit') {
        $user = currentUser($db);
        if (!in_array($user['role'], ['User', 'Facility Owner', 'Admin'], true)) fail('You are not allowed to view booking payment records.', 403);
        $reservationId = filter_var($_GET['reservationId'] ?? null, FILTER_VALIDATE_INT);
        if (!$reservationId) fail('Reservation id is required.', 422);
        $reservationQuery = $db->prepare(
            "SELECT r.reservation_id AS id, r.user_id AS userId, f.owner_id AS ownerId,
                    u.full_name AS customer, COALESCE(f.name, 'Facility unavailable') AS facility,
                    r.reservation_date AS date, r.status, r.total_amount AS totalAmount,
                    r.created_at AS createdAt
             FROM reservations r
             JOIN users u ON u.user_id = r.user_id
             LEFT JOIN facilities f ON f.facility_id = r.facility_id
             WHERE r.reservation_id = ?"
        );
        $reservationQuery->execute([(int)$reservationId]);
        $reservation = $reservationQuery->fetch();
        if (!$reservation ||
            ($user['role'] === 'User' && (int)$reservation['userId'] !== (int)$user['id']) ||
            ($user['role'] === 'Facility Owner' && (int)($reservation['ownerId'] ?? 0) !== (int)$user['id'])) {
            fail('Reservation not found or access denied.', 404);
        }

        $paymentQuery = $db->prepare(
            "SELECT p.payment_id AS id, p.amount, p.payment_type AS paymentType,
                    p.payment_status AS status, p.transaction_reference AS reference,
                    COALESCE(pm.method_name, 'Not recorded') AS method,
                    p.created_at AS createdAt, p.paid_at AS paidAt
             FROM payments p
             LEFT JOIN payment_methods pm ON pm.method_id = p.method_id
             WHERE p.reservation_id = ?
             ORDER BY p.created_at ASC, p.payment_id ASC"
        );
        $paymentQuery->execute([(int)$reservationId]);
        $payments = $paymentQuery->fetchAll();
        $proofQuery = $db->prepare(
            "SELECT p.payment_id AS paymentId, proof.state_key, proof.state_value
             FROM payments p JOIN app_state proof ON proof.scope_key = CONCAT('payment:', p.payment_id)
                AND proof.state_key IN ('payment.proof', 'payment.refund.proof')
             WHERE p.reservation_id = ?"
        );
        $proofQuery->execute([(int)$reservationId]);
        $proofsByPayment = [];
        foreach ($proofQuery->fetchAll() as $proofRow) {
            $decoded = json_decode((string)$proofRow['state_value'], true);
            $proofsByPayment[(string)$proofRow['paymentId']][$proofRow['state_key']] = is_array($decoded) ? $decoded : null;
        }
        foreach ($payments as &$payment) {
            $savedProofs = $proofsByPayment[(string)$payment['id']] ?? [];
            $payment['proof'] = $savedProofs['payment.proof'] ?? null;
            $payment['refundProof'] = $savedProofs['payment.refund.proof'] ?? null;
        }
        unset($payment);

        $ledgerQuery = $db->prepare(
            'SELECT ledger_id AS id, payment_id AS paymentId, entry_type AS type,
                    amount, status, external_reference AS reference, metadata, created_at AS createdAt
             FROM financial_ledger_entries WHERE reservation_id = ? ORDER BY created_at ASC, ledger_id ASC'
        );
        $ledgerQuery->execute([(int)$reservationId]);
        $ledger = array_map(static function (array $entry): array {
            $entry['metadata'] = json_decode((string)($entry['metadata'] ?? ''), true) ?: [];
            return $entry;
        }, $ledgerQuery->fetchAll());
        $paymentSnapshot = reservationPaymentMetadata($db, (int)$reservationId);
        $reservation['promo'] = $paymentSnapshot['promo'] ?? null;
        $reservation['userTotal'] = $paymentSnapshot['fees']['userTotal'] ?? null;
        $reservation['courtCharges'] = (float)($paymentSnapshot['courtCharges'] ?? $reservation['totalAmount']);
        $reservation['equipmentTotal'] = (float)($paymentSnapshot['equipmentTotal'] ?? 0);
        $reservation['equipmentItems'] = reservationEquipmentLines($db, (int)$reservationId);
        $disputeResolution = null;
        $disputeRows = $db->query("SELECT state_value FROM app_state WHERE state_key = 'disputes'")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($disputeRows as $disputeJson) {
            $savedDisputes = json_decode((string)$disputeJson, true);
            if (!is_array($savedDisputes)) continue;
            foreach ($savedDisputes as $savedDispute) {
                if (is_array($savedDispute) && (int)($savedDispute['reservationId'] ?? 0) === (int)$reservationId && !empty($savedDispute['resolvedAt'])) {
                    $disputeResolution = [
                        'id' => (string)($savedDispute['id'] ?? ''),
                        'resolution' => (string)($savedDispute['resolution'] ?? ''),
                        'note' => (string)($savedDispute['resolutionNote'] ?? ''),
                        'resolvedAt' => (string)$savedDispute['resolvedAt'],
                        'refund' => $savedDispute['refund'] ?? null,
                    ];
                    break 2;
                }
            }
        }
        unset($reservation['userId'], $reservation['ownerId']);
        respond(['data' => ['reservation' => $reservation, 'payments' => $payments, 'ledger' => $ledger, 'disputeResolution' => $disputeResolution]]);
    }
    if ($action === 'payments.proof') {
        $user = currentUser($db);
        $paymentId = filter_var($_GET['paymentId'] ?? null, FILTER_VALIDATE_INT);
        if (!$paymentId) fail('Payment id is required.', 422);
        $access = $db->prepare('SELECT p.payment_id, r.user_id, f.owner_id FROM payments p JOIN reservations r ON r.reservation_id = p.reservation_id JOIN facilities f ON f.facility_id = r.facility_id WHERE p.payment_id = ?');
        $access->execute([$paymentId]);
        $payment = $access->fetch();
        if (!$payment || ($user['role'] === 'User' && (int)$payment['user_id'] !== (int)$user['id']) || ($user['role'] === 'Facility Owner' && (int)$payment['owner_id'] !== (int)$user['id'])) fail('Payment proof not found or access denied.', 404);
        $proofKind = (string)($_GET['kind'] ?? 'payment');
        if (!in_array($proofKind, ['payment', 'refund'], true)) fail('Payment evidence type is invalid.', 422);
        $proofQuery = $db->prepare('SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = ?');
        $proofQuery->execute(['payment:' . (int)$paymentId, $proofKind === 'refund' ? 'payment.refund.proof' : 'payment.proof']);
        $proof = json_decode((string)($proofQuery->fetchColumn() ?: 'null'), true);
        if (!is_array($proof)) fail('No receipt or payment evidence was uploaded.', 404);
        respond(['data' => $proof]);
    }
    if ($action === 'payments.proof.resubmit') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Only the customer can resubmit payment proof.', 403);
        $paymentId = filter_var($body['paymentId'] ?? null, FILTER_VALIDATE_INT);
        $proofData = $body['paymentProof'] ?? null;
        $reference = trim((string)($body['reference'] ?? ''));
        $validProof = validReceiptImage($proofData);
        if (!$paymentId || !$validProof || strlen($reference) > 100) fail('Upload a valid receipt image and optional reference number.', 422);
        $db->beginTransaction();
        try {
            $find = $db->prepare('SELECT p.payment_id, p.payment_status, p.payment_type, p.amount, p.reservation_id, r.user_id, r.status AS reservation_status, f.owner_id, f.name FROM payments p JOIN reservations r ON r.reservation_id = p.reservation_id JOIN facilities f ON f.facility_id = r.facility_id WHERE p.payment_id = ? AND r.user_id = ? FOR UPDATE');
            $find->execute([(int)$paymentId, (int)$user['id']]);
            $payment = $find->fetch();
            if (!$payment) fail('Payment record not found.', 404);
            if ($payment['payment_status'] !== 'failed') fail('Only a rejected or failed payment can be resubmitted.', 409);
            if ($payment['payment_type'] === 'balance' && !in_array($payment['reservation_status'], ['Confirmed', 'Checked in'], true)) fail('A balance proof can only be resubmitted before or during check-in.', 409);
            $db->prepare("UPDATE payments SET payment_status = 'pending', transaction_reference = ?, paid_at = NULL WHERE payment_id = ?")->execute([$reference ?: null, (int)$paymentId]);
            $proof = ['paymentId' => (int)$paymentId, 'reservationId' => (int)$payment['reservation_id'], 'image' => $proofData, 'reference' => $reference, 'submittedBy' => (int)$user['id'], 'uploadedAt' => date(DATE_ATOM)];
            $save = $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'payment.proof', ?) ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), user_id = VALUES(user_id)");
            $save->execute(['payment:' . (int)$paymentId, (int)$user['id'], json_encode($proof, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
            $db->prepare("UPDATE financial_ledger_entries SET status = 'Pending verification', external_reference = ? WHERE payment_id = ? AND entry_type IN ('customer_payment', 'platform_service_fee')")->execute([$reference ?: null, (int)$paymentId]);
            storeNotification($db, (int)$user['id'], 'Payment proof resubmitted', 'Your updated receipt for ' . $payment['name'] . ' is waiting for verification.');
            if (!empty($payment['owner_id'])) storeNotification($db, (int)$payment['owner_id'], 'Payment proof resubmitted', 'A customer resubmitted payment proof for ' . $payment['name'] . '.');
            storeRoleNotifications($db, 'Admin', 'Payment proof resubmitted', 'Payment #' . (int)$paymentId . ' for reservation #' . (int)$payment['reservation_id'] . ' is awaiting review again.');
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
        respond(['success' => true, 'data' => ['paymentId' => (int)$paymentId, 'status' => 'Pending verification']]);
    }
    if ($action === 'payments.reject') {
        $user = currentUser($db);
        if ($user['role'] !== 'Admin') fail('Administrator access is required to reject a payment proof.', 403);
        $paymentId = filter_var($body['paymentId'] ?? null, FILTER_VALIDATE_INT);
        $reason = trim((string)($body['reason'] ?? ''));
        if (!$paymentId || $reason === '' || strlen($reason) > 1000) fail('A payment and rejection reason are required.', 422);
        $db->beginTransaction();
        try {
            $find = $db->prepare('SELECT p.payment_id, p.payment_status, p.payment_type, p.reservation_id, r.user_id, f.owner_id, f.name FROM payments p JOIN reservations r ON r.reservation_id = p.reservation_id JOIN facilities f ON f.facility_id = r.facility_id WHERE p.payment_id = ? FOR UPDATE');
            $find->execute([(int)$paymentId]);
            $payment = $find->fetch();
            if (!$payment || $payment['payment_status'] !== 'pending') fail('Only pending payment proofs can be rejected.', 409);
            $proof = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = 'payment.proof' FOR UPDATE");
            $proof->execute(['payment:' . (int)$paymentId]);
            $proofValue = json_decode((string)($proof->fetchColumn() ?: 'null'), true);
            if (!is_array($proofValue)) fail('Payment proof was not found.', 404);
            $db->prepare("UPDATE payments SET payment_status = 'failed' WHERE payment_id = ?")->execute([(int)$paymentId]);
            $db->prepare("UPDATE financial_ledger_entries SET status = 'Rejected' WHERE payment_id = ? AND entry_type IN ('customer_payment', 'platform_service_fee')")->execute([(int)$paymentId]);
            $proofValue['rejectionReason'] = $reason;
            $proofValue['rejectedAt'] = date(DATE_ATOM);
            $save = $db->prepare("UPDATE app_state SET state_value = ?, updated_at = CURRENT_TIMESTAMP WHERE scope_key = ? AND state_key = 'payment.proof'");
            $save->execute([json_encode($proofValue, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), 'payment:' . (int)$paymentId]);
            storeNotification($db, (int)$payment['user_id'], 'Payment proof rejected', 'Your payment proof for ' . $payment['name'] . ' was rejected. ' . $reason . ' You can upload corrected proof from Reserved Schedule.');
            if (!empty($payment['owner_id'])) storeNotification($db, (int)$payment['owner_id'], 'Payment proof rejected', 'Payment proof for ' . $payment['name'] . ' was rejected by an administrator.');
            storeRoleNotifications($db, 'Admin', 'Payment proof rejected', 'Payment #' . (int)$paymentId . ' was rejected. Reason: ' . $reason);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
        respond(['success' => true, 'data' => ['paymentId' => (int)$paymentId, 'status' => 'Failed', 'reason' => $reason]]);
    }
    if ($action === 'payments.verify') {
        $user = currentUser($db);
        if (!in_array($user['role'], ['Admin', 'Facility Owner'], true)) fail('Owner or administrator access is required.', 403);
        $paymentId = filter_var($body['paymentId'] ?? null, FILTER_VALIDATE_INT);
        if (!$paymentId) fail('Payment id is required.', 422);
        $db->beginTransaction();
        try {
            $find = $db->prepare('SELECT p.payment_id, p.payment_status, p.payment_type, p.amount, p.reservation_id, r.user_id, f.owner_id, f.name FROM payments p JOIN reservations r ON r.reservation_id = p.reservation_id JOIN facilities f ON f.facility_id = r.facility_id WHERE p.payment_id = ? FOR UPDATE');
            $find->execute([$paymentId]);
            $payment = $find->fetch();
            if (!$payment || ($user['role'] === 'Facility Owner' && (int)$payment['owner_id'] !== (int)$user['id'])) fail('Payment not found or access denied.', 404);
            if ($payment['payment_status'] !== 'pending') fail('Only pending payments can be verified.', 409);
            $proof = $db->prepare("SELECT state_id FROM app_state WHERE scope_key = ? AND state_key = 'payment.proof' FOR UPDATE");
            $proof->execute(['payment:' . (int)$paymentId]);
            if (!$proof->fetchColumn()) fail('Payment cannot be verified without uploaded receipt evidence.', 409);
            $db->prepare("UPDATE payments SET payment_status = 'paid', paid_at = NOW() WHERE payment_id = ?")->execute([$paymentId]);
            updatePaymentLedgerStatus($db, (int)$paymentId, 'Paid');
            $paidTotalQuery = $db->prepare("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE reservation_id = ? AND payment_status = 'paid'");
            $paidTotalQuery->execute([(int)$payment['reservation_id']]);
            $reservationTotalQuery = $db->prepare('SELECT total_amount FROM reservations WHERE reservation_id = ?');
            $reservationTotalQuery->execute([(int)$payment['reservation_id']]);
            $feeSnapshot = reservationFeeSnapshot($db, (int)$payment['reservation_id'], (float)$reservationTotalQuery->fetchColumn());
            $paymentProgress = (float)$paidTotalQuery->fetchColumn() + 0.01 >= (float)$feeSnapshot['userTotal'] ? 'paid' : 'partially paid';
            $earningRows = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'owner.earnings' FOR UPDATE");
            $earningRows->execute(['user:' . (int)$payment['owner_id']]);
            foreach ($earningRows->fetchAll() as $earningRow) {
                $ownerEarnings = json_decode((string)$earningRow['state_value'], true);
                if (!is_array($ownerEarnings)) continue;
                $changed = false;
                foreach ($ownerEarnings as &$earning) {
                    if (!is_array($earning) || (string)($earning['reservationId'] ?? '') !== (string)$payment['reservation_id']) continue;
                    $earning['paymentStatus'] = $paymentProgress;
                    $changed = true;
                }
                unset($earning);
                if ($changed) {
                    $saveEarnings = $db->prepare('UPDATE app_state SET state_value = ? WHERE state_id = ?');
                    $saveEarnings->execute([json_encode($ownerEarnings, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), (int)$earningRow['state_id']]);
                }
            }
            $paymentLabel = match ((string)$payment['payment_type']) {
                'downpayment' => '50% downpayment',
                'balance' => 'remaining balance',
                'legacy' => 'previously submitted payment',
                default => 'full booking payment',
            };
            $message = 'Your ' . $paymentLabel . ' for ' . $payment['name'] . ' has been verified.';
            if ($payment['payment_type'] !== 'balance') $message .= ' The facility can now review and confirm your booking.';
            storeNotification($db, (int)$payment['user_id'], 'Payment verified', $message);
            if (!empty($payment['owner_id'])) {
                storeNotification($db, (int)$payment['owner_id'], 'Payment verified', 'A customer payment of ₱' . number_format((float)$payment['amount'], 2) . ' for ' . $payment['name'] . ' was verified.');
            }
            storeRoleNotifications($db, 'Admin', 'Payment verified', 'Payment #' . (int)$paymentId . ' for reservation #' . (int)$payment['reservation_id'] . ' was verified.');
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
        respond(['success' => true, 'data' => ['paymentId' => (int)$paymentId, 'status' => 'Paid']]);
    }
    if ($action === 'payments.record') {
        $user = currentUser($db);
        if (!in_array($user['role'], ['Admin', 'Facility Owner'], true)) fail('Owner or administrator access is required.', 403);
        $reservationId = filter_var($body['reservationId'] ?? null, FILTER_VALIDATE_INT);
        $amount = is_numeric($body['amount'] ?? null) ? round((float)$body['amount'], 2) : 0;
        $proofData = $body['paymentProof'] ?? null;
        $reference = trim((string)($body['reference'] ?? ''));
        $requestId = trim((string)($body['requestId'] ?? ''));
        $validProof = validReceiptImage($proofData);
        if (!$reservationId || $amount <= 0 || !$validProof || strlen($reference) > 100 || !preg_match('/^[A-Za-z0-9_-]{16,80}$/', $requestId)) fail('Enter a valid balance payment amount, request identifier, and receipt.', 422);
        $db->beginTransaction();
        try {
            $find = $db->prepare('SELECT r.reservation_id, r.user_id, r.facility_id, r.status, r.total_amount, f.owner_id, f.name FROM reservations r JOIN facilities f ON f.facility_id = r.facility_id WHERE r.reservation_id = ? FOR UPDATE');
            $find->execute([$reservationId]);
            $reservation = $find->fetch();
            if (!$reservation || ($user['role'] === 'Facility Owner' && (int)$reservation['owner_id'] !== (int)$user['id'])) fail('Reservation not found or access denied.', 404);
            if (!in_array($reservation['status'], ['Confirmed', 'Checked in'], true)) fail('The remaining balance can be recorded before or during check-in after the reservation is confirmed.', 409);
            $fees = reservationFeeSnapshot($db, (int)$reservationId, (float)$reservation['total_amount']);
            $paymentMeta = reservationPaymentMetadata($db, (int)$reservationId);
            if (($paymentMeta['paymentOption'] ?? '') !== 'half' || ($paymentMeta['balanceSettlement'] ?? '') !== 'cash-checkin') fail('Cash collection is only available for bookings that selected cash on check-in.', 409);
            $duplicateCash = $db->prepare('SELECT payment_id FROM payments WHERE idempotency_key = ?');
            $duplicateCash->execute(['cash:' . $reservationId . ':' . $requestId]);
            if ($duplicateId = $duplicateCash->fetchColumn()) {
                $db->commit();
                respond(['success' => true, 'data' => ['paymentId' => (int)$duplicateId, 'reservationId' => (int)$reservationId, 'status' => 'Paid', 'alreadyRecorded' => true]]);
            }
            $paidQuery = $db->prepare("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE reservation_id = ? AND payment_status = 'paid'");
            $paidQuery->execute([$reservationId]);
            $paidBefore = (float)$paidQuery->fetchColumn();
            $balance = round(max(0, $fees['userTotal'] - $paidBefore), 2);
            if ($amount > $balance + 0.01) fail('The recorded amount exceeds the outstanding balance of ' . number_format($balance, 2) . '.', 422);
            $db->prepare("INSERT IGNORE INTO payment_methods (method_name) VALUES ('Cash')")->execute();
            $method = $db->query("SELECT method_id FROM payment_methods WHERE method_name = 'Cash' LIMIT 1")->fetchColumn();
            if (abs($amount - $balance) > 0.01) fail('Cash balance must match the outstanding amount of ' . number_format($balance, 2) . '.', 422);
            $insert = $db->prepare("INSERT INTO payments (reservation_id, method_id, amount, payment_type, payment_status, transaction_reference, idempotency_key, paid_at) VALUES (?, ?, ?, 'balance', 'paid', ?, ?, NOW())");
            $insert->execute([$reservationId, (int)$method, $amount, $reference !== '' ? $reference : 'Walk-in cash', 'cash:' . $reservationId . ':' . $requestId]);
            $paymentId = (int)$db->lastInsertId();
            $db->prepare('UPDATE payments SET proof_location = ? WHERE payment_id = ?')->execute(['payment:' . $paymentId, $paymentId]);
            $proof = ['paymentId' => $paymentId, 'reservationId' => (int)$reservationId, 'image' => $proofData, 'reference' => $reference, 'submittedBy' => (int)$user['id'], 'uploadedAt' => date(DATE_ATOM)];
            $save = $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'payment.proof', ?) ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), user_id = VALUES(user_id)");
            $save->execute(['payment:' . $paymentId, (int)$user['id'], json_encode($proof, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
            writeFinancialLedgerEntry($db, ['idempotencyKey' => 'payment:' . $paymentId . ':customer', 'type' => 'customer_payment', 'reservationId' => (int)$reservationId, 'paymentId' => $paymentId, 'userId' => (int)$reservation['user_id'], 'ownerId' => (int)$reservation['owner_id'], 'amount' => $amount, 'status' => 'Paid', 'reference' => $reference ?: null, 'metadata' => ['paymentType' => 'balance', 'method' => 'Cash']]);
            $paidAfter = round($paidBefore + $amount, 2);
            $earningState = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'owner.earnings' FOR UPDATE");
            $earningState->execute(['user:' . (int)$reservation['owner_id']]);
            foreach ($earningState->fetchAll() as $earningRow) {
                $ownerEarnings = json_decode((string)$earningRow['state_value'], true);
                if (!is_array($ownerEarnings)) continue;
                $earningChanged = false;
                foreach ($ownerEarnings as &$earning) {
                    if (!is_array($earning) || (string)($earning['reservationId'] ?? '') !== (string)$reservationId) continue;
                    $earning['paymentStatus'] = $paidAfter + 0.01 >= (float)$fees['userTotal'] ? 'paid' : 'partially paid';
                    $earningChanged = true;
                }
                unset($earning);
                if ($earningChanged) $db->prepare('UPDATE app_state SET state_value = ? WHERE state_id = ?')->execute([json_encode($ownerEarnings, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), (int)$earningRow['state_id']]);
            }
            storeNotification($db, (int)$reservation['user_id'], 'Balance payment recorded', 'A cash balance payment for ' . $reservation['name'] . ' was recorded with receipt evidence.');
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
        respond(['success' => true, 'data' => ['paymentId' => $paymentId, 'reservationId' => (int)$reservationId, 'amount' => $amount, 'status' => 'Paid']], 201);
    }
    if ($action === 'payments.balance.submit') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Only the customer can submit a balance payment.', 403);
        $reservationId = filter_var($body['reservationId'] ?? null, FILTER_VALIDATE_INT);
        $methodName = trim((string)($body['paymentMethod'] ?? ''));
        $savedMethodId = filter_var($body['savedPaymentMethodId'] ?? null, FILTER_VALIDATE_INT);
        $requestId = trim((string)($body['requestId'] ?? ''));
        $reference = trim((string)($body['reference'] ?? ''));
        $proofData = $body['paymentProof'] ?? null;
        $validProof = validReceiptImage($proofData);
        if (!$reservationId || !in_array($methodName, ['GCash', 'Maya'], true) || !preg_match('/^[A-Za-z0-9_-]{16,80}$/', $requestId) || strlen($reference) > 100 || !$validProof) fail('Choose GCash or Maya and upload a valid balance transfer receipt.', 422);
        $db->beginTransaction();
        try {
            $find = $db->prepare('SELECT r.reservation_id, r.user_id, r.status, r.total_amount, f.owner_id, f.name FROM reservations r JOIN facilities f ON f.facility_id = r.facility_id WHERE r.reservation_id = ? AND r.user_id = ? FOR UPDATE');
            $find->execute([(int)$reservationId, (int)$user['id']]);
            $reservation = $find->fetch();
            if (!$reservation) fail('Reservation not found.', 404);
            if (!in_array($reservation['status'], ['Confirmed', 'Checked in'], true)) fail('A balance payment can be submitted after the booking is confirmed.', 409);
            $meta = reservationPaymentMetadata($db, (int)$reservationId);
            if (($meta['paymentOption'] ?? '') !== 'half' || ($meta['balanceSettlement'] ?? '') !== 'online-checkin') fail('This reservation does not use online balance settlement.', 409);
            $duplicateQuery = $db->prepare('SELECT payment_id, payment_status FROM payments WHERE idempotency_key = ? FOR UPDATE');
            $idempotency = 'balance:' . (int)$reservationId . ':' . $requestId;
            $duplicateQuery->execute([$idempotency]);
            if ($duplicate = $duplicateQuery->fetch()) {
                $db->commit();
                respond(['success' => true, 'data' => ['paymentId' => (int)$duplicate['payment_id'], 'reservationId' => (int)$reservationId, 'status' => ucfirst((string)$duplicate['payment_status']), 'alreadySubmitted' => true]]);
            }
            if ($savedMethodId) {
                $saved = $db->prepare('SELECT saved_payment_method_id FROM user_payment_methods WHERE saved_payment_method_id = ? AND user_id = ? AND method_type = ? FOR UPDATE');
                $saved->execute([(int)$savedMethodId, (int)$user['id'], $methodName]);
                if (!$saved->fetchColumn()) fail('Saved payment account is invalid.', 404);
            }
            $fees = reservationFeeSnapshot($db, (int)$reservationId, (float)$reservation['total_amount']);
            $paid = $db->prepare("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE reservation_id = ? AND payment_status = 'paid'");
            $paid->execute([(int)$reservationId]);
            $amountDue = round(max(0, (float)$fees['userTotal'] - (float)$paid->fetchColumn()), 2);
            if ($amountDue <= 0) fail('There is no remaining balance due.', 409);
            $pending = $db->prepare("SELECT payment_id FROM payments WHERE reservation_id = ? AND payment_type = 'balance' AND payment_status = 'pending' LIMIT 1 FOR UPDATE");
            $pending->execute([(int)$reservationId]);
            if ($pending->fetchColumn()) fail('A balance payment is already waiting for verification.', 409);
            $method = $db->prepare('SELECT method_id FROM payment_methods WHERE method_name = ? LIMIT 1');
            $method->execute([$methodName]);
            $methodId = $method->fetchColumn();
            if (!$methodId) fail('The selected payment method is not configured.', 503);
            $insert = $db->prepare("INSERT INTO payments (reservation_id, method_id, user_payment_method_id, amount, payment_type, payment_status, transaction_reference, idempotency_key, paid_at) VALUES (?, ?, ?, ?, 'balance', 'pending', ?, ?, NULL)");
            $insert->execute([(int)$reservationId, (int)$methodId, $savedMethodId ?: null, $amountDue, $reference ?: null, $idempotency]);
            $paymentId = (int)$db->lastInsertId();
            $db->prepare('UPDATE payments SET proof_location = ? WHERE payment_id = ?')->execute(['payment:' . $paymentId, $paymentId]);
            $proof = ['paymentId' => $paymentId, 'reservationId' => (int)$reservationId, 'image' => $proofData, 'reference' => $reference, 'submittedBy' => (int)$user['id'], 'uploadedAt' => date(DATE_ATOM)];
            $saveProof = $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'payment.proof', ?) ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), user_id = VALUES(user_id)");
            $saveProof->execute(['payment:' . $paymentId, (int)$user['id'], json_encode($proof, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
            writeFinancialLedgerEntry($db, ['idempotencyKey' => 'payment:' . $paymentId . ':customer', 'type' => 'customer_payment', 'reservationId' => (int)$reservationId, 'paymentId' => $paymentId, 'userId' => (int)$user['id'], 'ownerId' => (int)$reservation['owner_id'], 'amount' => $amountDue, 'status' => 'Pending verification', 'reference' => $reference ?: null, 'metadata' => ['paymentType' => 'balance', 'method' => $methodName]]);
            storeNotification($db, (int)$user['id'], 'Balance payment submitted', 'Your balance payment proof for ' . $reservation['name'] . ' is waiting for verification.');
            if (!empty($reservation['owner_id'])) storeNotification($db, (int)$reservation['owner_id'], 'Balance payment submitted', 'A customer submitted balance payment proof for ' . $reservation['name'] . '.');
            storeRoleNotifications($db, 'Admin', 'Balance payment submitted', 'A customer submitted balance payment proof for ' . $reservation['name'] . '.');
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
        respond(['success' => true, 'data' => ['paymentId' => $paymentId, 'reservationId' => (int)$reservationId, 'amount' => $amountDue, 'status' => 'Pending verification']], 201);
    }
    if ($action === 'reservation.reschedule') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Only players can reschedule reservations.', 403);
        $reservationId = filter_var($body['reservationId'] ?? null, FILTER_VALIDATE_INT);
        $date = trim((string)($body['date'] ?? ''));
        $startTime = trim((string)($body['startTime'] ?? ''));
        $endTime = trim((string)($body['endTime'] ?? ''));
        $courtBookingsInput = $body['courtBookings'] ?? null;
        if (!$reservationId || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !preg_match('/^(?:[01]\d|2[0-3]):00$/', $startTime) || !preg_match('/^(?:[01]\d|2[0-3]):00$/', $endTime)) fail('Choose a valid reservation time.', 422);
        $bookingTimezone = new DateTimeZone('Asia/Manila');
        $bookingNow = new DateTimeImmutable('now', $bookingTimezone);
        $bookingToday = $bookingNow->format('Y-m-d');
        $bookingTime = $bookingNow->format('H:i');
        $parsedDate = DateTimeImmutable::createFromFormat('!Y-m-d', $date, $bookingTimezone);
        $dateErrors = DateTimeImmutable::getLastErrors();
        if (!$parsedDate || ($dateErrors !== false && ($dateErrors['warning_count'] || $dateErrors['error_count'])) || $parsedDate->format('Y-m-d') !== $date) fail('Choose a valid reservation date.', 422);
        $startMinutes = (int)substr($startTime, 0, 2) * 60;
        $endMinutes = (int)substr($endTime, 0, 2) * 60;
        if ($date < $bookingToday || ($date === $bookingToday && $startTime <= $bookingTime) || $startMinutes < 480 || $endMinutes > 1320 || $endMinutes <= $startMinutes) fail('Choose a future time within facility hours.', 422);
        $lock = $db->prepare("SELECT GET_LOCK('reserva_reservations', 8)");
        $lock->execute();
        if ((int)$lock->fetchColumn() !== 1) fail('Booking service is busy. Please retry in a moment.', 503);
        try {
            $db->beginTransaction();
            $find = $db->prepare('SELECT r.facility_id, r.status, r.reservation_date, r.start_time, r.end_time, f.owner_id, f.status AS facility_status FROM reservations r JOIN facilities f ON f.facility_id = r.facility_id WHERE r.reservation_id = ? AND r.user_id = ? FOR UPDATE');
            $find->execute([$reservationId, (int)$user['id']]);
            $reservation = $find->fetch();
            if (!$reservation || !in_array($reservation['status'], ['Pending', 'Confirmed'], true)) fail('This reservation cannot be rescheduled.', 409);
            $originalStart = new DateTimeImmutable((string)$reservation['reservation_date'] . ' ' . (string)$reservation['start_time'], $bookingTimezone);
            if ($originalStart <= $bookingNow) fail('A reservation cannot be rescheduled after its start time.', 409);
            if ($reservation['facility_status'] !== 'Active') fail('This facility is under maintenance and cannot accept schedule changes.', 409);
            $courtQuery = $db->prepare('SELECT rc.court_id, rc.start_time, rc.end_time, rc.hourly_rate, c.court_number, c.court_name FROM reservation_courts rc JOIN courts c ON c.court_id = rc.court_id WHERE rc.reservation_id = ? FOR UPDATE');
            $courtQuery->execute([$reservationId]);
            $assignedCourts = $courtQuery->fetchAll();
            if (!$assignedCourts) fail('No courts are assigned to this reservation.', 409);
            $courtIds = array_map(static fn(array $court): int => (int)$court['court_id'], $assignedCourts);
            $courtBookings = [];
            if (is_array($courtBookingsInput)) {
                if (count($courtBookingsInput) !== count($assignedCourts)) fail('Add a schedule for every assigned court.', 422);
                foreach ($courtBookingsInput as $booking) {
                    if (!is_array($booking)) fail('A court schedule is invalid.', 422);
                    $courtId = filter_var($booking['courtId'] ?? null, FILTER_VALIDATE_INT);
                    $courtStart = trim((string)($booking['startTime'] ?? ''));
                    $courtEnd = trim((string)($booking['endTime'] ?? ''));
                    $assigned = null;
                    foreach ($assignedCourts as $assignedCourt) if ((int)$assignedCourt['court_id'] === (int)$courtId) { $assigned = $assignedCourt; break; }
                    if (!$assigned || !preg_match('/^(?:[01]\d|2[0-3]):00$/', $courtStart) || !preg_match('/^(?:[01]\d|2[0-3]):00$/', $courtEnd)) fail('Choose a valid schedule for each assigned court.', 422);
                    $oldStart = substr((string)$assigned['start_time'], 0, 5);
                    $oldEnd = substr((string)$assigned['end_time'], 0, 5);
                    $oldDuration = (int)((strtotime($oldEnd) - strtotime($oldStart)) / 60);
                    $newStart = (int)substr($courtStart, 0, 2) * 60;
                    $newEnd = (int)substr($courtEnd, 0, 2) * 60;
                    if ($newStart < 480 || $newEnd > 1320 || $newEnd - $newStart !== $oldDuration) fail('Rescheduling must keep each court\'s original duration and remain within facility hours.', 422);
                    if ($date === $bookingToday && $courtStart <= $bookingTime) fail('A selected court time has already started or passed.', 422);
                    $courtBookings[] = [
                        'courtId' => (int)$courtId,
                        'courtNumber' => (int)preg_replace('/\D+/', '', (string)$assigned['court_number']),
                        'courtName' => (string)$assigned['court_name'],
                        'startTime' => $courtStart,
                        'endTime' => $courtEnd,
                        'duration' => $oldDuration / 60,
                        'hourlyRate' => (float)$assigned['hourly_rate'],
                        'courtRate' => round((float)$assigned['hourly_rate'] * $oldDuration / 60, 2),
                    ];
                }
                if (count(array_unique(array_column($courtBookings, 'courtId'))) !== count($assignedCourts) || count(array_diff($courtIds, array_column($courtBookings, 'courtId'))) > 0) fail('Use each assigned court exactly once.', 422);
            } else {
                foreach ($assignedCourts as $assignedCourt) {
                    $oldStart = substr((string)$assignedCourt['start_time'], 0, 5);
                    $oldEnd = substr((string)$assignedCourt['end_time'], 0, 5);
                    if ($endMinutes - $startMinutes !== (int)((strtotime($oldEnd) - strtotime($oldStart)) / 60)) fail('A reschedule must keep the original booking duration.', 422);
                    $oldDuration = max(1, (int)((strtotime($oldEnd) - strtotime($oldStart)) / 3600));
                    $courtBookings[] = [
                        'courtId' => (int)$assignedCourt['court_id'],
                        'courtNumber' => (int)preg_replace('/\D+/', '', (string)$assignedCourt['court_number']),
                        'courtName' => (string)$assignedCourt['court_name'],
                        'startTime' => $startTime,
                        'endTime' => $endTime,
                        'duration' => $oldDuration,
                        'hourlyRate' => (float)$assignedCourt['hourly_rate'],
                        'courtRate' => round((float)$assignedCourt['hourly_rate'] * $oldDuration, 2),
                    ];
                }
            }
            $expectedStart = min(array_column($courtBookings, 'startTime'));
            $expectedEnd = max(array_column($courtBookings, 'endTime'));
            if ($startTime !== $expectedStart || $endTime !== $expectedEnd) fail('The reservation summary does not match the court schedules.', 422);
            $blocked = $db->prepare("SELECT 1 FROM reservation_courts rc JOIN reservations r ON r.reservation_id = rc.reservation_id WHERE rc.court_id = ? AND r.facility_id = ? AND r.reservation_date = ? AND r.reservation_id <> ? AND r.status IN ('Pending', 'Confirmed') AND COALESCE(rc.start_time, r.start_time) < ? AND COALESCE(rc.end_time, r.end_time) > ? LIMIT 1");
            $maintenance = $db->prepare("SELECT 1 FROM court_unavailable_slots WHERE court_id = ? AND slot_date = ? AND slot_status = 'Unavailable' AND slot_time >= ? AND slot_time < ? LIMIT 1");
            foreach ($courtBookings as $booking) {
                $courtStart = $booking['startTime'] . ':00';
                $courtEnd = $booking['endTime'] . ':00';
                $blocked->execute([(int)$booking['courtId'], (int)$reservation['facility_id'], $date, (int)$reservationId, $courtEnd, $courtStart]);
                if ($blocked->fetchColumn()) fail('One of your assigned courts is taken during its selected time.', 409);
                $maintenance->execute([(int)$booking['courtId'], $date, $courtStart, $courtEnd]);
                if ($maintenance->fetchColumn()) fail('One of your assigned courts is under maintenance during its selected time.', 409);
            }
            $db->prepare('UPDATE reservations SET reservation_date = ?, start_time = ?, end_time = ? WHERE reservation_id = ?')->execute([$date, $startTime . ':00', $endTime . ':00', (int)$reservationId]);
            $updateCourtSchedule = $db->prepare('UPDATE reservation_courts SET start_time = ?, end_time = ? WHERE reservation_id = ? AND court_id = ?');
            foreach ($courtBookings as $booking) $updateCourtSchedule->execute([$booking['startTime'] . ':00', $booking['endTime'] . ':00', (int)$reservationId, (int)$booking['courtId']]);
            storeNotification($db, (int)$user['id'], 'Reservation rescheduled', 'Your reservation schedules for ' . $date . ' have been updated.');
            if (!empty($reservation['owner_id'])) storeNotification($db, (int)$reservation['owner_id'], 'Reservation rescheduled', $user['name'] . ' rescheduled a reservation.');
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        } finally {
            $db->query("SELECT RELEASE_LOCK('reserva_reservations')");
        }
        respond(['success' => true, 'data' => ['id' => (int)$reservationId, 'date' => $date, 'startTime' => $startTime, 'endTime' => $endTime, 'time' => $startTime . ' - ' . $endTime, 'courtIds' => $courtIds, 'courtSchedules' => $courtBookings]]);
    }
    if ($action === 'reservation.status') {
        $user = currentUser($db);
        if (!in_array($user['role'], ['Admin', 'Facility Owner'], true)) fail('Owner or administrator access is required.', 403);
        $id = (string)($body['id'] ?? '');
        $status = (string)($body['status'] ?? '');
        if ($id === '' || !in_array($status, ['Confirmed', 'Cancelled', 'No-show'], true)) fail('Reservation update is invalid.', 422);
        if (in_array($status, ['Cancelled', 'No-show'], true) && !trim((string)($body['reason'] ?? ''))) fail('A reason is required for this reservation update.', 422);
        if (ctype_digit($id)) {
            $find = $db->prepare("SELECT r.reservation_id, r.facility_id, r.user_id, r.status, r.total_amount, r.reservation_date, r.end_time, f.name, f.owner_id,
                                         (SELECT p.payment_id FROM payments p WHERE p.reservation_id = r.reservation_id ORDER BY p.payment_id ASC LIMIT 1) AS deposit_payment_id,
                                         (SELECT p.amount FROM payments p WHERE p.reservation_id = r.reservation_id ORDER BY p.payment_id ASC LIMIT 1) AS deposit_amount,
                                         (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.reservation_id = r.reservation_id AND p.payment_status = 'paid') AS paid_amount
                                  FROM reservations r LEFT JOIN facilities f ON f.facility_id = r.facility_id WHERE r.reservation_id = ?");
            $find->execute([(int)$id]);
            $reservation = $find->fetch();
            if (!$reservation) fail('Reservation not found.', 404);
            if ($user['role'] === 'Facility Owner') {
                $owner = $db->prepare('SELECT owner_id FROM facilities WHERE facility_id = ?');
                $owner->execute([$reservation['facility_id']]);
                if ((int)$owner->fetchColumn() !== (int)$user['id']) fail('You cannot update this reservation.', 403);
            }
            if ($status === 'No-show') {
                if ($reservation['status'] !== 'Confirmed') fail('Only a confirmed reservation can be marked as a no-show.', 409);
                $scheduledEnd = strtotime((string)$reservation['reservation_date'] . ' ' . (string)$reservation['end_time']);
                if (!$scheduledEnd || $scheduledEnd > time()) fail('A reservation can only be marked as a no-show after its scheduled end time.', 409);
                $db->beginTransaction();
                try {
                    $locked = $db->prepare("SELECT r.reservation_id, r.user_id, r.status, r.total_amount, r.reservation_date, r.end_time, f.owner_id, f.name,
                                                   (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.reservation_id = r.reservation_id AND p.payment_status = 'paid') AS paid_amount
                                            FROM reservations r JOIN facilities f ON f.facility_id = r.facility_id WHERE r.reservation_id = ? FOR UPDATE");
                    $locked->execute([(int)$id]);
                    $current = $locked->fetch();
                    if (!$current || $current['status'] !== 'Confirmed') throw new ApiException('Only a confirmed reservation can be marked as a no-show.', 409);
                    if ($user['role'] === 'Facility Owner' && (int)$current['owner_id'] !== (int)$user['id']) throw new ApiException('You cannot update this reservation.', 403);
                    $scheduledEnd = strtotime((string)$current['reservation_date'] . ' ' . (string)$current['end_time']);
                    if (!$scheduledEnd || $scheduledEnd > time()) throw new ApiException('A reservation can only be marked as a no-show after its scheduled end time.', 409);
                    $reservationId = (int)$id;
                    $metadata = reservationPaymentMetadata($db, $reservationId);
                    $policy = $metadata['refundPolicy'] ?? ['freeCancelHours' => 24, 'lateCancelRefundRate' => 0.5, 'noShowRefundRate' => 0, 'disputeWindowHours' => 48];
                    $fees = reservationFeeSnapshot($db, $reservationId, (float)$current['total_amount']);
                    $refund = calculateReservationCancellation($current, $fees, $policy, (float)$current['paid_amount'], 'no-show');
                    $completedAt = date('Y-m-d H:i:s', $scheduledEnd);
                    $db->prepare("UPDATE reservations SET status = 'No-show', completed_at = ? WHERE reservation_id = ?")->execute([$completedAt, $reservationId]);
                    $db->prepare("UPDATE payments SET payment_status = 'failed' WHERE reservation_id = ? AND payment_type = 'balance' AND payment_status = 'pending'")->execute([$reservationId]);
                    $db->prepare("UPDATE financial_ledger_entries SET status = 'Cancelled' WHERE reservation_id = ? AND entry_type = 'customer_payment' AND status = 'Pending verification' AND payment_id IN (SELECT payment_id FROM payments WHERE reservation_id = ? AND payment_type = 'balance' AND payment_status = 'failed')")->execute([$reservationId, $reservationId]);

                    $paidRental = max(0, (float)$current['paid_amount'] - (float)$fees['serviceFee']);
                    $eligibleRental = max(0, $paidRental - (float)$refund['courtRateRefund']);
                    $ownerShare = (float)$fees['courtRate'] > 0
                        ? round((float)$fees['ownerNet'] * $eligibleRental / (float)$fees['courtRate'], 2)
                        : 0.0;
                    $ownerPending = $db->prepare("SELECT ledger_id FROM financial_ledger_entries WHERE reservation_id = ? AND entry_type = 'owner_pending_balance' LIMIT 1 FOR UPDATE");
                    $ownerPending->execute([$reservationId]);
                    $ownerPendingId = $ownerPending->fetchColumn();
                    if ($ownerPendingId) {
                        $db->prepare("UPDATE financial_ledger_entries SET amount = ?, status = 'Held' WHERE ledger_id = ?")->execute([$ownerShare, (int)$ownerPendingId]);
                    } else {
                        writeFinancialLedgerEntry($db, ['idempotencyKey' => 'reservation:' . $reservationId . ':owner-pending', 'type' => 'owner_pending_balance', 'reservationId' => $reservationId, 'userId' => (int)$current['user_id'], 'ownerId' => (int)$current['owner_id'], 'amount' => $ownerShare, 'status' => 'Held', 'metadata' => ['noShow' => true, 'releaseAfterCompletionHours' => (int)($policy['disputeWindowHours'] ?? 48)]]);
                    }

                    $refundId = null;
                    if ((float)$refund['totalRefunded'] > 0) {
                        $refundId = 'REF-NOSHOW-' . $reservationId;
                        $originalPayment = $db->prepare("SELECT payment_id FROM payments WHERE reservation_id = ? AND payment_status = 'paid' ORDER BY payment_id ASC LIMIT 1");
                        $originalPayment->execute([$reservationId]);
                        $originalPaymentId = $originalPayment->fetchColumn();
                        writeFinancialLedgerEntry($db, ['idempotencyKey' => 'reservation:' . $reservationId . ':no-show-refund', 'type' => 'refund', 'reservationId' => $reservationId, 'paymentId' => $originalPaymentId ? (int)$originalPaymentId : null, 'userId' => (int)$current['user_id'], 'ownerId' => (int)$current['owner_id'], 'amount' => (float)$refund['totalRefunded'], 'status' => 'Pending processing', 'metadata' => ['refundId' => $refundId, 'reason' => trim((string)$body['reason']), 'policySnapshot' => $policy]]);
                        $refundRecord = ['id' => $refundId, 'refundId' => $refundId, 'type' => 'refund', 'reservationId' => $reservationId, 'userId' => (int)$current['user_id'], 'ownerId' => (int)$current['owner_id'], 'originalPaymentId' => $originalPaymentId ? (int)$originalPaymentId : null, 'totalRefunded' => (float)$refund['totalRefunded'], 'amount' => (float)$refund['totalRefunded'], 'status' => 'pending', 'reason' => trim((string)$body['reason']), 'createdAt' => date(DATE_ATOM)];
                        [, $paymentRecords] = readStateCollection($db, 'global', 'payments', true);
                        array_unshift($paymentRecords, $refundRecord);
                        writeStateCollection($db, 'global', null, 'payments', $paymentRecords);
                        [, $ownerRefunds] = readStateCollection($db, 'user:' . (int)$current['owner_id'], 'owner.refunds', true);
                        array_unshift($ownerRefunds, $refundRecord);
                        writeStateCollection($db, 'user:' . (int)$current['owner_id'], (int)$current['owner_id'], 'owner.refunds', $ownerRefunds);
                    }

                    $earningState = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'owner.earnings' FOR UPDATE");
                    $earningState->execute(['user:' . (int)$current['owner_id']]);
                    foreach ($earningState->fetchAll() as $earningRow) {
                        $earnings = json_decode((string)$earningRow['state_value'], true);
                        if (!is_array($earnings)) continue;
                        foreach ($earnings as &$earning) {
                            if (!is_array($earning) || (string)($earning['reservationId'] ?? '') !== (string)$reservationId) continue;
                            $earning['reservationStatus'] = 'No-show';
                            $earning['completedAt'] = $completedAt;
                            $earning['releaseAt'] = (new DateTimeImmutable($completedAt))->modify('+' . max(0, (int)($policy['disputeWindowHours'] ?? 48)) . ' hours')->format(DATE_ATOM);
                            $earning['paymentStatus'] = (float)$current['paid_amount'] + 0.01 >= (float)$fees['userTotal'] ? 'paid' : 'partially paid';
                            $earning['ownerNet'] = $ownerShare;
                            $earning['refundedAmount'] = (float)$refund['totalRefunded'];
                            $earning['refundStatus'] = (float)$refund['totalRefunded'] > 0 ? 'pending' : null;
                            $earning['refundId'] = $refundId;
                        }
                        unset($earning);
                        $db->prepare('UPDATE app_state SET state_value = ? WHERE state_id = ?')->execute([json_encode($earnings, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), (int)$earningRow['state_id']]);
                    }
                    $reason = trim((string)$body['reason']);
                    $refundNote = (float)$refund['totalRefunded'] > 0 ? ' A refund of ' . number_format((float)$refund['totalRefunded'], 2) . ' is pending processing.' : ' No refund is due under the saved no-show policy.';
                    storeNotification($db, (int)$current['user_id'], 'Reservation marked no-show', 'Your reservation at ' . $current['name'] . ' was marked no-show. ' . $refundNote . ' Reason: ' . $reason);
                    storeNotification($db, (int)$current['owner_id'], 'Reservation marked no-show', 'Reservation #' . $reservationId . ' at ' . $current['name'] . ' was marked no-show. ' . $refundNote);
                    storeRoleNotifications($db, 'Admin', 'Reservation marked no-show', 'Reservation #' . $reservationId . ' at ' . $current['name'] . ' was marked no-show by ' . $user['name'] . '.' . $refundNote);
                    $db->commit();
                    respond(['success' => true, 'data' => ['id' => $reservationId, 'status' => 'No-show', 'refund' => $refund, 'refundId' => $refundId]]);
                } catch (Throwable $error) {
                    if ($db->inTransaction()) $db->rollBack();
                    throw $error;
                }
            }
            if ($reservation['status'] !== 'Pending') fail('Only pending reservations can be updated.', 409);
            if ($status === 'Confirmed' && (float)$reservation['paid_amount'] + 0.01 < (float)$reservation['deposit_amount']) fail('Verify the required booking deposit before confirming this reservation.', 409);
            $refundProofData = $body['refundProof'] ?? null;
            if ($status === 'Cancelled' && (float)$reservation['paid_amount'] > 0) {
                $validRefundProof = validReceiptImage($refundProofData);
                if (!$validRefundProof) fail('Upload proof of the deposit refund before declining this paid request.', 422);
            }
            $db->beginTransaction();
            try {
                $update = $status === 'Cancelled'
                    ? $db->prepare('UPDATE reservations SET status = ?, completed_at = COALESCE(completed_at, NOW()) WHERE reservation_id = ?')
                    : $db->prepare('UPDATE reservations SET status = ? WHERE reservation_id = ?');
                $update->execute([$status, (int)$id]);
                if ($status === 'Cancelled') {
                    if ((float)$reservation['paid_amount'] > 0) {
                        $db->prepare("UPDATE payments SET payment_status = 'refunded' WHERE reservation_id = ? AND payment_status = 'paid'")->execute([(int)$id]);
                        $db->prepare("UPDATE financial_ledger_entries SET status = 'Refunded' WHERE reservation_id = ? AND entry_type IN ('customer_payment', 'platform_service_fee')")->execute([(int)$id]);
                        writeFinancialLedgerEntry($db, ['idempotencyKey' => 'reservation:' . (int)$id . ':owner-cancel-refund', 'type' => 'refund', 'reservationId' => (int)$id, 'paymentId' => $reservation['deposit_payment_id'] ? (int)$reservation['deposit_payment_id'] : null, 'userId' => (int)$reservation['user_id'], 'ownerId' => $reservation['owner_id'] ? (int)$reservation['owner_id'] : null, 'amount' => (float)$reservation['paid_amount'], 'status' => 'Refunded', 'metadata' => ['reason' => trim((string)$body['reason']), 'processedBy' => (int)$user['id'], 'recordedAt' => date(DATE_ATOM)]]);
                        $refundRecord = ['paymentId' => (int)$reservation['deposit_payment_id'], 'reservationId' => (int)$id, 'image' => $refundProofData, 'uploadedAt' => date(DATE_ATOM), 'recordedBy' => (int)$user['id']];
                        $saveRefundProof = $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'payment.refund.proof', ?) ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), user_id = VALUES(user_id)");
                        $saveRefundProof->execute(['payment:' . (int)$reservation['deposit_payment_id'], (int)$user['id'], json_encode($refundRecord, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
                        $ownerRefund = ['id' => 'REF-OWNER-CANCEL-' . (int)$id, 'refundId' => 'REF-OWNER-CANCEL-' . (int)$id, 'type' => 'refund', 'reservationId' => (int)$id, 'userId' => (int)$reservation['user_id'], 'ownerId' => (int)$reservation['owner_id'], 'originalPaymentId' => (int)$reservation['deposit_payment_id'], 'totalRefunded' => (float)$reservation['paid_amount'], 'amount' => (float)$reservation['paid_amount'], 'status' => 'completed', 'reason' => trim((string)$body['reason']), 'createdAt' => date(DATE_ATOM)];
                        [, $ownerRefunds] = readStateCollection($db, 'user:' . (int)$reservation['owner_id'], 'owner.refunds', true);
                        array_unshift($ownerRefunds, $ownerRefund);
                        writeStateCollection($db, 'user:' . (int)$reservation['owner_id'], (int)$reservation['owner_id'], 'owner.refunds', $ownerRefunds);
                        $earningState = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'owner.earnings' FOR UPDATE");
                        $earningState->execute(['user:' . (int)$reservation['owner_id']]);
                        foreach ($earningState->fetchAll() as $earningRow) {
                            $earnings = json_decode((string)$earningRow['state_value'], true);
                            if (!is_array($earnings)) continue;
                            foreach ($earnings as &$earning) if (is_array($earning) && (string)($earning['reservationId'] ?? '') === (string)$id) { $earning['status'] = 'Refunded'; $earning['reservationStatus'] = 'Cancelled'; $earning['paymentStatus'] = 'refunded'; $earning['refundStatus'] = 'completed'; $earning['refundedAmount'] = (float)$reservation['paid_amount']; }
                            unset($earning);
                            $db->prepare('UPDATE app_state SET state_value = ? WHERE state_id = ?')->execute([json_encode($earnings, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), (int)$earningRow['state_id']]);
                        }
                    }
                    $db->prepare("UPDATE payments SET payment_status = 'failed' WHERE reservation_id = ? AND payment_status = 'pending'")->execute([(int)$id]);
                    if (!empty($reservation['owner_id'])) {
                        $ownerLedger = $db->prepare("UPDATE financial_ledger_entries SET amount = 0, status = ? WHERE reservation_id = ? AND entry_type = 'owner_pending_balance'");
                        $ownerLedger->execute([(float)$reservation['paid_amount'] > 0 ? 'Refunded' : 'Held', (int)$id]);
                        $snapshot = reservationPaymentMetadata($db, (int)$id);
                        $policy = $snapshot['refundPolicy'] ?? ['disputeWindowHours' => 48];
                        $releaseAt = (new DateTimeImmutable())->modify('+' . max(0, (int)($policy['disputeWindowHours'] ?? 48)) . ' hours')->format(DATE_ATOM);
                        $ownerEarnings = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'owner.earnings' FOR UPDATE");
                        $ownerEarnings->execute(['user:' . (int)$reservation['owner_id']]);
                        foreach ($ownerEarnings->fetchAll() as $earningRow) {
                            $earnings = json_decode((string)$earningRow['state_value'], true);
                            if (!is_array($earnings)) continue;
                            foreach ($earnings as &$earning) {
                                if (!is_array($earning) || (string)($earning['reservationId'] ?? '') !== (string)$id) continue;
                                $earning['ownerNet'] = 0;
                                $earning['reservationStatus'] = 'Cancelled';
                                $earning['completedAt'] = date(DATE_ATOM);
                                $earning['releaseAt'] = $releaseAt;
                                $earning['paymentStatus'] = (float)$reservation['paid_amount'] > 0 ? 'refunded' : 'pending';
                                $earning['refundedAmount'] = (float)$reservation['paid_amount'];
                                $earning['refundStatus'] = (float)$reservation['paid_amount'] > 0 ? 'completed' : null;
                            }
                            unset($earning);
                            $db->prepare('UPDATE app_state SET state_value = ? WHERE state_id = ?')->execute([json_encode($earnings, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), (int)$earningRow['state_id']]);
                        }
                    }
                }
                $message = $status === 'Confirmed'
                    ? 'Your reservation at ' . $reservation['name'] . ' has been confirmed.'
                    : 'Your reservation at ' . $reservation['name'] . ' was declined. ' . ((float)$reservation['paid_amount'] > 0 ? 'Your deposit refund has been recorded.' : '') . ' ' . trim((string)$body['reason']);
                storeNotification($db, (int)$reservation['user_id'], 'Reservation ' . strtolower($status), $message);
                $db->commit();
            } catch (Throwable $error) {
                if ($db->inTransaction()) $db->rollBack();
                throw $error;
            }
            respond(['data' => ['id' => (int)$id, 'status' => $status]]);
        }
        $db->beginTransaction();
        $rows = $db->query("SELECT state_id, state_value FROM app_state WHERE state_key = 'reservations' FOR UPDATE")->fetchAll();
        foreach ($rows as $row) {
            $items = json_decode($row['state_value'], true);
            if (!is_array($items)) continue;
            foreach ($items as $index => $reservation) {
                if ((string)($reservation['id'] ?? '') !== $id) continue;
                $facility = $db->prepare('SELECT owner_id FROM facilities WHERE facility_id = ?');
                $facility->execute([$reservation['facilityId'] ?? 0]);
                $ownerId = $facility->fetchColumn();
                if ($user['role'] !== 'Admin' && (int)$ownerId !== (int)$user['id']) {
                    $db->rollBack();
                    fail('You cannot update this reservation.', 403);
                }
                if (($reservation['status'] ?? '') !== 'Pending') {
                    $db->rollBack();
                    fail('Only pending reservations can be updated.', 409);
                }
                $items[$index]['status'] = $status;
                if ($status === 'Cancelled') $items[$index]['cancellationReason'] = trim((string)$body['reason']);
                $save = $db->prepare('UPDATE app_state SET state_value = ? WHERE state_id = ?');
                $save->execute([json_encode($items, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $row['state_id']]);
                storeNotification(
                    $db,
                    (int)($row['user_id'] ?? 0),
                    'Reservation ' . strtolower($status),
                    $status === 'Confirmed'
                        ? 'Your reservation has been confirmed.'
                        : 'Your reservation was cancelled. ' . trim((string)$body['reason']),
                );
                $db->commit();
                respond(['data' => $items[$index]]);
            }
        }
        $db->rollBack();
        fail('Reservation not found.', 404);
    }
    if ($action === 'reservation.cancel.preview') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Only the customer can preview this cancellation.', 403);
        $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$id) fail('Reservation id is invalid.', 422);
        $find = $db->prepare("SELECT r.reservation_id, r.user_id, r.status, r.reservation_date, r.start_time, r.total_amount, f.name,
                                     (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.reservation_id = r.reservation_id AND p.payment_status = 'paid') AS paid_amount
                              FROM reservations r JOIN facilities f ON f.facility_id = r.facility_id WHERE r.reservation_id = ? AND r.user_id = ?");
        $find->execute([(int)$id, (int)$user['id']]);
        $reservation = $find->fetch();
        if (!$reservation) fail('Reservation not found.', 404);
        if (!in_array($reservation['status'], ['Pending', 'Confirmed'], true)) fail('This reservation cannot be cancelled.', 409);
        if (strtotime($reservation['reservation_date'] . ' ' . $reservation['start_time']) <= time()) fail('A reservation cannot be cancelled after its start time.', 409);
        $metadata = reservationPaymentMetadata($db, (int)$id);
        $policy = $metadata['refundPolicy'] ?? ['freeCancelHours' => 24, 'lateCancelRefundRate' => 0.5, 'noShowRefundRate' => 0, 'disputeWindowHours' => 48];
        $fees = reservationFeeSnapshot($db, (int)$id, (float)$reservation['total_amount']);
        $refund = calculateReservationCancellation($reservation, $fees, $policy, (float)$reservation['paid_amount']);
        respond(['data' => [...$refund, 'refundPolicy' => $policy, 'paymentStatus' => $refund['totalRefunded'] > 0 ? 'Pending processing' : 'No refund due']]);
    }
    if ($action === 'reservation.cancel') {
        $user = currentUser($db);
        if ($user['role'] !== 'User') fail('Only the customer can cancel this reservation.', 403);
        $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
        if (!$id) fail('Reservation id is invalid.', 422);
        $db->beginTransaction();
        try {
        $find = $db->prepare("SELECT r.user_id, r.status, r.reservation_date, r.start_time, r.total_amount, f.owner_id, f.name,
                                     (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.reservation_id = r.reservation_id AND p.payment_status = 'paid') AS paid_amount
                              FROM reservations r LEFT JOIN facilities f ON f.facility_id = r.facility_id WHERE r.reservation_id = ? AND r.user_id = ? FOR UPDATE");
        $find->execute([$id, (int)$user['id']]);
        $reservation = $find->fetch();
        if (!$reservation) fail('Reservation not found.', 404);
        if (!in_array($reservation['status'], ['Pending', 'Confirmed'], true)) fail('This reservation cannot be cancelled.', 409);
        if (strtotime($reservation['reservation_date'] . ' ' . $reservation['start_time']) <= time()) fail('A reservation cannot be cancelled after its start time.', 409);
            $metadata = reservationPaymentMetadata($db, (int)$id);
            $policy = $metadata['refundPolicy'] ?? ['freeCancelHours' => 24, 'lateCancelRefundRate' => 0.5, 'noShowRefundRate' => 0, 'disputeWindowHours' => 48];
            $fees = reservationFeeSnapshot($db, (int)$id, (float)$reservation['total_amount']);
            $refund = calculateReservationCancellation($reservation, $fees, $policy, (float)$reservation['paid_amount']);
            $paidRental = max(0, (float)$reservation['paid_amount'] - (float)$fees['serviceFee']);
            $eligibleRental = max(0, $paidRental - (float)$refund['courtRateRefund']);
            $ownerShare = (float)$fees['courtRate'] > 0
                ? round((float)$fees['ownerNet'] * $eligibleRental / (float)$fees['courtRate'], 2)
                : 0.0;
            $releaseAt = (new DateTimeImmutable())->modify('+' . max(0, (int)($policy['disputeWindowHours'] ?? 48)) . ' hours')->format(DATE_ATOM);
            $pendingPayments = $db->prepare("SELECT payment_id FROM payments WHERE reservation_id = ? AND payment_status = 'pending' FOR UPDATE");
            $pendingPayments->execute([(int)$id]);
            foreach ($pendingPayments->fetchAll(PDO::FETCH_COLUMN) as $pendingId) {
                $db->prepare("UPDATE payments SET payment_status = 'failed' WHERE payment_id = ?")->execute([(int)$pendingId]);
                $db->prepare("UPDATE financial_ledger_entries SET status = 'Cancelled' WHERE payment_id = ? AND entry_type IN ('customer_payment', 'platform_service_fee')")->execute([(int)$pendingId]);
            }
            $db->prepare("UPDATE reservations SET status = 'Cancelled', completed_at = COALESCE(completed_at, NOW()) WHERE reservation_id = ?")->execute([(int)$id]);
            $ownerPendingQuery = $db->prepare("SELECT ledger_id FROM financial_ledger_entries WHERE reservation_id = ? AND entry_type = 'owner_pending_balance' LIMIT 1 FOR UPDATE");
            $ownerPendingQuery->execute([(int)$id]);
            $ownerPendingId = $ownerPendingQuery->fetchColumn();
            if ($ownerPendingId) {
                $db->prepare("UPDATE financial_ledger_entries SET amount = ?, status = 'Held' WHERE ledger_id = ?")->execute([$ownerShare, (int)$ownerPendingId]);
            } elseif (!empty($reservation['owner_id'])) {
                writeFinancialLedgerEntry($db, ['idempotencyKey' => 'reservation:' . (int)$id . ':owner-pending', 'type' => 'owner_pending_balance', 'reservationId' => (int)$id, 'userId' => (int)$user['id'], 'ownerId' => (int)$reservation['owner_id'], 'amount' => $ownerShare, 'status' => 'Held', 'metadata' => ['releaseAt' => $releaseAt, 'refundPolicy' => $policy]]);
            }
            $refundId = null;
            if ((float)$refund['totalRefunded'] > 0) {
                $refundId = 'REF-CANCEL-' . (int)$id;
                $originalPaymentQuery = $db->prepare("SELECT payment_id FROM payments WHERE reservation_id = ? AND payment_status = 'paid' ORDER BY payment_id DESC LIMIT 1");
                $originalPaymentQuery->execute([(int)$id]);
                $originalPaymentId = $originalPaymentQuery->fetchColumn();
                writeFinancialLedgerEntry($db, ['idempotencyKey' => 'reservation:' . (int)$id . ':cancellation-refund', 'type' => 'refund', 'reservationId' => (int)$id, 'paymentId' => $originalPaymentId ? (int)$originalPaymentId : null, 'userId' => (int)$user['id'], 'ownerId' => $reservation['owner_id'] ? (int)$reservation['owner_id'] : null, 'amount' => (float)$refund['totalRefunded'], 'status' => 'Pending processing', 'metadata' => ['refundId' => $refundId, 'reason' => $refund['reason'], 'policySnapshot' => $policy]]);
                $refundRecord = ['id' => $refundId, 'refundId' => $refundId, 'type' => 'refund', 'reservationId' => (int)$id, 'userId' => (int)$user['id'], 'ownerId' => $reservation['owner_id'] ? (int)$reservation['owner_id'] : null, 'originalPaymentId' => $originalPaymentId ? (int)$originalPaymentId : null, 'totalRefunded' => (float)$refund['totalRefunded'], 'amount' => (float)$refund['totalRefunded'], 'status' => 'pending', 'reason' => $refund['reason'], 'createdAt' => date(DATE_ATOM)];
                [$paymentStateId, $paymentRecords] = readStateCollection($db, 'global', 'payments', true);
                array_unshift($paymentRecords, $refundRecord);
                writeStateCollection($db, 'global', null, 'payments', $paymentRecords);
                if (!empty($reservation['owner_id'])) {
                    [, $ownerRefunds] = readStateCollection($db, 'user:' . (int)$reservation['owner_id'], 'owner.refunds', true);
                    array_unshift($ownerRefunds, $refundRecord);
                    writeStateCollection($db, 'user:' . (int)$reservation['owner_id'], (int)$reservation['owner_id'], 'owner.refunds', $ownerRefunds);
                }
            }
            $earningState = $db->prepare("SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = 'owner.earnings' FOR UPDATE");
            $earningState->execute(['user:' . (int)$reservation['owner_id']]);
            foreach ($earningState->fetchAll() as $earningRow) {
                $earnings = json_decode((string)$earningRow['state_value'], true);
                if (!is_array($earnings)) continue;
                $changed = false;
                foreach ($earnings as &$earning) {
                    if (!is_array($earning) || (string)($earning['reservationId'] ?? '') !== (string)$id) continue;
                    $earning['reservationStatus'] = 'Cancelled';
                    $earning['ownerNet'] = $ownerShare;
                    $earning['releaseAt'] = $releaseAt;
                    $earning['completedAt'] = date(DATE_ATOM);
                    $earning['paymentStatus'] = (float)$reservation['paid_amount'] + 0.01 >= (float)$fees['userTotal'] ? 'paid' : 'partially paid';
                    $earning['refundedAmount'] = (float)$refund['totalRefunded'];
                    $earning['refundStatus'] = (float)$refund['totalRefunded'] > 0 ? 'pending' : null;
                    $earning['refundId'] = $refundId;
                    $changed = true;
                }
                unset($earning);
                if ($changed) $db->prepare('UPDATE app_state SET state_value = ? WHERE state_id = ?')->execute([json_encode($earnings, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), (int)$earningRow['state_id']]);
            }
            $paidAmount = (float)$reservation['paid_amount'];
            $message = 'Your reservation at ' . $reservation['name'] . ' was cancelled. ' . ($refund['totalRefunded'] > 0 ? 'A refund of ' . number_format((float)$refund['totalRefunded'], 2) . ' is pending processing. ' : 'No refund is due. ') . $refund['reason'];
            storeNotification($db, (int)$user['id'], 'Reservation cancelled', $message);
            if (!empty($reservation['owner_id'])) {
                storeNotification($db, (int)$reservation['owner_id'], 'Reservation cancelled', $user['name'] . ' cancelled a reservation at ' . $reservation['name'] . '.');
            }
            storeRoleNotifications($db, 'Admin', 'Reservation cancelled', $user['name'] . ' cancelled ' . $reservation['name'] . '. ' . ($refund['totalRefunded'] > 0 ? 'Refund ' . number_format((float)$refund['totalRefunded'], 2) . ' is pending processing.' : 'No refund is due.'));
            $db->commit();
            respond(['success' => true, 'data' => ['id' => (int)$id, 'status' => 'Cancelled', 'paidAmount' => $paidAmount, 'refund' => $refund, 'refundId' => $refundId]]);
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
    }
    if ($action === 'financial.earning') {
        $user = currentUser($db);
        $reservation = $body['reservation'] ?? null;
        $ownerId = filter_var($reservation['ownerId'] ?? null, FILTER_VALIDATE_INT);
        if (!is_array($reservation) || !$ownerId) respond(['ok' => true]);
        $ownership = $db->prepare('SELECT owner_id FROM facilities WHERE facility_id = ?');
        $ownership->execute([$reservation['facilityId'] ?? 0]);
        if ((int)$ownership->fetchColumn() !== $ownerId) fail('Facility owner does not match the reservation.', 403);
        $scope = 'user:' . $ownerId;
        $key = 'owner.earnings';
        $read = $db->prepare('SELECT state_id, state_value FROM app_state WHERE scope_key = ? AND state_key = ?');
        $read->execute([$scope, $key]);
        $saved = $read->fetch();
        $earnings = $saved ? json_decode($saved['state_value'], true) : [];
        if (!is_array($earnings)) $earnings = [];
        foreach ($earnings as $existingEarning) {
            if (is_array($existingEarning) && (string)($existingEarning['reservationId'] ?? '') === (string)$reservation['id']) {
                respond(['data' => $existingEarning]);
            }
        }
        $earning = ['id' => 'E-' . $reservation['id'], 'ownerId' => $ownerId, 'reservationId' => $reservation['id'], 'date' => $reservation['date'], 'user' => $user['name'], 'facility' => $reservation['name'], 'courtRate' => $reservation['courtRate'], 'serviceFee' => $reservation['serviceFee'], 'ownerCommission' => $reservation['ownerCommission'], 'ownerNet' => $reservation['ownerNet'], 'status' => 'Pending', 'reservationStatus' => $reservation['status']];
        $earnings = [$earning, ...(is_array($earnings) ? $earnings : [])];
        $save = $db->prepare('INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP');
        $save->execute([$scope, $ownerId, $key, json_encode($earnings, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
        respond(['data' => $earning]);
    }
    if ($action === 'financial.hold') {
        $user = currentUser($db);
        $reservationId = (string)($body['reservationId'] ?? '');
        $isDisputed = (bool)($body['isDisputed'] ?? true);
        $ownsReservation = false;
        if (ctype_digit($reservationId)) {
            $check = $db->prepare('SELECT 1 FROM reservations WHERE reservation_id = ? AND user_id = ?');
            $check->execute([(int)$reservationId, $user['id']]);
            $ownsReservation = (bool)$check->fetchColumn();
        } else {
            $check = $db->prepare("SELECT state_value FROM app_state WHERE user_id = ? AND state_key = 'reservations'");
            $check->execute([$user['id']]);
            foreach ($check->fetchAll(PDO::FETCH_COLUMN) as $value) {
                foreach (json_decode($value, true) ?: [] as $item) if ((string)($item['id'] ?? '') === $reservationId) $ownsReservation = true;
            }
        }
        if (!$ownsReservation) fail('Reservation not found.', 404);
        $rows = $db->prepare("SELECT state_id, state_value FROM app_state WHERE state_key = 'owner.earnings'");
        $rows->execute();
        foreach ($rows->fetchAll() as $row) {
            $earnings = json_decode($row['state_value'], true);
            if (!is_array($earnings)) continue;
            foreach ($earnings as $index => $earning) {
                if ((string)($earning['reservationId'] ?? '') !== $reservationId) continue;
                $earnings[$index]['reservationStatus'] = $isDisputed ? 'Disputed' : 'Completed';
                $save = $db->prepare('UPDATE app_state SET state_value = ? WHERE state_id = ?');
                $save->execute([json_encode($earnings, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $row['state_id']]);
                respond(['data' => $earnings[$index]]);
            }
        }
        respond(['data' => null]);
    }
    if ($action === 'owner.payout.account.add') {
        $user = currentUser($db);
        if ($user['role'] !== 'Facility Owner') fail('Facility owner access is required.', 403);
        $type = trim((string)($body['type'] ?? ''));
        $name = trim((string)($body['name'] ?? ''));
        $number = trim((string)($body['number'] ?? ''));
        $password = (string)($body['password'] ?? '');
        if (!in_array($type, ['GCash', 'Maya', 'Bank'], true) || $name === '' || strlen($name) > 150 ||
            !preg_match('/^[\d -]{8,24}$/D', $number) || strlen(preg_replace('/\D/', '', $number)) < 8 ||
            strlen($password) < 1 || strlen($password) > 256) {
            fail('Enter a valid account type, holder name, account number, and RESERVA password.', 422);
        }
        $passwordQuery = $db->prepare('SELECT password_hash FROM users WHERE user_id = ? LIMIT 1');
        $passwordQuery->execute([(int)$user['id']]);
        $passwordHash = $passwordQuery->fetchColumn();
        if (!is_string($passwordHash) || !password_verify($password, $passwordHash)) {
            fail('Your RESERVA password is incorrect.', 401);
        }
        $db->beginTransaction();
        try {
            $scope = 'user:' . (int)$user['id'];
            $ensure = $db->prepare("INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, 'owner.payoutAccounts', '[]') ON DUPLICATE KEY UPDATE state_id = LAST_INSERT_ID(state_id)");
            $ensure->execute([$scope, (int)$user['id']]);
            [, $accounts] = readStateCollection($db, $scope, 'owner.payoutAccounts', true);
            $account = [
                'id' => 'PA-' . strtoupper(bin2hex(random_bytes(8))),
                'type' => $type,
                'name' => $name,
                'number' => $number,
                'verified' => false,
                'verificationStatus' => 'Pending review',
                'createdAt' => date(DATE_ATOM),
                'reviewNote' => '',
            ];
            array_unshift($accounts, $account);
            writeStateCollection($db, $scope, (int)$user['id'], 'owner.payoutAccounts', $accounts);
            storeNotification($db, (int)$user['id'], 'Payout destination submitted', 'Your ' . $type . ' payout destination ending in ' . substr($number, -4) . ' was submitted for administrator review.');
            storeRoleNotifications($db, 'Admin', 'Payout destination needs review', $user['name'] . ' submitted a ' . $type . ' payout destination for review.');
            $db->commit();
            respond(['data' => $account], 201);
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }
    }
    if ($action === 'state.get' || $action === 'state.put' || $action === 'state.list') {
        $user = currentUser($db);
        $key = trim((string)($body['key'] ?? $_GET['key'] ?? ''));
        if ($key === '' || strlen($key) > 100) fail('A valid state key is required.');
        if ($action === 'state.list') {
            if (!in_array($user['role'], ['Admin', 'Facility Owner'], true)) fail('Owner or administrator access is required.', 403);
            if ($user['role'] === 'Facility Owner' && $key !== 'reservations') fail('This state collection is restricted.', 403);
            $query = $db->prepare('SELECT state_value FROM app_state WHERE state_key = ? ORDER BY updated_at DESC');
            $query->execute([$key]);
            $values = array_map(static fn(string $value): mixed => json_decode($value, true), $query->fetchAll(PDO::FETCH_COLUMN));
            if ($user['role'] === 'Facility Owner' && $key === 'reservations') {
                $values = array_map(function ($value) use ($db, $user) {
                    if (!is_array($value)) return [];
                    return array_values(array_filter($value, function ($reservation) use ($db, $user) {
                        $owner = $db->prepare('SELECT owner_id FROM facilities WHERE facility_id = ?');
                        $owner->execute([$reservation['facilityId'] ?? 0]);
                        return (int)$owner->fetchColumn() === (int)$user['id'];
                    }));
                }, $values);
            }
            respond(['data' => $values]);
        }
        $isGlobal = str_starts_with($key, 'platform.') || str_starts_with($key, 'admin.');
        if ($isGlobal && $action === 'state.put' && $user['role'] !== 'Admin') fail('Administrator access is required.', 403);
        $scope = $isGlobal ? 'global' : 'user:' . $user['id'];
        if ($action === 'state.get') {
            $query = $db->prepare('SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = ?');
            $query->execute([$scope, $key]);
            $value = $query->fetchColumn();
            respond(['data' => $value === false ? null : json_decode($value, true)]);
        }
        if (!array_key_exists('value', $body)) fail('A state value is required.');
        if ($key === 'owner.payoutAccounts') fail('Payout destinations can only be submitted and reviewed through the secure payout workflow.', 403);
        $isOwnerApplication = $key === 'owner.application';
        if ($isOwnerApplication) {
            if ($user['role'] !== 'Facility Owner') fail('Facility owner access is required.', 403);
            $application = $body['value'];
            if (!is_array($application)) fail('The owner application details are invalid.', 422);
            $ownerDetails = is_array($application['owner'] ?? null) ? $application['owner'] : [];
            $business = is_array($application['business'] ?? null) ? $application['business'] : [];
            $ownerName = trim((string)($ownerDetails['fullName'] ?? ''));
            $ownerEmail = strtolower(trim((string)($ownerDetails['email'] ?? '')));
            $ownerPhone = trim((string)($ownerDetails['phone'] ?? ''));
            $businessName = trim((string)($business['name'] ?? ''));
            $businessAddress = trim((string)($business['address'] ?? ''));
            $businessContact = trim((string)($business['contact'] ?? ''));
            $ownership = trim((string)($business['ownership'] ?? ''));
            if ($ownerName === '' || strlen($ownerName) > 150 || !filter_var($ownerEmail, FILTER_VALIDATE_EMAIL) ||
                !preg_match('/^[+()\d\s-]{7,20}$/D', $ownerPhone) || $businessName === '' || strlen($businessName) > 150 ||
                $businessAddress === '' || strlen($businessAddress) > 500 || !preg_match('/^[+()\d\s-]{7,20}$/D', $businessContact) ||
                $ownership === '') {
                fail('Complete the owner and business details before submitting the application.', 422);
            }
            $emailCheck = $db->prepare('SELECT user_id FROM users WHERE email = ? AND user_id <> ? LIMIT 1');
            $emailCheck->execute([$ownerEmail, (int)$user['id']]);
            if ($emailCheck->fetchColumn()) fail('An account with this email address already exists.', 409);
            $facilityInputs = $application['facilities'] ?? [$application['facility'] ?? []];
            if (!is_array($facilityInputs) || !$facilityInputs || count($facilityInputs) > 20) {
                fail('Add between 1 and 20 complete facility listings.', 422);
            }
            $sportCheck = $db->prepare('SELECT sport_id FROM sports WHERE name = ? LIMIT 1');
            $amenityCheck = $db->prepare('SELECT amenity_id FROM amenities WHERE amenity_name = ? LIMIT 1');
            $sanitizedFacilities = [];
            foreach ($facilityInputs as $facility) {
                if (!is_array($facility)) fail('A facility listing contains invalid details.', 422);
                $facilityName = trim((string)($facility['name'] ?? ''));
                $sport = trim((string)($facility['sport'] ?? ''));
                $courtCount = filter_var($facility['courtCount'] ?? null, FILTER_VALIDATE_INT);
                $hourlyRate = $facility['hourlyRate'] ?? null;
                $openingTime = (string)($facility['openingTime'] ?? '');
                $closingTime = (string)($facility['closingTime'] ?? '');
                $amenityNames = $facility['amenities'] ?? [];
                if ($facilityName === '' || strlen($facilityName) > 150 || $sport === '' ||
                    !$courtCount || $courtCount < 1 || $courtCount > 20 || !is_numeric($hourlyRate) || (float)$hourlyRate <= 0 ||
                    !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D', $openingTime) ||
                    !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D', $closingTime) || $openingTime >= $closingTime ||
                    !is_array($amenityNames)) {
                    fail('Complete all facility listing details before submitting the application.', 422);
                }
                $sportCheck->execute([$sport]);
                if (!$sportCheck->fetchColumn()) fail('Choose a sport listed in the database for each facility.', 422);
                foreach ($amenityNames as $amenityName) {
                    if (!is_string($amenityName)) fail('Choose amenities listed in the database.', 422);
                }
                $amenityNames = array_values(array_unique($amenityNames));
                foreach ($amenityNames as $amenityName) {
                    $amenityCheck->execute([$amenityName]);
                    if (!$amenityCheck->fetchColumn()) fail('Choose amenities listed in the database.', 422);
                }
                $equipmentCatalog = hasEquipmentRentalAmenity($amenityNames)
                    ? normalizeEquipmentCatalog($facility['equipmentCategories'] ?? [])
                    : [];
                $photoNames = $facility['photoNames'] ?? [];
                if (!is_array($photoNames) || array_filter($photoNames, static fn(mixed $name): bool => !is_string($name)) !== []) {
                    $photoNames = [];
                }
                $facilityImage = validateFacilityImage($facility['image'] ?? null);
                $sanitizedFacilities[] = [
                    'name' => $facilityName,
                    'sport' => $sport,
                    'courtCount' => $courtCount,
                    'hourlyRate' => (float)$hourlyRate,
                    'openingTime' => $openingTime,
                    'closingTime' => $closingTime,
                    'amenities' => $amenityNames,
                    'equipmentCategories' => $equipmentCatalog,
                    'photoNames' => array_values($photoNames),
                    'image' => $facilityImage,
                ];
            }
            $existingQuery = $db->prepare("SELECT state_value FROM app_state WHERE scope_key = ? AND state_key = 'owner.application' LIMIT 1");
            $existingQuery->execute(['user:' . (int)$user['id']]);
            $existingApplication = json_decode((string)($existingQuery->fetchColumn() ?: ''), true);
            if (is_array($existingApplication) && ($existingApplication['status'] ?? '') !== 'Needs changes') {
                fail('Your current owner application cannot be replaced.', 409);
            }
            $application['owner'] = ['fullName' => $ownerName, 'email' => $ownerEmail, 'phone' => $ownerPhone];
            $application['business'] = ['name' => $businessName, 'address' => $businessAddress, 'contact' => $businessContact, 'ownership' => $ownership];
            $application['facilities'] = $sanitizedFacilities;
            $application['facility'] = $sanitizedFacilities[0];
            $application['id'] = is_array($existingApplication) ? $existingApplication['id'] : 'APP-' . strtoupper(bin2hex(random_bytes(8)));
            $application['status'] = 'Pending review';
            $application['submittedAt'] = date(DATE_ATOM);
            $application['detailsComplete'] = true;
            $body['value'] = $application;
        }
        $reservationLock = false;
        if ($key === 'reservations') {
            if (!is_array($body['value'])) fail('Reservation state must be a list.', 422);
            $lock = $db->query("SELECT GET_LOCK('reserva_reservations', 5)")->fetchColumn();
            if ((int)$lock !== 1) fail('Booking service is busy. Please retry.', 503);
            $reservationLock = true;
            $conflict = reservationConflict($db, $body['value'], (int)$user['id']);
            if ($conflict) {
                $db->query("SELECT RELEASE_LOCK('reserva_reservations')");
                fail($conflict, 409);
            }
        }
        $save = $db->prepare(
            'INSERT INTO app_state (scope_key, user_id, state_key, state_value) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP'
        );
        $applicationJson = json_encode($body['value'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        if ($isOwnerApplication) $db->beginTransaction();
        try {
            if ($isOwnerApplication) {
                $updateOwner = $db->prepare('UPDATE users SET full_name = ?, email = ?, phone = ? WHERE user_id = ?');
                $updateOwner->execute([$ownerName, $ownerEmail, $ownerPhone, (int)$user['id']]);
            }
            $save->execute([$scope, $isGlobal ? null : $user['id'], $key, $applicationJson]);
            if ($isOwnerApplication) {
                $clearDraft = $db->prepare("DELETE FROM app_state WHERE scope_key = ? AND state_key = 'owner.applicationDraft'");
                $clearDraft->execute(['user:' . (int)$user['id']]);
                storeRoleNotifications(
                    $db,
                    'Admin',
                    'New facility owner application',
                    $ownerName . ' submitted an application to become a facility owner.',
                );
                $db->commit();
            }
        } catch (Throwable $error) {
            if ($isOwnerApplication && $db->inTransaction()) $db->rollBack();
            if ($error instanceof PDOException && $error->getCode() === '23000') fail('An account with this email address already exists.', 409);
            throw $error;
        }
        if ($reservationLock) $db->query("SELECT RELEASE_LOCK('reserva_reservations')");
        if ($isOwnerApplication) respond(['ok' => true, 'data' => $body['value']]);
        respond(['ok' => true]);
    }
    fail('Unknown API action.', 404);
} catch (ApiException $error) {
    fail($error->getMessage(), $error->status);
} catch (Throwable $error) {
    error_log($error->__toString());
    fail('The server could not complete the request.', 500);
}
