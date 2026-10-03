-- Fat Tixx — migration 0005: presale access codes, private links, add-ons, waitlist,
-- multi-day schedules & passes, recurring series, multiple checkout questions.

-- ---------------------------------------------------------------------------
-- Events: private-link key, recurring series, waitlist toggle
-- ---------------------------------------------------------------------------
ALTER TABLE events
  ADD COLUMN private_key CHAR(16) NULL AFTER visibility,              -- private events: link must carry ?key=
  ADD COLUMN series_id CHAR(16) NULL AFTER slug,                      -- recurring events share a series id
  ADD COLUMN waitlist_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER capacity,
  ADD KEY idx_event_series (series_id);

-- Existing private events get a key so their links keep working through the organizer page.
UPDATE events SET private_key = SUBSTRING(MD5(CONCAT(id, RAND())), 1, 16) WHERE visibility = 'private' AND private_key IS NULL;

-- ---------------------------------------------------------------------------
-- Multi-day schedule. Empty = single-day event (events.starts_at / ends_at / doors_at apply).
-- When rows exist, events.starts_at / ends_at / doors_at mirror the first / last day.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_dates (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id    BIGINT UNSIGNED NOT NULL,
  label       VARCHAR(80)  NULL,            -- "Day 1", "Friday", "Opening night"
  starts_at   DATETIME     NOT NULL,        -- UTC
  ends_at     DATETIME     NULL,
  doors_at    DATETIME     NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ed_event (event_id, starts_at),
  CONSTRAINT fk_ed_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Ticket types: presale access code; day restriction (NULL = valid every day = pass)
-- ---------------------------------------------------------------------------
ALTER TABLE ticket_types
  ADD COLUMN access_code VARCHAR(40) NULL AFTER hidden,
  ADD COLUMN event_date_id BIGINT UNSIGNED NULL AFTER seats_per_unit,
  ADD CONSTRAINT fk_tt_date FOREIGN KEY (event_date_id) REFERENCES event_dates(id) ON DELETE SET NULL;

-- Passes on multi-day events are admitted once per day; remember the last day admitted.
ALTER TABLE tickets
  ADD COLUMN last_checkin_date_id BIGINT UNSIGNED NULL AFTER checked_in_by,
  ADD CONSTRAINT fk_ticket_last_date FOREIGN KEY (last_checkin_date_id) REFERENCES event_dates(id) ON DELETE SET NULL;

ALTER TABLE checkin_log
  MODIFY COLUMN result ENUM('valid','already_used','cancelled','refunded','transferred','wrong_event','wrong_day','invalid','manual','override','undo') NOT NULL;

-- ---------------------------------------------------------------------------
-- Add-ons (parking, merchandise, …). Sold alongside tickets; never produce a QR code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_addons (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id        BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(120) NOT NULL,
  description     VARCHAR(500) NULL,
  price_cents     INT UNSIGNED NOT NULL DEFAULT 0,
  quantity        INT UNSIGNED NULL,               -- NULL = unlimited
  sold            INT UNSIGNED NOT NULL DEFAULT 0,
  max_per_order   INT UNSIGNED NOT NULL DEFAULT 10,
  active          TINYINT(1) NOT NULL DEFAULT 1,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_addon_event (event_id),
  CONSTRAINT fk_addon_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_addons (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id                BIGINT UNSIGNED NOT NULL,
  addon_id                BIGINT UNSIGNED NOT NULL,
  addon_name              VARCHAR(120)    NOT NULL,   -- snapshot
  quantity                INT UNSIGNED    NOT NULL,
  unit_price_cents        INT UNSIGNED    NOT NULL,
  unit_platform_fee_cents INT UNSIGNED    NOT NULL DEFAULT 0,
  unit_tax_cents          INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_oa_order (order_id),
  KEY idx_oa_addon (addon_id),
  CONSTRAINT fk_oa_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  -- Cascade so a forced event delete (Super Admin) can remove add-ons and orders in any order.
  CONSTRAINT fk_oa_addon FOREIGN KEY (addon_id) REFERENCES event_addons(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Checkout questions (per event, any number) and the answers given per order
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_questions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id    BIGINT UNSIGNED NOT NULL,
  label       VARCHAR(200) NOT NULL,
  kind        ENUM('text','textarea','select','checkbox') NOT NULL DEFAULT 'text',
  required    TINYINT(1) NOT NULL DEFAULT 0,
  options     TEXT NULL,                       -- select: one option per line
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_eq_event (event_id),
  CONSTRAINT fk_eq_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_answers (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id        BIGINT UNSIGNED NOT NULL,
  question_id     BIGINT UNSIGNED NULL,
  question_label  VARCHAR(200) NOT NULL,        -- snapshot
  answer          VARCHAR(1000) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_oa_order_q (order_id),
  CONSTRAINT fk_oans_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oans_q FOREIGN KEY (question_id) REFERENCES event_questions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Carry the old single question over so nothing is lost.
INSERT INTO event_questions (event_id, label, kind, required, sort_order)
  SELECT id, checkout_question, 'text', 0, 0 FROM events WHERE checkout_question IS NOT NULL AND checkout_question <> '';
INSERT INTO order_answers (order_id, question_id, question_label, answer)
  SELECT o.id, q.id, e.checkout_question, o.checkout_answer FROM orders o JOIN events e ON e.id = o.event_id
    JOIN event_questions q ON q.event_id = e.id AND q.label = e.checkout_question
   WHERE o.checkout_answer IS NOT NULL AND o.checkout_answer <> '';

-- ---------------------------------------------------------------------------
-- Waitlist (per event, optionally per ticket type)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id        BIGINT UNSIGNED NOT NULL,
  ticket_type_id  BIGINT UNSIGNED NULL,          -- NULL = any ticket
  email           VARCHAR(255) NOT NULL,
  name            VARCHAR(160) NULL,
  quantity        INT UNSIGNED NOT NULL DEFAULT 1,
  status          ENUM('waiting','notified','converted','removed') NOT NULL DEFAULT 'waiting',
  token           CHAR(32) NOT NULL,             -- unsubscribe / identify link
  notified_at     DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wl_token (token),
  KEY idx_wl_event_status (event_id, status, created_at),
  KEY idx_wl_email (email),
  CONSTRAINT fk_wl_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_wl_tt FOREIGN KEY (ticket_type_id) REFERENCES ticket_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
