-- Fat Tixx — migration 0004: organizer payouts / settlement approval, dispute notes, editable email
-- templates, reconciliation runs. Stripe keys and branding live in platform_settings (secrets encrypted).

CREATE TABLE IF NOT EXISTS payouts (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  event_id         BIGINT UNSIGNED NULL,
  amount_cents     INT UNSIGNED    NOT NULL,
  currency         CHAR(3)         NOT NULL DEFAULT 'USD',
  status           ENUM('approved','paid','void') NOT NULL DEFAULT 'approved',
  method           VARCHAR(40)     NULL,          -- bank transfer, check, Stripe, other
  reference        VARCHAR(120)    NULL,          -- transfer id / check number
  notes            VARCHAR(500)    NULL,
  approved_by      BIGINT UNSIGNED NULL,
  approved_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_by          BIGINT UNSIGNED NULL,
  paid_at          DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payout_org (organization_id),
  KEY idx_payout_event (event_id),
  CONSTRAINT fk_payout_org   FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_payout_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT fk_payout_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_payout_payer FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE disputes
  ADD COLUMN notes VARCHAR(2000) NULL AFTER status,
  ADD COLUMN evidence_due_at DATETIME NULL AFTER notes,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER closed_at;

CREATE TABLE IF NOT EXISTS email_templates (
  `key`       VARCHAR(64)  NOT NULL,
  subject     VARCHAR(255) NOT NULL,
  body_html   MEDIUMTEXT   NOT NULL,
  updated_by  BIGINT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`),
  CONSTRAINT fk_tpl_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  mode          ENUM('test','live') NOT NULL,
  range_start   DATETIME NOT NULL,
  range_end     DATETIME NOT NULL,
  stripe_count  INT UNSIGNED NOT NULL DEFAULT 0,
  stripe_cents  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  db_count      INT UNSIGNED NOT NULL DEFAULT 0,
  db_cents      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  discrepancies JSON NULL,
  run_by        BIGINT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_recon_user FOREIGN KEY (run_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO platform_settings (`key`, `value`) VALUES
  ('stripe_mode', 'test'),
  ('brand_color', '#f59e0b'),
  ('brand_logo_path', '');
