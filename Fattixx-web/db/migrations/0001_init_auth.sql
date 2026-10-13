-- Fat Tixx — migration 0001: identity, platform roles, MFA, sessions, audit.
-- Target: MariaDB 10.4+ / MySQL 8+. Applied automatically by `npm run db:setup`.

CREATE TABLE IF NOT EXISTS users (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id           CHAR(36)        NOT NULL,
  email               VARCHAR(255)    NOT NULL,
  email_normalized    VARCHAR(255)    NOT NULL,
  name                VARCHAR(120)    NOT NULL,
  password_hash       VARCHAR(255)    NULL,
  password_changed_at DATETIME        NULL,
  status              ENUM('active','suspended','disabled') NOT NULL DEFAULT 'active',
  failed_login_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  locked_until        DATETIME        NULL,
  last_login_at       DATETIME        NULL,
  last_login_ip       VARCHAR(45)     NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_public_id (public_id),
  UNIQUE KEY uq_users_email_normalized (email_normalized),
  KEY idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Platform-level roles (organization roles live in a later migration).
CREATE TABLE IF NOT EXISTS user_platform_roles (
  user_id     BIGINT UNSIGNED NOT NULL,
  role        ENUM('super_admin','support','finance') NOT NULL,
  granted_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role),
  KEY idx_upr_role (role),
  CONSTRAINT fk_upr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_upr_granted_by FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TOTP authenticator (secret stored AES-256-GCM encrypted, never in plaintext).
CREATE TABLE IF NOT EXISTS user_totp (
  user_id          BIGINT UNSIGNED NOT NULL,
  secret_encrypted VARBINARY(512)  NOT NULL,
  enabled_at       DATETIME        NULL,
  last_used_step   BIGINT          NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_totp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One-time recovery codes (stored as SHA-256 hashes).
CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  code_hash  CHAR(64)        NOT NULL,
  used_at    DATETIME        NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recovery_code_hash (code_hash),
  KEY idx_recovery_user (user_id),
  CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side sessions. `id` is the SHA-256 of the opaque cookie token.
CREATE TABLE IF NOT EXISTS sessions (
  id               CHAR(64)        NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at       DATETIME        NOT NULL,
  mfa_verified_at  DATETIME        NULL,
  ip               VARCHAR(45)     NULL,
  user_agent       VARCHAR(512)    NULL,
  revoked_at       DATETIME        NULL,
  revoked_reason   VARCHAR(64)     NULL,
  PRIMARY KEY (id),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Short-lived state between "password accepted" and "MFA passed" / "MFA enrolled".
CREATE TABLE IF NOT EXISTS login_challenges (
  id          CHAR(64)        NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  purpose     ENUM('mfa','enroll') NOT NULL,
  attempts    INT UNSIGNED    NOT NULL DEFAULT 0,
  ip          VARCHAR(45)     NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_challenges_user (user_id),
  KEY idx_challenges_expires (expires_at),
  CONSTRAINT fk_challenges_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every login attempt, for throttling and forensics.
CREATE TABLE IF NOT EXISTS login_attempts (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email_normalized  VARCHAR(255)    NULL,
  user_id           BIGINT UNSIGNED NULL,
  ip                VARCHAR(45)     NOT NULL,
  success           TINYINT(1)      NOT NULL,
  reason            VARCHAR(64)     NOT NULL,
  user_agent        VARCHAR(512)    NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_attempts_ip_time (ip, created_at),
  KEY idx_attempts_email_time (email_normalized, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Immutable audit trail of security-relevant and administrative actions.
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id  BIGINT UNSIGNED NULL,
  action         VARCHAR(64)     NOT NULL,
  target_type    VARCHAR(64)     NULL,
  target_id      VARCHAR(64)     NULL,
  ip             VARCHAR(45)     NULL,
  user_agent     VARCHAR(512)    NULL,
  metadata       JSON            NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_actor_time (actor_user_id, created_at),
  KEY idx_audit_action_time (action, created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
