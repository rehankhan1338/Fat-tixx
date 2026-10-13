-- Fat Tixx — migration 0007: remaining project-plan items.
--   Phase 1: per-account limits, offline scan sync, email retries, reminders, daily reconciliation marker.
--   Phase 2: promo codes, promoter / UTM tracking links, sponsors, modular ad system, virtual waiting room,
--            organizer applications, SMS outbox, organization tracking pixels.

-- ---------------------------------------------------------------------------
-- Per-account purchase limits (plan 6.2). NULL = no limit beyond max_per_order.
-- ---------------------------------------------------------------------------
ALTER TABLE ticket_types
  ADD COLUMN IF NOT EXISTS max_per_account INT UNSIGNED NULL AFTER max_per_order;

-- ---------------------------------------------------------------------------
-- Promo / discount codes (plan 5.2, Phase 2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promo_codes (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id         BIGINT UNSIGNED NOT NULL,
  code             VARCHAR(40)  NOT NULL,           -- stored upper-case
  kind             ENUM('percent','amount') NOT NULL,
  value            INT UNSIGNED NOT NULL,           -- percent: bps (1000 = 10 %); amount: cents off per ticket
  ticket_type_ids  VARCHAR(500) NULL,               -- comma-separated ids; NULL = every ticket type
  max_uses         INT UNSIGNED NULL,               -- tickets, not orders; NULL = unlimited
  starts_at        DATETIME NULL,
  ends_at          DATETIME NULL,
  active           TINYINT(1) NOT NULL DEFAULT 1,
  created_by       BIGINT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_promo_event_code (event_id, code),
  CONSTRAINT fk_promo_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_promo_user  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Promoter / affiliate tracking links (plan 5.2, Phase 2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracking_links (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  event_id         BIGINT UNSIGNED NULL,            -- NULL = any event of the organization
  code             VARCHAR(40)  NOT NULL,           -- ?ref=<code>
  name             VARCHAR(120) NOT NULL,           -- promoter / channel name
  utm_source       VARCHAR(80)  NULL,
  utm_medium       VARCHAR(80)  NULL,
  utm_campaign     VARCHAR(120) NULL,
  clicks           INT UNSIGNED NOT NULL DEFAULT 0,
  active           TINYINT(1) NOT NULL DEFAULT 1,
  created_by       BIGINT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tl_code (code),
  KEY idx_tl_org (organization_id),
  CONSTRAINT fk_tl_org   FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_tl_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_tl_user  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS promo_code_id    BIGINT UNSIGNED NULL AFTER marketing_opt_in,
  ADD COLUMN IF NOT EXISTS discount_cents   INT UNSIGNED NOT NULL DEFAULT 0 AFTER subtotal_cents,
  ADD COLUMN IF NOT EXISTS tracking_link_id BIGINT UNSIGNED NULL AFTER promo_code_id,
  ADD COLUMN IF NOT EXISTS utm_source       VARCHAR(80)  NULL AFTER tracking_link_id,
  ADD COLUMN IF NOT EXISTS utm_medium       VARCHAR(80)  NULL AFTER utm_source,
  ADD COLUMN IF NOT EXISTS utm_campaign     VARCHAR(120) NULL AFTER utm_medium,
  ADD COLUMN IF NOT EXISTS channel          ENUM('web','embed') NOT NULL DEFAULT 'web' AFTER utm_campaign,
  ADD KEY IF NOT EXISTS idx_order_promo (promo_code_id),
  ADD KEY IF NOT EXISTS idx_order_tl (tracking_link_id),
  ADD CONSTRAINT fk_order_promo FOREIGN KEY IF NOT EXISTS (promo_code_id) REFERENCES promo_codes(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_order_tl    FOREIGN KEY IF NOT EXISTS (tracking_link_id) REFERENCES tracking_links(id) ON DELETE SET NULL;

-- unit_price_cents stays "what the buyer was charged per unit"; the discount is kept alongside for reporting.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS unit_discount_cents INT UNSIGNED NOT NULL DEFAULT 0 AFTER unit_price_cents;

-- ---------------------------------------------------------------------------
-- Offline scanning (plan 8.2): offline check-ins carry the device clock and are flagged on conflict.
-- ---------------------------------------------------------------------------
ALTER TABLE checkin_log
  MODIFY COLUMN result ENUM('valid','already_used','cancelled','refunded','transferred','wrong_event','wrong_day','invalid','manual','override','undo','offline_conflict') NOT NULL,
  ADD COLUMN IF NOT EXISTS offline       TINYINT(1) NOT NULL DEFAULT 0 AFTER ip,
  ADD COLUMN IF NOT EXISTS scanned_at    DATETIME(3) NULL AFTER offline,      -- device time for offline scans
  ADD COLUMN IF NOT EXISTS device_id     VARCHAR(40) NULL AFTER scanned_at,
  ADD COLUMN IF NOT EXISTS client_ref    VARCHAR(64) NULL AFTER device_id,   -- idempotency key from the device queue
  ADD COLUMN IF NOT EXISTS resolved_at   DATETIME NULL AFTER client_ref,
  ADD COLUMN IF NOT EXISTS resolved_by   BIGINT UNSIGNED NULL AFTER resolved_at,
  ADD UNIQUE KEY IF NOT EXISTS uq_cl_client_ref (client_ref);

-- ---------------------------------------------------------------------------
-- Email retries (plan 13.1) and reminders (plan 5.3).
-- ---------------------------------------------------------------------------
ALTER TABLE email_outbox
  ADD COLUMN IF NOT EXISTS next_attempt_at DATETIME NULL AFTER attempts,
  ADD KEY IF NOT EXISTS idx_email_retry (status, next_attempt_at);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS reminder_sent_at DATETIME NULL AFTER cancel_reason,
  ADD COLUMN IF NOT EXISTS queue_enabled    TINYINT(1) NOT NULL DEFAULT 0 AFTER waitlist_enabled,
  ADD COLUMN IF NOT EXISTS queue_rate_per_min INT UNSIGNED NOT NULL DEFAULT 100 AFTER queue_enabled;

-- ---------------------------------------------------------------------------
-- Virtual waiting room (plan 6.2, Phase 2). Visitors get a numbered place; a fixed number is admitted per minute.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_entries (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,  -- position = order of arrival
  event_id     BIGINT UNSIGNED NOT NULL,
  token_hash   CHAR(64) NOT NULL,
  admitted_at  DATETIME NULL,
  expires_at   DATETIME NULL,                            -- admission is valid for a limited time
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_queue_token (token_hash),
  KEY idx_queue_event (event_id, admitted_at, id),
  CONSTRAINT fk_queue_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Event sponsors (plan 5.2 / 14.7).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_sponsors (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id       BIGINT UNSIGNED NOT NULL,
  name           VARCHAR(160) NOT NULL,
  logo_path      VARCHAR(255) NULL,
  url            VARCHAR(500) NULL,
  tier           VARCHAR(40)  NULL,           -- "Presenting", "Gold", ...
  visible_from   DATETIME NULL,
  visible_until  DATETIME NULL,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sponsor_event (event_id),
  CONSTRAINT fk_sponsor_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Modular ad system (plan 14). Ads are data; pages ask for a named placement.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name               VARCHAR(160) NOT NULL,
  kind               ENUM('platform','sponsored','contextual') NOT NULL DEFAULT 'platform',
  organization_id    BIGINT UNSIGNED NULL,        -- set for an organizer's sponsor campaign (limited to its events)
  event_id           BIGINT UNSIGNED NULL,        -- set to show only on one event
  advertiser_name    VARCHAR(160) NULL,
  advertiser_contact VARCHAR(255) NULL,
  status             ENUM('draft','active','paused') NOT NULL DEFAULT 'draft',  -- scheduled / expired derive from dates
  starts_at          DATETIME NULL,
  ends_at            DATETIME NULL,
  weight             INT UNSIGNED NOT NULL DEFAULT 1,
  priority           INT NOT NULL DEFAULT 0,      -- higher priority wins; weight rotates within a priority
  destination_url    VARCHAR(500) NOT NULL,
  targeting          TEXT NULL,                   -- JSON: { regions:[], cities:[], ageRestricted:bool, roles:[], eventIds:[] }
  created_by         BIGINT UNSIGNED NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ad_status (status, starts_at, ends_at),
  KEY idx_ad_org (organization_id),
  CONSTRAINT fk_ad_org   FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ad_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_ad_user  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ad_creatives (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id  BIGINT UNSIGNED NOT NULL,
  image_path   VARCHAR(255) NULL,
  alt_text     VARCHAR(200) NOT NULL,
  headline     VARCHAR(120) NULL,
  body         VARCHAR(300) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_creative_campaign (campaign_id),
  CONSTRAINT fk_creative_campaign FOREIGN KEY (campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ad_campaign_placements (
  campaign_id  BIGINT UNSIGNED NOT NULL,
  placement    VARCHAR(40) NOT NULL,
  PRIMARY KEY (campaign_id, placement),
  KEY idx_acp_placement (placement),
  CONSTRAINT fk_acp_campaign FOREIGN KEY (campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily roll-up keeps tracking cheap: one upsert per impression / click.
CREATE TABLE IF NOT EXISTS ad_stats (
  campaign_id  BIGINT UNSIGNED NOT NULL,
  creative_id  BIGINT UNSIGNED NOT NULL,
  placement    VARCHAR(40) NOT NULL,
  event_id     BIGINT UNSIGNED NOT NULL DEFAULT 0,   -- 0 = not on an event page
  day          DATE NOT NULL,
  impressions  INT UNSIGNED NOT NULL DEFAULT 0,
  clicks       INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, creative_id, placement, event_id, day),
  KEY idx_stats_day (day),
  CONSTRAINT fk_stats_campaign FOREIGN KEY (campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Organizer onboarding with verification (Phase 2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizer_applications (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED NULL,
  contact_name     VARCHAR(160) NOT NULL,
  contact_email    VARCHAR(255) NOT NULL,
  contact_phone    VARCHAR(40)  NULL,
  org_name         VARCHAR(160) NOT NULL,
  legal_name       VARCHAR(200) NOT NULL,
  business_type    ENUM('individual','company','nonprofit','venue') NOT NULL DEFAULT 'company',
  tax_id_last4     CHAR(4)      NULL,
  website          VARCHAR(255) NULL,
  address          VARCHAR(300) NULL,
  expected_events  VARCHAR(500) NULL,
  status           ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  review_notes     VARCHAR(1000) NULL,
  reviewed_by      BIGINT UNSIGNED NULL,
  reviewed_at      DATETIME NULL,
  organization_id  BIGINT UNSIGNED NULL,          -- set on approval
  ip               VARCHAR(45) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_app_status (status, created_at),
  CONSTRAINT fk_app_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_app_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_app_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS verified_at     DATETIME NULL AFTER status,
  ADD COLUMN IF NOT EXISTS meta_pixel_id   VARCHAR(30) NULL AFTER logo_path,
  ADD COLUMN IF NOT EXISTS ga4_id          VARCHAR(30) NULL AFTER meta_pixel_id;

-- Organizations created before onboarding existed were set up by platform staff: treat them as verified.
UPDATE organizations SET verified_at = created_at WHERE verified_at IS NULL;

-- ---------------------------------------------------------------------------
-- SMS ticket delivery and reminders (Phase 2). Logged only until a provider is configured.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_outbox (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  to_phone     VARCHAR(40)  NOT NULL,
  body         VARCHAR(640) NOT NULL,
  status       ENUM('queued','sent','failed','logged') NOT NULL DEFAULT 'queued',
  error        VARCHAR(500) NULL,
  provider_id  VARCHAR(64)  NULL,
  related_type VARCHAR(40)  NULL,
  related_id   VARCHAR(64)  NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_sms_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sms_opt_in TINYINT(1) NOT NULL DEFAULT 0 AFTER marketing_opt_in;

-- Job bookkeeping (daily reconciliation etc.).
INSERT IGNORE INTO platform_settings (`key`, `value`) VALUES ('last_daily_jobs', '');
