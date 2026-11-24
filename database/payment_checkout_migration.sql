-- Run once after backend_extensions.sql against reserva_db.
-- Adds saved e-wallet accounts and an auditable payment/finance ledger.
-- No existing reservation or payment rows are deleted.

USE `reserva_db`;

CREATE TABLE IF NOT EXISTS `user_payment_methods` (
  `saved_payment_method_id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `method_type` ENUM('GCash', 'Maya') NOT NULL,
  `account_name` VARCHAR(150) NOT NULL,
  `mobile_ciphertext` TEXT NOT NULL,
  `account_fingerprint` CHAR(64) NOT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_user_payment_account` (`user_id`, `method_type`, `account_fingerprint`),
  KEY `idx_user_payment_methods_default` (`user_id`, `is_default`),
  CONSTRAINT `fk_user_payment_methods_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `payments`
  ADD COLUMN `payment_type` VARCHAR(20) NOT NULL DEFAULT 'legacy' AFTER `amount`,
  ADD COLUMN `idempotency_key` VARCHAR(120) DEFAULT NULL AFTER `transaction_reference`,
  ADD COLUMN `proof_location` VARCHAR(150) DEFAULT NULL AFTER `transaction_reference`,
  ADD COLUMN `user_payment_method_id` INT DEFAULT NULL AFTER `method_id`,
  ADD COLUMN `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `paid_at`,
  ADD UNIQUE KEY `uq_payments_idempotency` (`idempotency_key`),
  ADD KEY `idx_payments_reservation_type` (`reservation_id`, `payment_type`, `payment_status`),
  ADD CONSTRAINT `fk_payments_saved_method` FOREIGN KEY (`user_payment_method_id`) REFERENCES `user_payment_methods` (`saved_payment_method_id`) ON DELETE SET NULL;

-- Keep historical payment dates meaningful where paid_at is not populated.
UPDATE `payments` p
JOIN `reservations` r ON r.`reservation_id` = p.`reservation_id`
SET p.`created_at` = COALESCE(p.`paid_at`, r.`created_at`);

-- Existing one-time deposits predate the full/downpayment choices and remain labeled as legacy.
UPDATE `payments` SET `payment_type` = 'legacy' WHERE `payment_type` = 'full';

ALTER TABLE `payments`
  MODIFY COLUMN `payment_status` ENUM('paid', 'pending', 'failed', 'refunded', 'held', 'released', 'partially_refunded') NOT NULL DEFAULT 'pending',
  MODIFY COLUMN `paid_at` TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE `reservations`
  ADD COLUMN `completed_at` DATETIME DEFAULT NULL AFTER `created_at`,
  MODIFY COLUMN `status` ENUM('Confirmed', 'Pending', 'Pending payment', 'Payment verification', 'Checked in', 'Completed', 'Cancelled', 'Disputed', 'Refunded', 'No-show') DEFAULT 'Pending';

CREATE TABLE IF NOT EXISTS `financial_ledger_entries` (
  `ledger_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `idempotency_key` VARCHAR(160) NOT NULL,
  `entry_type` VARCHAR(40) NOT NULL,
  `reservation_id` INT DEFAULT NULL,
  `payment_id` INT DEFAULT NULL,
  `user_id` INT DEFAULT NULL,
  `owner_id` INT DEFAULT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `external_reference` VARCHAR(150) DEFAULT NULL,
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_financial_ledger_idempotency` (`idempotency_key`),
  KEY `idx_financial_ledger_reservation` (`reservation_id`, `created_at`),
  KEY `idx_financial_ledger_owner_status` (`owner_id`, `status`, `created_at`),
  CONSTRAINT `fk_financial_ledger_reservation` FOREIGN KEY (`reservation_id`) REFERENCES `reservations` (`reservation_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_financial_ledger_payment` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`payment_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_financial_ledger_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_financial_ledger_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
