-- Fattixx — migration 0017: Stripe Connect inside organizer verification, payouts released after each event.
-- Payouts to connected accounts are manual (held in the organizer's Stripe balance) and released per event once it
-- has ended (src/lib/payments/connect.ts, runConnectEventPayouts). One row per event that has been paid out.
CREATE TABLE IF NOT EXISTS connect_event_payouts (
  event_id         BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  organization_id  BIGINT UNSIGNED NOT NULL,
  account_id       VARCHAR(255) NOT NULL,
  amount_cents     INT UNSIGNED NOT NULL,
  currency         CHAR(3) NOT NULL DEFAULT 'USD',
  stripe_payout_id VARCHAR(255) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cep_org (organization_id),
  CONSTRAINT fk_cep_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_cep_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
