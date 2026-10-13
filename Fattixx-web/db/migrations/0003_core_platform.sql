-- Fat Tixx — migration 0003: organizations, team roles, venues, events, ticket types,
-- inventory holds, orders, tickets, check-ins, refunds, platform settings, email outbox,
-- password-setup tokens.  All money is stored in integer cents. All DATETIMEs are UTC.

-- ---------------------------------------------------------------------------
-- Platform-wide settings (single row, key/value)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_settings (
  `key`       VARCHAR(64)  NOT NULL,
  `value`     TEXT         NOT NULL,
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO platform_settings (`key`, `value`) VALUES
  ('platform_fee_bps', '500'),          -- 5.00 % of ticket price
  ('platform_fee_fixed_cents', '99'),   -- + $0.99 per ticket
  ('processing_fee_bps', '290'),        -- estimated card processing 2.9 %
  ('processing_fee_fixed_cents', '30'), -- + $0.30 per order
  ('default_fee_mode', 'buyer_pays'),   -- buyer_pays | organizer_absorbs
  ('default_currency', 'USD'),
  ('hold_minutes', '10'),
  ('platform_name', 'Fat Tixx'),
  ('support_email', 'support@fattixx.com');

-- ---------------------------------------------------------------------------
-- Organizations & membership
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug          VARCHAR(64)  NOT NULL,
  name          VARCHAR(160) NOT NULL,
  legal_name    VARCHAR(200) NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(40)  NULL,
  website       VARCHAR(255) NULL,
  description   TEXT         NULL,
  logo_path     VARCHAR(255) NULL,
  status        ENUM('active','suspended') NOT NULL DEFAULT 'active',
  -- Fee overrides (NULL = platform default)
  fee_bps_override         INT UNSIGNED NULL,
  fee_fixed_cents_override INT UNSIGNED NULL,
  created_by    BIGINT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_org_slug (slug),
  KEY idx_org_status (status),
  CONSTRAINT fk_org_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  role            ENUM('org_admin','organizer','staff') NOT NULL,
  -- Fine-grained permissions granted by the Organization Admin (organizer / staff only)
  can_refund            TINYINT(1) NOT NULL DEFAULT 0,
  can_override_checkin  TINYINT(1) NOT NULL DEFAULT 0,
  can_undo_checkin      TINYINT(1) NOT NULL DEFAULT 0,
  all_events            TINYINT(1) NOT NULL DEFAULT 0,  -- organizer: access every org event (else assigned only)
  invited_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id),
  KEY idx_om_user (user_id),
  CONSTRAINT fk_om_org  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_om_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_om_inviter FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Venues
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS venues (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(160) NOT NULL,
  address_line1   VARCHAR(200) NULL,
  address_line2   VARCHAR(200) NULL,
  city            VARCHAR(120) NULL,
  region          VARCHAR(120) NULL,   -- state / province
  postal_code     VARCHAR(20)  NULL,
  country         CHAR(2)      NOT NULL DEFAULT 'US',
  timezone        VARCHAR(64)  NOT NULL DEFAULT 'America/New_York',
  capacity        INT UNSIGNED NULL,
  -- Admissions / sales tax applied to tickets sold at this venue (basis points; 500 = 5 %)
  tax_bps         INT UNSIGNED NOT NULL DEFAULT 0,
  tax_label       VARCHAR(80)  NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_venue_org (organization_id),
  CONSTRAINT fk_venue_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  venue_id         BIGINT UNSIGNED NULL,
  slug             VARCHAR(120) NOT NULL,
  title            VARCHAR(200) NOT NULL,
  summary          VARCHAR(300) NULL,
  description      TEXT         NULL,
  image_path       VARCHAR(255) NULL,
  starts_at        DATETIME     NOT NULL,      -- UTC
  ends_at          DATETIME     NULL,          -- UTC
  doors_at         DATETIME     NULL,          -- UTC
  timezone         VARCHAR(64)  NOT NULL,
  capacity         INT UNSIGNED NULL,          -- overall cap (NULL = sum of ticket types)
  status           ENUM('draft','published','cancelled','postponed','completed') NOT NULL DEFAULT 'draft',
  visibility       ENUM('public','private','unlisted') NOT NULL DEFAULT 'public',
  age_restriction  TINYINT UNSIGNED NULL,      -- e.g. 18, 21
  fee_mode         ENUM('buyer_pays','organizer_absorbs') NOT NULL DEFAULT 'buyer_pays',
  tax_bps          INT UNSIGNED NULL,          -- NULL = inherit venue tax
  tax_label        VARCHAR(80)  NULL,
  currency         CHAR(3)      NOT NULL DEFAULT 'USD',
  refund_policy    ENUM('no_refunds','until_event_start','days_before') NOT NULL DEFAULT 'no_refunds',
  refund_days_before INT UNSIGNED NULL,
  allow_transfers  TINYINT(1)   NOT NULL DEFAULT 0,
  checkout_question VARCHAR(200) NULL,         -- one optional custom question asked at checkout
  cancelled_at     DATETIME NULL,
  cancel_reason    VARCHAR(500) NULL,
  created_by       BIGINT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_slug (slug),
  KEY idx_event_org (organization_id),
  KEY idx_event_public (status, visibility, starts_at),
  CONSTRAINT fk_event_org   FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_venue FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL,
  CONSTRAINT fk_event_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which organizers / staff may work on which event (Organization Admins see everything).
CREATE TABLE IF NOT EXISTS event_members (
  event_id    BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  assigned_by BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id),
  KEY idx_em_user (user_id),
  CONSTRAINT fk_em_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_em_user  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Ticket types
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_types (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id        BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(120) NOT NULL,
  description     VARCHAR(500) NULL,
  kind            ENUM('general','vip','table','complimentary') NOT NULL DEFAULT 'general',
  price_cents     INT UNSIGNED NOT NULL DEFAULT 0,
  quantity        INT UNSIGNED NOT NULL,           -- total inventory
  sold            INT UNSIGNED NOT NULL DEFAULT 0, -- paid / issued (maintained transactionally)
  min_per_order   INT UNSIGNED NOT NULL DEFAULT 1,
  max_per_order   INT UNSIGNED NOT NULL DEFAULT 10,
  seats_per_unit  INT UNSIGNED NOT NULL DEFAULT 1, -- table tickets: seats per table (one QR per seat)
  sales_start_at  DATETIME NULL,
  sales_end_at    DATETIME NULL,
  hidden          TINYINT(1) NOT NULL DEFAULT 0,   -- not shown publicly (complimentary / door)
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tt_event (event_id),
  CONSTRAINT fk_tt_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Orders (an order holds inventory while pending; holds expire automatically)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code              CHAR(10)        NOT NULL,          -- public order number, e.g. FTX-7K2M9Q
  access_token_hash CHAR(64)        NOT NULL,          -- lets the buyer open the order without an account
  organization_id   BIGINT UNSIGNED NOT NULL,
  event_id          BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NULL,              -- NULL for guest checkout
  buyer_email       VARCHAR(255)    NOT NULL,
  buyer_name        VARCHAR(160)    NULL,
  buyer_phone       VARCHAR(40)     NULL,
  checkout_answer   VARCHAR(500)    NULL,
  marketing_opt_in  TINYINT(1)      NOT NULL DEFAULT 0,
  status            ENUM('pending','paid','expired','cancelled','refunded','partially_refunded') NOT NULL DEFAULT 'pending',
  source            ENUM('online','box_office','complimentary') NOT NULL DEFAULT 'online',
  currency          CHAR(3)         NOT NULL DEFAULT 'USD',
  -- Snapshot at purchase time (cents); later config changes never alter an order
  subtotal_cents         INT UNSIGNED NOT NULL DEFAULT 0,  -- ticket prices
  platform_fee_cents     INT UNSIGNED NOT NULL DEFAULT 0,  -- charged to buyer (0 if absorbed)
  processing_fee_cents   INT UNSIGNED NOT NULL DEFAULT 0,  -- charged to buyer (0 if absorbed)
  tax_cents              INT UNSIGNED NOT NULL DEFAULT 0,
  total_cents            INT UNSIGNED NOT NULL DEFAULT 0,  -- what the buyer pays
  absorbed_fee_cents     INT UNSIGNED NOT NULL DEFAULT 0,  -- fees the organizer absorbed
  refunded_cents         INT UNSIGNED NOT NULL DEFAULT 0,
  fee_mode          ENUM('buyer_pays','organizer_absorbs') NOT NULL,
  hold_expires_at   DATETIME NULL,
  paid_at           DATETIME NULL,
  stripe_payment_intent_id VARCHAR(255) NULL,
  stripe_charge_id         VARCHAR(255) NULL,
  ip                VARCHAR(45) NULL,
  created_by        BIGINT UNSIGNED NULL,              -- staff member for box office / comps
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_code (code),
  UNIQUE KEY uq_order_pi (stripe_payment_intent_id),
  KEY idx_order_event_status (event_id, status),
  KEY idx_order_email (buyer_email),
  KEY idx_order_user (user_id),
  KEY idx_order_hold (status, hold_expires_at),
  CONSTRAINT fk_order_org   FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_user  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id         BIGINT UNSIGNED NOT NULL,
  ticket_type_id   BIGINT UNSIGNED NOT NULL,
  ticket_type_name VARCHAR(120)    NOT NULL,   -- snapshot
  quantity         INT UNSIGNED    NOT NULL,
  unit_price_cents INT UNSIGNED    NOT NULL,
  unit_platform_fee_cents INT UNSIGNED NOT NULL DEFAULT 0,
  unit_tax_cents   INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_oi_order (order_id),
  KEY idx_oi_tt (ticket_type_id),
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_tt    FOREIGN KEY (ticket_type_id) REFERENCES ticket_types(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Tickets (one row per admission / seat; QR payload is signed with TICKET_SIGNING_KEY)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            CHAR(12)        NOT NULL,        -- human-readable ticket number
  secret          CHAR(32)        NOT NULL,        -- random, part of the signed QR payload
  order_id        BIGINT UNSIGNED NOT NULL,
  order_item_id   BIGINT UNSIGNED NOT NULL,
  event_id        BIGINT UNSIGNED NOT NULL,
  ticket_type_id  BIGINT UNSIGNED NOT NULL,
  attendee_name   VARCHAR(160)    NULL,
  attendee_email  VARCHAR(255)    NULL,
  seat_label      VARCHAR(40)     NULL,            -- "Table 3 · Seat 2"
  status          ENUM('valid','used','cancelled','refunded','transferred') NOT NULL DEFAULT 'valid',
  checked_in_at   DATETIME NULL,
  checked_in_by   BIGINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_code (code),
  KEY idx_ticket_order (order_id),
  KEY idx_ticket_event_status (event_id, status),
  CONSTRAINT fk_ticket_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_item  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_tt    FOREIGN KEY (ticket_type_id) REFERENCES ticket_types(id),
  CONSTRAINT fk_ticket_checker FOREIGN KEY (checked_in_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every scan / manual action, kept as dispute evidence.
CREATE TABLE IF NOT EXISTS checkin_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id    BIGINT UNSIGNED NOT NULL,
  ticket_id   BIGINT UNSIGNED NULL,
  staff_user_id BIGINT UNSIGNED NULL,
  result      ENUM('valid','already_used','cancelled','refunded','transferred','wrong_event','invalid','manual','override','undo') NOT NULL,
  reason      VARCHAR(300) NULL,
  device      VARCHAR(255) NULL,
  ip          VARCHAR(45)  NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_cl_event_time (event_id, created_at),
  KEY idx_cl_ticket (ticket_id),
  CONSTRAINT fk_cl_event  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_cl_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
  CONSTRAINT fk_cl_staff  FOREIGN KEY (staff_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Refunds & disputes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refunds (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id          BIGINT UNSIGNED NOT NULL,
  amount_cents      INT UNSIGNED    NOT NULL,
  reason            VARCHAR(300)    NOT NULL,
  initiated_by      BIGINT UNSIGNED NULL,
  kind              ENUM('full','partial','bulk_cancellation') NOT NULL,
  stripe_refund_id  VARCHAR(255) NULL,
  status            ENUM('pending','succeeded','failed') NOT NULL DEFAULT 'pending',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_refund_order (order_id),
  CONSTRAINT fk_refund_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_refund_user  FOREIGN KEY (initiated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS disputes (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id           BIGINT UNSIGNED NOT NULL,
  stripe_dispute_id  VARCHAR(255) NOT NULL,
  amount_cents       INT UNSIGNED NOT NULL,
  fee_cents          INT UNSIGNED NOT NULL DEFAULT 0,
  reason             VARCHAR(120) NULL,
  status             VARCHAR(60)  NOT NULL,
  opened_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at          DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dispute_stripe (stripe_dispute_id),
  KEY idx_dispute_order (order_id),
  CONSTRAINT fk_dispute_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stripe webhook idempotency
CREATE TABLE IF NOT EXISTS stripe_events (
  id          VARCHAR(255) NOT NULL,
  type        VARCHAR(120) NOT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Email outbox (every message is recorded; delivered by SMTP when configured)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_outbox (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  to_email     VARCHAR(255) NOT NULL,
  to_name      VARCHAR(160) NULL,
  subject      VARCHAR(255) NOT NULL,
  text_body    MEDIUMTEXT   NOT NULL,
  html_body    MEDIUMTEXT   NULL,
  category     ENUM('transactional','marketing') NOT NULL DEFAULT 'transactional',
  status       ENUM('queued','sent','failed','logged') NOT NULL DEFAULT 'queued',
  error        VARCHAR(500) NULL,
  attempts     INT UNSIGNED NOT NULL DEFAULT 0,
  related_type VARCHAR(40)  NULL,
  related_id   VARCHAR(64)  NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_email_status (status, created_at),
  KEY idx_email_to (to_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- One-time tokens: password setup / reset, "find my tickets" magic links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS one_time_tokens (
  id          CHAR(64)  NOT NULL,       -- sha256(token)
  purpose     ENUM('set_password','reset_password','find_tickets','verify_email') NOT NULL,
  user_id     BIGINT UNSIGNED NULL,
  email       VARCHAR(255) NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ott_email (email, purpose),
  CONSTRAINT fk_ott_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- users: email verification + marketing consent (attendee accounts)
ALTER TABLE users
  ADD COLUMN email_verified_at DATETIME NULL AFTER email_normalized,
  ADD COLUMN phone VARCHAR(40) NULL AFTER name,
  ADD COLUMN marketing_opt_in TINYINT(1) NOT NULL DEFAULT 0 AFTER phone;
