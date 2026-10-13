-- Fat Tixx — migration 0002: remove two-factor authentication (not part of the product requirements).
-- Drops the authenticator, recovery-code and login-challenge tables and the per-session MFA marker.

DROP TABLE IF EXISTS user_recovery_codes;
DROP TABLE IF EXISTS user_totp;
DROP TABLE IF EXISTS login_challenges;

ALTER TABLE sessions DROP COLUMN mfa_verified_at;
