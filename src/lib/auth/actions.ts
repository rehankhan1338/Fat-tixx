'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { homeFor } from '../authz';
import { clientIp, userAgent } from '../request';
import { hashPassword, needsRehash, passwordPolicyErrors, pwnedPasswordCount, verifyAgainstDummy, verifyPassword } from '../security/password';
import { clearAccountFailures, ipIsThrottled, recordAttempt, registerAccountFailure } from '../security/rate-limit';
import { consumeOneTimeToken, createOneTimeToken, peekOneTimeToken } from '../tokens';
import { BOT_MESSAGE, botCheck, rateLimited } from '../security/bot';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { env } from '../env';
import { findUserByEmail, isEmail, normalizeEmail, sendSetPasswordLink } from '../users';
import { authIsFresh, clearSessionCookie, createSession, getSession, revokeAllUserSessions, revokeSession } from './session';

/**
 * Server Actions for authentication. Every export here is a public POST endpoint, so each
 * one validates its own input and authorization and returns only what the UI needs.
 */

export type ActionState = { error?: string; ok?: boolean; message?: string; field?: string } | undefined;

/** One generic message for every credential failure: never reveal which part was wrong. */
const GENERIC_LOGIN_ERROR = 'Incorrect email or password.';

/** Only allow same-site relative redirects after login. */
function safeNext(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw : '';
  return /^\/(?!\/)[\w\-./?=&%]*$/.test(s) ? s : null;
}

type UserRow = Row & {
  id: number; email: string; name: string; password_hash: string | null; status: string;
  failed_login_count: number; locked_until: Date | null;
};

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
export async function loginWithPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = safeNext(formData.get('next'));
  if (!email || !password || email.length > 254 || password.length > 128) return { error: GENERIC_LOGIN_ERROR };

  const emailNorm = normalizeEmail(email);
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);

  if (await ipIsThrottled(ip)) {
    await recordAttempt({ emailNormalized: emailNorm, userId: null, ip, success: false, reason: 'ip_throttled', userAgent: ua });
    await audit('auth.login.throttled_ip', { metadata: { email: emailNorm } });
    return { error: 'Too many attempts from this network. Try again later.' };
  }

  const user = await queryOne<UserRow>(
    `SELECT id, email, name, password_hash, status, failed_login_count, locked_until FROM users WHERE email_normalized = ?`,
    [emailNorm],
  );

  // Unknown account (or one that never set a password): burn the same Argon2 cost, then fail.
  if (!user || !user.password_hash) {
    await verifyAgainstDummy(password);
    await recordAttempt({ emailNormalized: emailNorm, userId: user?.id ?? null, ip, success: false, reason: user ? 'no_password' : 'unknown_account', userAgent: ua });
    return { error: GENERIC_LOGIN_ERROR };
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    await verifyAgainstDummy(password);
    await recordAttempt({ emailNormalized: emailNorm, userId: user.id, ip, success: false, reason: 'locked', userAgent: ua });
    await audit('auth.login.locked', { actorUserId: user.id });
    return { error: GENERIC_LOGIN_ERROR };
  }

  if (user.status !== 'active') {
    await verifyAgainstDummy(password);
    await recordAttempt({ emailNormalized: emailNorm, userId: user.id, ip, success: false, reason: 'inactive', userAgent: ua });
    return { error: GENERIC_LOGIN_ERROR };
  }

  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) {
    const { lockedMinutes } = await registerAccountFailure(user.id);
    await recordAttempt({ emailNormalized: emailNorm, userId: user.id, ip, success: false, reason: 'bad_password', userAgent: ua });
    await audit('auth.login.failed', { actorUserId: user.id, metadata: lockedMinutes ? { lockedMinutes } : undefined });
    return { error: GENERIC_LOGIN_ERROR };
  }

  if (needsRehash(user.password_hash)) {
    await execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [await hashPassword(password), user.id]);
    await audit('auth.password.rehashed', { actorUserId: user.id });
  }

  await clearAccountFailures(user.id);
  await execute(`UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?`, [ip, user.id]);
  await recordAttempt({ emailNormalized: emailNorm, userId: user.id, ip, success: true, reason: 'password_ok', userAgent: ua });
  await audit('auth.login.success', { actorUserId: user.id });

  await createSession(user.id);
  await audit('auth.session.created', { actorUserId: user.id });

  const session = await getSession();
  redirect(next ?? (session ? await homeFor(session) : '/'));
}

// ---------------------------------------------------------------------------
// Password setup / reset through one-time links
// ---------------------------------------------------------------------------
export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const ip = await clientIp();
  if (await ipIsThrottled(ip)) return { error: 'Too many attempts from this network. Try again later.' };
  // Always the same answer, whether or not the account exists.
  const done: ActionState = { ok: true, message: 'If an account exists for that email, a password link has been sent.' };
  if (!isEmail(email)) return done;
  const user = await findUserByEmail(email);
  if (!user || user.status !== 'active') return done;
  await sendSetPasswordLink(user, { invitedBy: null, context: 'Fat Tixx', purpose: 'reset_password' });
  await audit('auth.password.reset_requested', { actorUserId: user.id });
  return done;
}

export async function setPasswordWithToken(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const rec = (await peekOneTimeToken(token, 'set_password')) ?? (await peekOneTimeToken(token, 'reset_password'));
  if (!rec || !rec.userId) return { error: 'This link is invalid or has expired. Ask for a new one.' };

  const user = await queryOne<Row & { id: number; email: string; status: string }>(`SELECT id, email, status FROM users WHERE id = ?`, [rec.userId]);
  if (!user || user.status !== 'active') return { error: 'This account is not active.' };

  const errs = passwordPolicyErrors(password, user.email);
  if (errs.length) return { error: errs.join(' ') };
  if (password !== confirm) return { error: 'The two passwords do not match.' };
  const pwned = await pwnedPasswordCount(password);
  if (pwned && pwned > 0) return { error: `That password has appeared in ${pwned.toLocaleString()} data breaches. Choose a different one.`, field: 'password' };

  if (!(await consumeOneTimeToken(rec.id))) return { error: 'This link was already used.' };
  await execute(
    `UPDATE users SET password_hash = ?, password_changed_at = NOW(), email_verified_at = COALESCE(email_verified_at, NOW()), failed_login_count = 0, locked_until = NULL WHERE id = ?`,
    [await hashPassword(password), user.id],
  );
  await revokeAllUserSessions(user.id, 'password_changed');
  await audit('auth.password.set', { actorUserId: user.id, metadata: { via: rec.purpose } });

  await createSession(user.id);
  const session = await getSession();
  redirect(session ? await homeFor(session) : '/login');
}

// ---------------------------------------------------------------------------
// Attendee self-registration (optional accounts; guest checkout stays available)
// ---------------------------------------------------------------------------
export async function registerAttendee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const ip = await clientIp();
  if (await ipIsThrottled(ip) || rateLimited(`register:${ip}`, 10, 60 * 60_000)) return { error: 'Too many attempts from this network. Try again later.' };
  if (botCheck(formData)) return { error: BOT_MESSAGE };
  if (!isEmail(email)) return { error: 'Enter a valid email address.', field: 'email' };
  if (name.length < 2 || name.length > 120) return { error: 'Enter your name.', field: 'name' };
  const errs = passwordPolicyErrors(password, email);
  if (errs.length) return { error: errs.join(' '), field: 'password' };
  const pwned = await pwnedPasswordCount(password);
  if (pwned && pwned > 0) return { error: `That password has appeared in ${pwned.toLocaleString()} data breaches. Choose a different one.`, field: 'password' };

  const existing = await findUserByEmail(email);
  if (existing?.password_hash) {
    // Do not reveal that the account exists: behave as if registration succeeded and send a reset link.
    await sendSetPasswordLink(existing, { invitedBy: null, context: 'Fat Tixx', purpose: 'reset_password' });
    return { ok: true, message: 'Check your email to finish setting up your account.' };
  }
  const hash = await hashPassword(password);
  let userId: number;
  if (existing) {
    await execute(`UPDATE users SET name = ?, password_hash = ?, password_changed_at = NOW() WHERE id = ?`, [name, hash, existing.id]);
    userId = existing.id;
  } else {
    const r = await execute(
      `INSERT INTO users (public_id, email, email_normalized, name, password_hash, password_changed_at) VALUES (?, ?, ?, ?, ?, NOW())`,
      [randomUUID(), email, normalizeEmail(email), name, hash],
    );
    userId = r.insertId;
  }
  // Guest orders with this email are claimed only after the address is verified (verifyEmail below);
  // otherwise anyone could register someone else's email and see their tickets.
  await audit('auth.register', { actorUserId: userId });
  await sendVerificationEmail({ id: userId, email, name });
  await createSession(userId);
  redirect('/account?verify=sent');
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------
async function sendVerificationEmail(user: { id: number; email: string; name: string }): Promise<void> {
  const token = await createOneTimeToken('verify_email', user.email, user.id, null);
  const mail = await renderEmail('verify_email', { name: user.name, url: `${env.APP_URL}/verify-email/${token}` });
  await sendEmail({ to: user.email, toName: user.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'user', id: user.id } });
}

export async function resendVerificationEmail(): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in again.' };
  if (session.user.emailVerified) return { ok: true, message: 'Your email is already confirmed.' };
  if (rateLimited(`verify:${session.user.id}`, 3, 15 * 60_000)) return { error: 'We just sent one. Check your inbox (and spam folder), or try again in a few minutes.' };
  await sendVerificationEmail(session.user);
  return { ok: true, message: `We sent a confirmation link to ${session.user.email}.` };
}

/** Confirm the address and attach the guest orders bought with it to the account. Button-triggered (POST), so mail scanners that prefetch links cannot consume the token. */
export async function verifyEmail(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const rec = await peekOneTimeToken(String(formData.get('token') ?? ''), 'verify_email');
  if (!rec || !rec.userId) return { error: 'This link is invalid or has expired. Sign in and ask for a new one from your account page.' };
  const user = await queryOne<Row & { id: number; email: string; status: string }>(`SELECT id, email, status FROM users WHERE id = ?`, [rec.userId]);
  if (!user || user.status !== 'active' || normalizeEmail(user.email) !== normalizeEmail(rec.email)) return { error: 'This link is no longer valid for your account.' };
  if (!(await consumeOneTimeToken(rec.id))) return { error: 'This link was already used.' };
  await execute(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = ?`, [user.id]);
  const claimed = await execute(`UPDATE orders SET user_id = ? WHERE user_id IS NULL AND buyer_email = ?`, [user.id, normalizeEmail(user.email)]);
  await audit('auth.email_verified', { actorUserId: user.id, metadata: { claimedOrders: claimed.affectedRows } });
  return { ok: true, message: claimed.affectedRows ? `Email confirmed. ${claimed.affectedRows} earlier order(s) with this email are now in your account.` : 'Email confirmed.' };
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------
export async function logout(): Promise<void> {
  const session = await getSession();
  if (session) {
    await revokeSession(session.id, 'logout');
    await audit('auth.logout', { actorUserId: session.user.id });
  }
  await clearSessionCookie();
  redirect('/login');
}

export async function revokeOtherSession(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');
  const target = String(formData.get('sessionId') ?? '');
  if (!/^[0-9a-f]{64}$/.test(target) || target === session.id) return;
  const r = await execute(
    `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'revoked_by_user' WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [target, session.user.id],
  );
  if (r.affectedRows) await audit('auth.session.revoked', { actorUserId: session.user.id, targetType: 'session', targetId: target.slice(0, 12) });
}

/** Step-up protected: requires a sign-in within the last few minutes. */
export async function revokeAllOtherSessions(): Promise<ActionState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in again.' };
  if (!authIsFresh(session)) return { error: 'For safety, sign out and back in before revoking every other session.' };
  const n = await revokeAllUserSessions(session.user.id, 'revoked_all_by_user', session.id);
  await audit('auth.session.revoked_all', { actorUserId: session.user.id, metadata: { count: n } });
  return { ok: true };
}
