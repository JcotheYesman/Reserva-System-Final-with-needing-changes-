-- Run once against reserva_db after backend_extensions.sql and payment_checkout_migration.sql.
-- Adds facility equipment catalogs and reservation-level rental snapshots.

USE `reserva_db`;

INSERT INTO `amenities` (`amenity_name`)
SELECT 'Equipment Rental'
WHERE NOT EXISTS (
  SELECT 1 FROM `amenities` WHERE LOWER(`amenity_name`) = LOWER('Equipment Rental')
);

CREATE TABLE IF NOT EXISTS `facility_equipment_categories` (
  `equipment_category_id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `facility_id` INT NOT NULL,
  `category_name` VARCHAR(100) NOT NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_equipment_category_facility_order` (`facility_id`, `display_order`),
  CONSTRAINT `fk_equipment_category_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities` (`facility_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `facility_equipment_items` (
  `equipment_item_id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `equipment_category_id` INT NOT NULL,
  `item_name` VARCHAR(120) NOT NULL,
  `unit_price` DECIMAL(10,2) NOT NULL,
  `billing_unit` ENUM('hour', 'piece') NOT NULL DEFAULT 'hour',
  `stock_quantity` INT NOT NULL DEFAULT 1,
  `image_data` MEDIUMBLOB DEFAULT NULL,
  `image_mime` VARCHAR(32) DEFAULT NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_equipment_item_category_order` (`equipment_category_id`, `display_order`),
  CONSTRAINT `fk_equipment_item_category` FOREIGN KEY (`equipment_category_id`) REFERENCES `facility_equipment_categories` (`equipment_category_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `reservation_equipment_items` (
  `reservation_equipment_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `reservation_id` INT NOT NULL,
  `equipment_item_id` INT DEFAULT NULL,
  `category_name_snapshot` VARCHAR(100) NOT NULL,
  `item_name_snapshot` VARCHAR(120) NOT NULL,
  `billing_unit_snapshot` ENUM('hour', 'piece') NOT NULL,
  `unit_price_snapshot` DECIMAL(10,2) NOT NULL,
  `quantity` INT NOT NULL,
  `billed_hours` INT NOT NULL DEFAULT 0,
  `line_total` DECIMAL(10,2) NOT NULL,
  `image_data_snapshot` MEDIUMBLOB DEFAULT NULL,
  `image_mime_snapshot` VARCHAR(32) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_reservation_equipment_reservation` (`reservation_id`),
  KEY `idx_reservation_equipment_item` (`equipment_item_id`),
  CONSTRAINT `fk_reservation_equipment_reservation` FOREIGN KEY (`reservation_id`) REFERENCES `reservations` (`reservation_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reservation_equipment_item` FOREIGN KEY (`equipment_item_id`) REFERENCES `facility_equipment_items` (`equipment_item_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
