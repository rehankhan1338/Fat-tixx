import 'server-only';
import { randomUUID } from 'node:crypto';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { clientIp, userAgent } from '../request';
import { hashPassword, needsRehash, passwordPolicyErrors, pwnedPasswordCount, verifyAgainstDummy, verifyPassword } from '../security/password';
import { clearAccountFailures, ipIsThrottled, recordAttempt, registerAccountFailure } from '../security/rate-limit';
import { rateLimited } from '../security/bot';
import { createOneTimeToken } from '../tokens';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { env } from '../env';
import { findUserByEmail, isEmail, normalizeEmail, sendSetPasswordLink } from '../users';

/**
 * Credential checks shared by the website (Server Actions in ./actions.ts) and the mobile API.
 * Nothing here creates a session or redirects; callers decide how the signed-in user is remembered
 * (HttpOnly cookie on the web, Bearer token in the app).
 */

/** One generic message for every credential failure: never reveal which part was wrong. */
export const GENERIC_LOGIN_ERROR = 'Incorrect email or password.';
export const THROTTLED_ERROR = 'Too many attempts from this network. Try again later.';

type UserRow = Row & {
  id: number; email: string; name: string; password_hash: string | null; status: string;
  failed_login_count: number; locked_until: Date | null;
};

export type AuthResult =
  | { ok: true; user: { id: number; email: string; name: string } }
  | { ok: false; error: string; status: 400 | 429 };

/**
 * Verify an email + password pair with the full protection set: per-IP throttling, per-account lockout,
 * constant-time behaviour for unknown accounts, login attempt log and audit trail.
 */
export async function authenticateWithPassword(emailRaw: string, password: string): Promise<AuthResult> {
  const email = emailRaw.trim();
  if (!email || !password || email.length > 254 || password.length > 128) return { ok: false, error: GENERIC_LOGIN_ERROR, status: 400 };

  const emailNorm = normalizeEmail(email);
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);

  if (await ipIsThrottled(ip)) {
    await recordAttempt({ emailNormalized: emailNorm, userId: null, ip, success: false, reason: 'ip_throttled', userAgent: ua });
    await audit('auth.login.throttled_ip', { metadata: { email: emailNorm } });
    return { ok: false, error: THROTTLED_ERROR, status: 429 };
  }

  const user = await queryOne<UserRow>(
    `SELECT id, email, name, password_hash, status, failed_login_count, locked_until FROM users WHERE email_normalized = ?`,
    [emailNorm],
  );

  // Unknown account (or one that never set a password): burn the same Argon2 cost, then fail.
  if (!user || !user.password_hash) {
    await verifyAgainstDummy(password);
    await recordAttempt({ emailNormalized: emailNorm, userId: user?.id ?? null, ip, success: false, reason: user ? 'no_password' : 'unknown_account', userAgent: ua });
    return { ok: false, error: GENERIC_LOGIN_ERROR, status: 400 };
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    await verifyAgainstDummy(password);
    await recordAttempt({ emailNormalized: emailNorm, userId: user.id, ip, success: false, reason: 'locked', userAgent: ua });
    await audit('auth.login.locked', { actorUserId: user.id });
    return { ok: false, error: GENERIC_LOGIN_ERROR, status: 400 };
  }

  if (user.status !== 'active') {
    await verifyAgainstDummy(password);
    await recordAttempt({ emailNormalized: emailNorm, userId: user.id, ip, success: false, reason: 'inactive', userAgent: ua });
    return { ok: false, error: GENERIC_LOGIN_ERROR, status: 400 };
  }

  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) {
    const { lockedMinutes } = await registerAccountFailure(user.id);
    await recordAttempt({ emailNormalized: emailNorm, userId: user.id, ip, success: false, reason: 'bad_password', userAgent: ua });
    await audit('auth.login.failed', { actorUserId: user.id, metadata: lockedMinutes ? { lockedMinutes } : undefined });
    return { ok: false, error: GENERIC_LOGIN_ERROR, status: 400 };
  }

  if (needsRehash(user.password_hash)) {
    await execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [await hashPassword(password), user.id]);
    await audit('auth.password.rehashed', { actorUserId: user.id });
  }

  await clearAccountFailures(user.id);
  await execute(`UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?`, [ip, user.id]);
  await recordAttempt({ emailNormalized: emailNorm, userId: user.id, ip, success: true, reason: 'password_ok', userAgent: ua });
  await audit('auth.login.success', { actorUserId: user.id });
  return { ok: true, user: { id: Number(user.id), email: user.email, name: user.name } };
}

export type RegisterResult =
  | { kind: 'created'; userId: number; email: string; name: string }
  /** The address already has an account: a reset link was sent instead, and the caller must not reveal that. */
  | { kind: 'existing'; message: string }
  | { kind: 'error'; error: string; field?: string; status: 400 | 429 };

/**
 * Attendee self-registration. Validates the password policy and breach status, never discloses whether
 * an address is already registered, and leaves the new account unverified until the email link is used.
 */
export async function registerAttendeeAccount(input: { email: string; name: string; password: string }): Promise<RegisterResult> {
  const email = input.email.trim();
  const name = input.name.trim();
  const { password } = input;
  const ip = await clientIp();
  if (await ipIsThrottled(ip) || rateLimited(`register:${ip}`, 10, 60 * 60_000)) return { kind: 'error', error: THROTTLED_ERROR, status: 429 };
  if (!isEmail(email)) return { kind: 'error', error: 'Enter a valid email address.', field: 'email', status: 400 };
  if (name.length < 2 || name.length > 120) return { kind: 'error', error: 'Enter your name.', field: 'name', status: 400 };
  const errs = passwordPolicyErrors(password, email);
  if (errs.length) return { kind: 'error', error: errs.join(' '), field: 'password', status: 400 };
  const pwned = await pwnedPasswordCount(password);
  if (pwned && pwned > 0) return { kind: 'error', error: `That password has appeared in ${pwned.toLocaleString()} data breaches. Choose a different one.`, field: 'password', status: 400 };

  const existing = await findUserByEmail(email);
  if (existing?.password_hash) {
    // Do not reveal that the account exists: behave as if registration succeeded and send a reset link.
    await sendSetPasswordLink(existing, { invitedBy: null, context: 'Fat Tixx', purpose: 'reset_password' });
    return { kind: 'existing', message: 'Check your email to finish setting up your account.' };
  }
  const hash = await hashPassword(password);
  let userId: number;
  if (existing) {
    await execute(`UPDATE users SET name = ?, password_hash = ?, password_changed_at = NOW() WHERE id = ?`, [name, hash, existing.id]);
    userId = Number(existing.id);
  } else {
    const r = await execute(
      `INSERT INTO users (public_id, email, email_normalized, name, password_hash, password_changed_at) VALUES (?, ?, ?, ?, ?, NOW())`,
      [randomUUID(), email, normalizeEmail(email), name, hash],
    );
    userId = r.insertId;
  }
  // Guest orders with this email are claimed only after the address is verified (verifyEmail);
  // otherwise anyone could register someone else's email and see their tickets.
  await audit('auth.register', { actorUserId: userId });
  await sendVerificationEmail({ id: userId, email, name });
  return { kind: 'created', userId, email, name };
}

export async function sendVerificationEmail(user: { id: number; email: string; name: string }): Promise<void> {
  const token = await createOneTimeToken('verify_email', user.email, user.id, null);
  const mail = await renderEmail('verify_email', { name: user.name, url: `${env.APP_URL}/verify-email/${token}` });
  await sendEmail({ to: user.email, toName: user.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'user', id: user.id } });
}
