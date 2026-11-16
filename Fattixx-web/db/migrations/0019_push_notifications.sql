-- Fattixx — migration 0019: push notifications for the Scan Manager app (Fattixx-app).
-- The app registers its Expo push token after sign-in (POST /api/mobile/v1/devices). Each token belongs to the
-- app session that registered it: a revoked or expired session stops receiving pushes, and deleting the session
-- row removes the device. Notifications are queued in push_outbox and sent through Expo's push service
-- (src/lib/push.ts); the minute job retries failures and reads Expo's receipts.
CREATE TABLE IF NOT EXISTS push_devices (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  session_id    CHAR(64)        NOT NULL,
  token         VARCHAR(255)    NOT NULL,            -- ExponentPushToken[...]
  platform      ENUM('ios','android') NOT NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at   DATETIME        NULL,                -- Expo said the app is no longer installed
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_token (token),
  KEY idx_push_user (user_id),
  KEY idx_push_session (session_id),
  CONSTRAINT fk_push_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  CONSTRAINT fk_push_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per notification per device.
CREATE TABLE IF NOT EXISTS push_outbox (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id        BIGINT UNSIGNED NOT NULL,
  kind             VARCHAR(40)     NOT NULL,         -- staff_assigned, doors_soon, event_changed, ...
  title            VARCHAR(120)    NOT NULL,
  body             VARCHAR(300)    NOT NULL,
  url              VARCHAR(200)    NULL,             -- app route opened on tap, e.g. /event/<org>/<id>
  status           ENUM('queued','sent','delivered','failed') NOT NULL DEFAULT 'queued',
  attempts         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claim_token      CHAR(24)        NULL,             -- which sender run claimed it
  claimed_until    DATETIME        NULL,             -- that sender is working on it until then
  expo_ticket_id   VARCHAR(64)     NULL,
  error            VARCHAR(255)    NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at          DATETIME        NULL,
  PRIMARY KEY (id),
  KEY idx_po_due (status, next_attempt_at),
  KEY idx_po_receipts (status, sent_at),
  CONSTRAINT fk_po_device FOREIGN KEY (device_id) REFERENCES push_devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Once-per-event notifications are claimed with these, like events.reminder_sent_at.
-- push_on_publish is the "Send a push notification to the team" switch on the create form: the "new event" push goes
-- out once, when the event first goes live (published right away, a draft published later, or released by verification).
-- Plain ADD COLUMN: MySQL (production) has no ADD COLUMN IF NOT EXISTS, which is MariaDB-only.
ALTER TABLE events
  ADD COLUMN push_on_publish        TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN published_push_sent_at DATETIME NULL,
  ADD COLUMN doors_push_sent_at     DATETIME NULL,
  ADD COLUMN sold_out_push_sent_at  DATETIME NULL;
