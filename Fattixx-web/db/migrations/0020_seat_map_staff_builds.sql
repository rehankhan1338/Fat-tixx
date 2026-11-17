-- Fattixx — migration 0020: seat maps built by Fattixx staff without an organizer's request, and builder autosave.
--  * floor_plan_path / floor_plan_kind: the floor plan a Super Admin uploads when starting a map from Admin → Seat maps
--    (maps built for a request keep using the request's floor plan).
--  * draft_layout: the builder's autosave, written every few seconds of editing. It is the work in progress since the
--    last Save ({ "layout": …, "name": … }); Save writes it to `layout`, logs the change list and clears it, so the change
--    history only lists real saves. NULL when there is nothing unsaved.
--
-- Safe to run more than once, on MySQL and MariaDB: each column is added only if it is missing (MySQL has no
-- ADD COLUMN IF NOT EXISTS, so each step checks information_schema and runs the ALTER as a prepared statement).

SET @t = 'seat_maps';

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'floor_plan_path') = 0,
  'ALTER TABLE seat_maps ADD COLUMN floor_plan_path VARCHAR(500) NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'floor_plan_kind') = 0,
  'ALTER TABLE seat_maps ADD COLUMN floor_plan_kind ENUM(''image'',''pdf'',''spreadsheet'') NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'draft_layout') = 0,
  'ALTER TABLE seat_maps ADD COLUMN draft_layout LONGTEXT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'draft_saved_at') = 0,
  'ALTER TABLE seat_maps ADD COLUMN draft_saved_at DATETIME NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @t AND COLUMN_NAME = 'draft_saved_by') = 0,
  'ALTER TABLE seat_maps ADD COLUMN draft_saved_by BIGINT UNSIGNED NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
