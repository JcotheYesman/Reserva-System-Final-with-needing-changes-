USE `reserva_db`;

CREATE TABLE IF NOT EXISTS `app_state` (
  `state_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `scope_key` VARCHAR(64) NOT NULL,
  `user_id` INT DEFAULT NULL,
  `state_key` VARCHAR(100) NOT NULL,
  `state_value` JSON NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_app_state_scope_key` (`scope_key`, `state_key`),
  CONSTRAINT `fk_app_state_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `inquiry_details` (
  `inquiry_id` INT NOT NULL PRIMARY KEY,
  `facility_id` INT NOT NULL,
  `owner_read` TINYINT(1) NOT NULL DEFAULT 0,
  `replies` JSON NOT NULL,
  CONSTRAINT `fk_inquiry_details_inquiry` FOREIGN KEY (`inquiry_id`) REFERENCES `inquiries` (`inquiry_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_inquiry_details_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities` (`facility_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `reservation_courts`
  ADD COLUMN IF NOT EXISTS `start_time` TIME NULL,
  ADD COLUMN IF NOT EXISTS `end_time` TIME NULL,
  ADD COLUMN IF NOT EXISTS `hourly_rate` DECIMAL(10,2) NULL;

UPDATE `reservation_courts` rc
JOIN `reservations` r ON r.reservation_id = rc.reservation_id
JOIN (
  SELECT reservation_id, COUNT(*) AS court_count
  FROM `reservation_courts`
  GROUP BY reservation_id
) counts ON counts.reservation_id = rc.reservation_id
SET rc.start_time = COALESCE(rc.start_time, r.start_time),
    rc.end_time = COALESCE(rc.end_time, r.end_time),
    rc.hourly_rate = COALESCE(
      rc.hourly_rate,
      ROUND(r.total_amount / NULLIF((TIME_TO_SEC(TIMEDIFF(r.end_time, r.start_time)) / 3600) * counts.court_count, 0), 2)
    )
WHERE rc.start_time IS NULL OR rc.end_time IS NULL OR rc.hourly_rate IS NULL;
