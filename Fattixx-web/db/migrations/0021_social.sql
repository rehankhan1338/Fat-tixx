-- Fattixx — migration 0021: Social & Community (plan section 11).
-- Attendee profiles and privacy settings, following organizers and other attendees, Who's Going, the event activity
-- feed, share tracking, referral rewards, blocking and reports. Social features live on the website only.
-- Plain ADD COLUMN / ADD KEY: MySQL (production) has no IF NOT EXISTS for these, which is MariaDB-only.

-- 11.3 / 11.11: the attendee's public profile and privacy settings. A profile exists once a username is chosen.
ALTER TABLE users
  ADD COLUMN username             VARCHAR(30)  NULL,
  ADD COLUMN avatar_path          VARCHAR(255) NULL,
  ADD COLUMN bio                  VARCHAR(160) NULL,
  ADD COLUMN city                 VARCHAR(120) NULL,
  ADD COLUMN instagram            VARCHAR(60)  NULL,
  ADD COLUMN tiktok               VARCHAR(60)  NULL,
  ADD COLUMN x_handle             VARCHAR(60)  NULL,
  ADD COLUMN profile_public       TINYINT(1)   NOT NULL DEFAULT 1,
  ADD COLUMN show_on_guest_lists  TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN show_events_on_profile TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN follow_approval      TINYINT(1)   NOT NULL DEFAULT 0,   -- 1 = only people I approve can follow me
  ADD COLUMN social_sms_opt_in    TINYINT(1)   NOT NULL DEFAULT 0,   -- texts from organizers I follow
  ADD COLUMN favorite_categories  VARCHAR(255) NULL,                 -- comma-separated category names
  ADD COLUMN age_confirmed_at     DATETIME     NULL,                 -- confirmed 18 or older
  ADD UNIQUE KEY uq_users_username (username);

-- 11.5: organizer social links and the follower-count switch.
ALTER TABLE organizations
  ADD COLUMN social_links         TEXT         NULL,                 -- JSON {"instagram": "https://…", …}
  ADD COLUMN hide_follower_count  TINYINT(1)   NOT NULL DEFAULT 0;

-- 11.4 / 11.7 per-event switches.
ALTER TABLE events
  ADD COLUMN guest_list_mode      ENUM('off','faces','faces_total') NOT NULL DEFAULT 'faces',
  ADD COLUMN feed_enabled         TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN feed_attendee_photos TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN feed_open_days       SMALLINT UNSIGNED NOT NULL DEFAULT 7,  -- days after the event before it turns read-only
  ADD COLUMN followers_notified_at DATETIME    NULL;                     -- the one "new event" notice to followers

-- 11.8 / 11.9 attribution: who shared the link the buyer came through.
ALTER TABLE orders
  ADD COLUMN shared_by_user_id    BIGINT UNSIGNED NULL,
  ADD KEY idx_orders_shared_by (shared_by_user_id);

-- 11.5 following organizers. muted = still following, but no notices.
CREATE TABLE IF NOT EXISTS org_follows (
  user_id          BIGINT UNSIGNED NOT NULL,
  organization_id  BIGINT UNSIGNED NOT NULL,
  muted            TINYINT(1) NOT NULL DEFAULT 0,
  source           VARCHAR(20) NULL,                 -- page, event, checkout, order
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, organization_id),
  KEY idx_of_org (organization_id, created_at),
  CONSTRAINT fk_of_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_of_org  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11.6 following other attendees. Two active rows in both directions = friends. pending = waiting for approval.
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id      BIGINT UNSIGNED NOT NULL,
  followee_id      BIGINT UNSIGNED NOT NULL,
  status           ENUM('active','pending') NOT NULL DEFAULT 'active',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, followee_id),
  KEY idx_uf_followee (followee_id, status),
  CONSTRAINT fk_uf_follower FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uf_followee FOREIGN KEY (followee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11.11 blocking: the blocked person can't see the blocker's profile or posts, or follow them.
CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id       BIGINT UNSIGNED NOT NULL,
  blocked_id       BIGINT UNSIGNED NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  KEY idx_ub_blocked (blocked_id),
  CONSTRAINT fk_ub_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ub_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11.4 the attendee's choice for one event ("Show me on the guest list" on the confirmation screen). Without a row the
-- account's show_on_guest_lists setting applies.
CREATE TABLE IF NOT EXISTS event_guest_prefs (
  event_id         BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  visible          TINYINT(1) NOT NULL,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id),
  KEY idx_egp_user (user_id),
  CONSTRAINT fk_egp_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_egp_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11.7 event activity feed: posts and threaded replies (parent_id), organizer alerts (pinned) and event updates.
CREATE TABLE IF NOT EXISTS event_posts (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id         BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NULL,             -- NULL for automatic event updates
  parent_id        BIGINT UNSIGNED NULL,
  kind             ENUM('post','alert','update') NOT NULL DEFAULT 'post',
  as_organizer     TINYINT(1) NOT NULL DEFAULT 0,    -- posted by the organizer's team, shown with the organizer's name
  body             TEXT NOT NULL,
  image_path       VARCHAR(255) NULL,
  pinned           TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at       DATETIME NULL,
  deleted_by       BIGINT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ep_event (event_id, parent_id, created_at),
  KEY idx_ep_user (user_id),
  KEY idx_ep_parent (parent_id),
  CONSTRAINT fk_ep_event  FOREIGN KEY (event_id)  REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_ep_user   FOREIGN KEY (user_id)   REFERENCES users(id)  ON DELETE CASCADE,
  CONSTRAINT fk_ep_parent FOREIGN KEY (parent_id) REFERENCES event_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_post_reactions (
  post_id          BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  emoji            VARCHAR(16) NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id, emoji),
  CONSTRAINT fk_epr_post FOREIGN KEY (post_id) REFERENCES event_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_epr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per person per feed: the attendee muted the feed's notifications; the organizer muted them (read-only) or removed them.
CREATE TABLE IF NOT EXISTS event_feed_members (
  event_id         BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  notifications_muted TINYINT(1) NOT NULL DEFAULT 0,
  state            ENUM('ok','muted','removed') NOT NULL DEFAULT 'ok',
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id),
  CONSTRAINT fk_efm_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_efm_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11.11 reports on posts and profiles. Post reports reach the event's organizer and Fattixx support; profile reports support.
CREATE TABLE IF NOT EXISTS content_reports (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporter_id      BIGINT UNSIGNED NULL,
  target_type      ENUM('post','profile') NOT NULL,
  target_id        BIGINT UNSIGNED NOT NULL,          -- event_posts.id or users.id
  event_id         BIGINT UNSIGNED NULL,
  organization_id  BIGINT UNSIGNED NULL,
  reason           VARCHAR(500) NOT NULL,
  status           ENUM('open','resolved','dismissed') NOT NULL DEFAULT 'open',
  resolved_by      BIGINT UNSIGNED NULL,
  resolved_at      DATETIME NULL,
  resolution       VARCHAR(200) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cr_status (status, created_at),
  KEY idx_cr_org (organization_id, status),
  CONSTRAINT fk_cr_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_cr_event    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_cr_org      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11.8 "Share that you're going": one row per share, for the organizer's reports.
CREATE TABLE IF NOT EXISTS event_shares (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id         BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NULL,
  channel          VARCHAR(20) NOT NULL,             -- story, native, copy, x, facebook, whatsapp
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_esh_event (event_id, created_at),
  CONSTRAINT fk_esh_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_esh_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11.9 referral rewards. An offer is set per paid event: public (any ticket buyer can join) or invite-only.
-- reward_value: cents for 'fixed', basis points for 'percent'.
CREATE TABLE IF NOT EXISTS referral_offers (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id         BIGINT UNSIGNED NOT NULL,
  organization_id  BIGINT UNSIGNED NOT NULL,
  kind             ENUM('public','invite') NOT NULL,
  reward_type      ENUM('fixed','percent') NOT NULL,
  reward_basis     ENUM('ticket','order') NOT NULL DEFAULT 'ticket',
  reward_value     INT UNSIGNED NOT NULL,
  active           TINYINT(1) NOT NULL DEFAULT 1,
  created_by       BIGINT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ro_event_kind (event_id, kind),
  CONSTRAINT fk_ro_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_ro_org   FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ro_user  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A referrer in one offer. Their personal link is a tracking link (plan 5.2), so clicks and attribution reuse /r/<code>.
CREATE TABLE IF NOT EXISTS referrers (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  offer_id         BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NULL,             -- NULL until an invited person accepts
  tracking_link_id BIGINT UNSIGNED NULL,
  invite_email     VARCHAR(255) NULL,
  invite_phone     VARCHAR(40)  NULL,
  invite_token_hash CHAR(64)    NULL,
  status           ENUM('invited','active','removed') NOT NULL DEFAULT 'active',
  terms_accepted_at DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ref_offer_user (offer_id, user_id),
  UNIQUE KEY uq_ref_link (tracking_link_id),
  KEY idx_ref_user (user_id),
  KEY idx_ref_token (invite_token_hash),
  CONSTRAINT fk_ref_offer FOREIGN KEY (offer_id) REFERENCES referral_offers(id) ON DELETE CASCADE,
  CONSTRAINT fk_ref_user  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ref_link  FOREIGN KEY (tracking_link_id) REFERENCES tracking_links(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One reward per referred order. Out of the organizer's proceeds; the buyer pays the same price.
--   pending  → sale counted, event not over yet (amount follows refunds)
--   reversed → refunded or disputed
--   payable  → event over: owed to the referrer (paid once their payout details are set up)
--   paid     → paid to the referrer
-- platform_cents is Fattixx's share of the reward (setting referral_platform_share_bps); the referrer gets amount − platform.
CREATE TABLE IF NOT EXISTS referral_rewards (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  referrer_id      BIGINT UNSIGNED NOT NULL,
  order_id         BIGINT UNSIGNED NOT NULL,
  event_id         BIGINT UNSIGNED NOT NULL,
  organization_id  BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  currency         CHAR(3) NOT NULL DEFAULT 'USD',
  original_cents   INT UNSIGNED NOT NULL,
  amount_cents     INT UNSIGNED NOT NULL,
  platform_cents   INT UNSIGNED NOT NULL DEFAULT 0,
  status           ENUM('pending','reversed','payable','paid') NOT NULL DEFAULT 'pending',
  flagged          TINYINT(1) NOT NULL DEFAULT 0,    -- unusual pattern: held until Fattixx support clears it
  flag_reason      VARCHAR(200) NULL,
  clawed_back      TINYINT(1) NOT NULL DEFAULT 0,    -- Stripe Connect: taken back from the organizer's transfer
  payable_at       DATETIME NULL,
  paid_at          DATETIME NULL,
  payout_reference VARCHAR(120) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rr_order (order_id),
  KEY idx_rr_referrer (referrer_id),
  KEY idx_rr_user_status (user_id, status),
  KEY idx_rr_event (event_id, status),
  CONSTRAINT fk_rr_referrer FOREIGN KEY (referrer_id) REFERENCES referrers(id) ON DELETE CASCADE,
  CONSTRAINT fk_rr_order    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_rr_event    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_rr_user     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Referrer payout details (11.9), like organizers: a Stripe Express account with Stripe Connect, otherwise the details
-- Finance pays to by hand (encrypted).
CREATE TABLE IF NOT EXISTS referrer_payout_accounts (
  user_id          BIGINT UNSIGNED NOT NULL,
  stripe_mode      ENUM('test','live') NULL,
  account_id       VARCHAR(255) NULL,
  transfers_active TINYINT(1) NOT NULL DEFAULT 0,
  manual_details   TEXT NULL,                        -- encrypted "PayPal: name@example.com" etc.
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_rpa_account (account_id),
  CONSTRAINT fk_rpa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11.10 organizer messages to followers and past attendees.
CREATE TABLE IF NOT EXISTS audience_messages (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id  BIGINT UNSIGNED NOT NULL,
  audience         VARCHAR(20) NOT NULL,             -- followers, attendees, both
  filters          VARCHAR(500) NULL,                -- JSON of the filters used
  subject          VARCHAR(200) NOT NULL,
  body             TEXT NOT NULL,
  with_sms         TINYINT(1) NOT NULL DEFAULT 0,
  email_count      INT UNSIGNED NOT NULL DEFAULT 0,
  sms_count        INT UNSIGNED NOT NULL DEFAULT 0,
  sent_by          BIGINT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_am_org (organization_id, created_at),
  CONSTRAINT fk_am_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO platform_settings (`key`, `value`) VALUES ('referral_platform_share_bps', '0');
