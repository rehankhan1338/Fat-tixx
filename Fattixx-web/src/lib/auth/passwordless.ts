import 'server-only';
import { randomInt, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { env } from '../env';
import { isEmailConfigured, sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { clientIp, userAgent } from '../request';
import { hmacHex, randomToken, safeEqual, sha256 } from '../security/crypto';
import { clearAccountFailures, ipIsThrottled, recordAttempt } from '../security/rate-limit';
import { isSmsConfigured, sendSms } from '../sms';
import { findUserByEmail, isEmail, normalizeEmail, type UserRow } from '../users';
import { platformRolesOf, sendVerificationEmail } from './credentials';
import { createSession } from './session';

/**
 * Passwordless sign-up and sign-in for the last step of /create (plan 5.6): a 6-digit code by email or text message,
 * or "Continue with Google". Someone new then gives their first and last name and accepts the terms; the date and
 * time of that acceptance are stored on the account.
 *
 *  - Codes: 6 digits, valid CODE_TTL_MINUTES, MAX_TRIES wrong tries (then a new code is needed), a new one can be
 *    requested after RESEND_SECONDS. Only a keyed hash is stored, and only the newest code for an address works.
 *  - Limits on asking for codes: per email / phone, per device (the HttpOnly fx_dev cookie) and per network.
 *  - Platform staff never sign in here (as on /login); suspended or disabled accounts are refused.
 *  - A verified identity without an account waits in pending_signups (HttpOnly fx_signup cookie) for the last step.
 */
export type Channel = 'email' | 'sms';

export const CODE_TTL_MINUTES = 10;
export const RESEND_SECONDS = 30;
export const MAX_TRIES = 5;
export const TERMS_VERSION = '2026-10';
const LIMIT_WINDOW_MINUTES = 60;
const MAX_PER_DESTINATION = 5;
const MAX_PER_DEVICE = 10;
const MAX_PER_NETWORK = 30;
const SIGNUP_TTL_MINUTES = 30;
const DEVICE_COOKIE = 'fx_dev';
const SIGNUP_COOKIE = 'fx_signup';
const REDACTED = '••••••';
const INACTIVE_ERROR = 'This account can’t sign in. Contact support if you think that’s a mistake.';
// Same wording as the public /login page gives platform staff: it does not say where staff sign in.
const STAFF_ERROR = 'Something went wrong';

/** Lower-case email, or an E.164 phone number ("+18435550123"); null when it isn't one. */
export function normalizeDestination(channel: Channel, raw: string): string | null {
  if (channel === 'email') {
    const e = raw.trim();
    return isEmail(e) ? normalizeEmail(e) : null;
  }
  const p = raw.replace(/\(0\)/g, '').replace(/[\s().-]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}

/** Six random digits, "000000"–"999999". */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function codeHash(channel: Channel, destination: string, code: string): string {
  return hmacHex(`signin-code:${channel}:${destination}:${code}`);
}

const cookieBase = { httpOnly: true, secure: env.IS_PROD, sameSite: 'lax' as const, path: '/' };

/** This browser's id for the per-device limit, created on first use. */
async function deviceId(): Promise<string> {
  const store = await cookies();
  const have = store.get(DEVICE_COOKIE)?.value;
  if (have && /^[a-f0-9]{32}$/.test(have)) return have;
  const id = randomUUID().replace(/-/g, '');
  store.set(DEVICE_COOKIE, id, { ...cookieBase, maxAge: 365 * 86_400 });
  return id;
}

async function countSince(column: 'destination' | 'device_id' | 'ip', value: string): Promise<number> {
  const r = await queryOne<Row & { n: number }>(
    `SELECT COUNT(*) AS n FROM auth_codes WHERE ${column} = ? AND created_at > NOW() - INTERVAL ? MINUTE`, [value, LIMIT_WINDOW_MINUTES],
  );
  return Number(r?.n ?? 0);
}

export type SendResult =
  | { ok: true; destination: string; resendIn: number; expiresIn: number; devCode?: string }
  | { ok: false; error: string; retryIn?: number };

/** Ask for a code. The same answer whether or not an account exists for the address. */
export async function sendSignInCode(channel: Channel, raw: string): Promise<SendResult> {
  const destination = normalizeDestination(channel, raw);
  if (!destination) return { ok: false, error: channel === 'email' ? 'Enter a valid email address.' : 'Enter a valid mobile number, including the area code.' };
  const [ip, device] = await Promise.all([clientIp(), deviceId()]);
  if (await ipIsThrottled(ip)) return { ok: false, error: 'Too many attempts from this network. Try again later.' };

  const last = await queryOne<Row & { age: number }>(
    `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age FROM auth_codes WHERE destination = ? ORDER BY id DESC LIMIT 1`, [destination],
  );
  if (last && Number(last.age) < RESEND_SECONDS) {
    const retryIn = RESEND_SECONDS - Number(last.age);
    return { ok: false, error: `You can ask for a new code in ${retryIn} seconds.`, retryIn };
  }
  const where = channel === 'email' ? 'this email address' : 'this number';
  if ((await countSince('destination', destination)) >= MAX_PER_DESTINATION) return { ok: false, error: `Too many codes were sent to ${where}. Try again in an hour.` };
  if ((await countSince('device_id', device)) >= MAX_PER_DEVICE) return { ok: false, error: 'Too many codes were requested from this device. Try again in an hour.' };
  // Without a trusted proxy every visitor shares the "direct" bucket, so the network limit only applies with real IPs.
  if (ip !== 'direct' && (await countSince('ip', ip)) >= MAX_PER_NETWORK) return { ok: false, error: 'Too many codes were requested from this network. Try again later.' };

  const code = newCode();
  // Only the newest code for an address works.
  await execute(`UPDATE auth_codes SET consumed_at = NOW() WHERE destination = ? AND consumed_at IS NULL`, [destination]);
  const r = await execute(
    `INSERT INTO auth_codes (channel, destination, code_hash, expires_at, device_id, ip) VALUES (?, ?, ?, NOW() + INTERVAL ? MINUTE, ?, ?)`,
    [channel, destination, codeHash(channel, destination, code), CODE_TTL_MINUTES, device, ip],
  );

  let delivered: boolean;
  if (channel === 'email') {
    const mail = await renderEmail('sign_in_code', { code, minutes: String(CODE_TTL_MINUTES) });
    const id = await sendEmail({ to: destination, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'auth_code', id: r.insertId } });
    // Once delivered, the outbox (Admin → Emails) keeps no usable code. Failed sends keep it for the automatic retry.
    await execute(
      `UPDATE email_outbox SET subject = REPLACE(subject, ?, ?), text_body = REPLACE(text_body, ?, ?), html_body = REPLACE(html_body, ?, ?) WHERE id = ? AND status = 'sent'`,
      [code, REDACTED, code, REDACTED, code, REDACTED, id],
    );
    delivered = await isEmailConfigured();
  } else {
    const id = await sendSms(destination, `${code} is your Fattixx code. It expires in ${CODE_TTL_MINUTES} minutes. Don't share it with anyone.`, { type: 'auth_code', id: r.insertId });
    if (id) await execute(`UPDATE sms_outbox SET body = REPLACE(body, ?, ?) WHERE id = ? AND status = 'sent'`, [code, REDACTED, id]);
    delivered = isSmsConfigured();
  }
  await audit('auth.code.sent', { targetType: 'auth_code', targetId: r.insertId, metadata: { channel } });
  // Local development without an email / SMS provider: show the code on screen instead (never in production).
  return { ok: true, destination, resendIn: RESEND_SECONDS, expiresIn: CODE_TTL_MINUTES * 60, devCode: !env.IS_PROD && !delivered ? code : undefined };
}

export type VerifyResult =
  | { ok: true; status: 'signed_in'; userId: number }
  | { ok: true; status: 'needs_profile'; email: string | null; phone: string | null }
  | { ok: false; error: string; expired?: boolean };

/** Check a code. Signs an existing account in; a new address goes on to the last step (names and terms). */
export async function verifySignInCode(channel: Channel, raw: string, codeRaw: string): Promise<VerifyResult> {
  const destination = normalizeDestination(channel, raw);
  const code = codeRaw.replace(/\D/g, '');
  if (!destination) return { ok: false, error: 'Start again with your email or number.', expired: true };
  if (code.length !== 6) return { ok: false, error: 'Enter the 6-digit code.' };
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
  if (await ipIsThrottled(ip)) return { ok: false, error: 'Too many attempts from this network. Try again later.' };

  const row = await queryOne<Row & { id: number; code_hash: string; attempts: number }>(
    `SELECT id, code_hash, attempts FROM auth_codes WHERE channel = ? AND destination = ? AND consumed_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1`,
    [channel, destination],
  );
  // Each try is claimed atomically first, so parallel guesses can't get past MAX_TRIES.
  const claim = row ? await execute(`UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND consumed_at IS NULL AND expires_at > NOW()`, [row.id, MAX_TRIES]) : null;
  if (!row || !claim?.affectedRows) return { ok: false, error: 'That code has expired. Send a new one.', expired: true };

  if (!safeEqual(codeHash(channel, destination, code), row.code_hash)) {
    const left = MAX_TRIES - (Number(row.attempts) + 1);
    await recordAttempt({ emailNormalized: channel === 'email' ? destination : null, userId: null, ip, success: false, reason: 'bad_code', userAgent: ua });
    if (left <= 0) {
      await execute(`UPDATE auth_codes SET consumed_at = NOW() WHERE id = ?`, [row.id]);
      await audit('auth.code.failed', { targetType: 'auth_code', targetId: row.id, metadata: { channel, locked: true } });
      return { ok: false, error: 'That code isn’t right, and it has now expired after 5 tries. Send a new code.', expired: true };
    }
    return { ok: false, error: `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.` };
  }
  const used = await execute(`UPDATE auth_codes SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL`, [row.id]);
  if (!used.affectedRows) return { ok: false, error: 'That code was already used. Send a new one.', expired: true };

  const user = channel === 'email'
    ? await findUserByEmail(destination)
    : await queryOne<UserRow>(`SELECT * FROM users WHERE phone_e164 = ? AND phone_verified_at IS NOT NULL`, [destination]);
  if (user) {
    const err = await signInExisting(user, channel === 'email' ? 'email_code' : 'sms_code', { emailProven: channel === 'email' });
    return err ? { ok: false, error: err } : { ok: true, status: 'signed_in', userId: Number(user.id) };
  }
  await startPendingSignup({ method: channel === 'email' ? 'email' : 'phone', email: channel === 'email' ? destination : null, emailVerified: channel === 'email', phone: channel === 'sms' ? destination : null });
  return { ok: true, status: 'needs_profile', email: channel === 'email' ? destination : null, phone: channel === 'sms' ? destination : null };
}

/** Attach the guest orders bought with a now-proven email address to the account (as verifyEmail does). */
async function claimGuestOrders(userId: number, email: string): Promise<number> {
  const r = await execute(`UPDATE orders SET user_id = ? WHERE user_id IS NULL AND buyer_email = ?`, [userId, normalizeEmail(email)]);
  return r.affectedRows;
}

/** Sign in an account that proved who it is by code or Google. Returns an error message, or null when signed in. */
async function signInExisting(user: UserRow, method: 'email_code' | 'sms_code' | 'google', opts: { emailProven: boolean }): Promise<string | null> {
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
  const emailNormalized = normalizeEmail(user.email);
  if (user.status !== 'active') {
    await recordAttempt({ emailNormalized, userId: user.id, ip, success: false, reason: 'inactive', userAgent: ua });
    return INACTIVE_ERROR;
  }
  if ((await platformRolesOf(user.id)).length) {
    await recordAttempt({ emailNormalized, userId: user.id, ip, success: false, reason: 'wrong_portal:public', userAgent: ua });
    await audit('auth.login.failed', { actorUserId: user.id, metadata: { reason: 'wrong_portal', portal: 'public', method } });
    return STAFF_ERROR;
  }
  if (opts.emailProven && !user.email_verified_at) {
    await execute(`UPDATE users SET email_verified_at = NOW() WHERE id = ? AND email_verified_at IS NULL`, [user.id]);
    const claimed = await claimGuestOrders(user.id, user.email);
    await audit('auth.email_verified', { actorUserId: user.id, metadata: { claimedOrders: claimed, via: method } });
  }
  await clearAccountFailures(user.id);
  await execute(`UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?`, [ip, user.id]);
  await recordAttempt({ emailNormalized, userId: user.id, ip, success: true, reason: `${method}_ok`, userAgent: ua });
  await audit('auth.login.success', { actorUserId: user.id, metadata: { method } });
  await createSession(user.id);
  await audit('auth.session.created', { actorUserId: user.id, metadata: { portal: 'public', method } });
  return null;
}

// ---------------------------------------------------------------------------
// The last step for someone new: first and last name, terms
// ---------------------------------------------------------------------------
export type PendingSignup = { method: 'email' | 'phone' | 'google'; email: string | null; emailVerified: boolean; phone: string | null; firstName: string | null; lastName: string | null };

type PendingRow = Row & { id: string; method: PendingSignup['method']; email: string | null; email_verified: number; phone_e164: string | null; google_sub: string | null; first_name: string | null; last_name: string | null };

async function startPendingSignup(p: { method: PendingSignup['method']; email: string | null; emailVerified: boolean; phone?: string | null; googleSub?: string | null; firstName?: string | null; lastName?: string | null }): Promise<void> {
  const token = randomToken(32);
  await execute(
    `INSERT INTO pending_signups (id, method, email, email_verified, phone_e164, google_sub, first_name, last_name, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL ? MINUTE)`,
    [sha256(token), p.method, p.email, p.emailVerified ? 1 : 0, p.phone ?? null, p.googleSub ?? null, p.firstName?.slice(0, 60) ?? null, p.lastName?.slice(0, 60) ?? null, SIGNUP_TTL_MINUTES],
  );
  (await cookies()).set(SIGNUP_COOKIE, token, { ...cookieBase, maxAge: SIGNUP_TTL_MINUTES * 60 });
}

async function pendingRow(): Promise<PendingRow | null> {
  const token = (await cookies()).get(SIGNUP_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
  return queryOne<PendingRow>(`SELECT * FROM pending_signups WHERE id = ? AND consumed_at IS NULL AND expires_at > NOW()`, [sha256(token)]);
}

/** The verified identity waiting for its last step in this browser, if any. */
export async function readPendingSignup(): Promise<PendingSignup | null> {
  const r = await pendingRow();
  return r ? { method: r.method, email: r.email, emailVerified: !!r.email_verified, phone: r.phone_e164, firstName: r.first_name, lastName: r.last_name } : null;
}

export type CompleteResult = { ok: true; userId: number } | { ok: false; error: string; field?: 'first_name' | 'last_name' | 'email' | 'terms'; restart?: boolean };

/** Create the account from the pending sign-up, record the terms acceptance and sign it in. */
export async function completeSignup(input: { firstName: string; lastName: string; email?: string; acceptTerms: boolean }): Promise<CompleteResult> {
  const p = await pendingRow();
  if (!p) return { ok: false, error: 'Your sign-in timed out. Start again with your email, number or Google.', restart: true };
  const firstName = input.firstName.trim().replace(/\s+/g, ' ');
  const lastName = input.lastName.trim().replace(/\s+/g, ' ');
  if (!firstName || firstName.length > 60) return { ok: false, error: 'Enter your first name.', field: 'first_name' };
  if (!lastName || lastName.length > 60) return { ok: false, error: 'Enter your last name.', field: 'last_name' };
  // Signing up by text: an email address is still needed for receipts, payouts and the organizer's contact address.
  const email = (p.email ?? input.email ?? '').trim();
  if (!isEmail(email)) return { ok: false, error: 'Enter your email address. We send receipts and organizer emails there.', field: 'email' };
  if (!input.acceptTerms) return { ok: false, error: 'Please accept the Terms of Service and Organizer Agreement to continue.', field: 'terms' };

  const existing = await findUserByEmail(email);
  if (existing) {
    // The address proved by code or Google already has an account (created meanwhile): sign that account in.
    if (p.email_verified && normalizeEmail(p.email ?? '') === normalizeEmail(email)) {
      await execute(`UPDATE pending_signups SET consumed_at = NOW() WHERE id = ?`, [p.id]);
      if (p.google_sub && !existing.google_sub) await execute(`UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL`, [p.google_sub, existing.id]);
      const err = await signInExisting(existing, p.method === 'google' ? 'google' : 'email_code', { emailProven: true });
      await clearSignupCookie();
      return err ? { ok: false, error: err } : { ok: true, userId: Number(existing.id) };
    }
    return { ok: false, error: 'That email already has a Fattixx account. Go back and continue with your email instead.', field: 'email' };
  }

  const claim = await execute(`UPDATE pending_signups SET consumed_at = NOW() WHERE id = ? AND consumed_at IS NULL`, [p.id]);
  if (!claim.affectedRows) return { ok: false, error: 'Your sign-in timed out. Start again.', restart: true };
  const name = `${firstName} ${lastName}`.slice(0, 120);
  let userId: number;
  try {
    const r = await execute(
      `INSERT INTO users (public_id, email, email_normalized, email_verified_at, name, first_name, last_name, phone, phone_e164, phone_verified_at, google_sub, terms_accepted_at, terms_version)
       VALUES (?, ?, ?, IF(?, NOW(), NULL), ?, ?, ?, ?, ?, IF(?, NOW(), NULL), ?, NOW(), ?)`,
      [randomUUID(), email, normalizeEmail(email), p.email_verified ? 1 : 0, name, firstName, lastName, p.phone_e164, p.phone_e164, p.phone_e164 ? 1 : 0, p.google_sub, TERMS_VERSION],
    );
    userId = r.insertId;
  } catch (e) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') return { ok: false, error: 'That email or number already has a Fattixx account. Go back and sign in with it instead.', field: 'email' };
    throw e;
  }
  await audit('auth.register', { actorUserId: userId, metadata: { method: p.method } });
  await audit('auth.terms_accepted', { actorUserId: userId, targetType: 'user', targetId: userId, metadata: { version: TERMS_VERSION } });
  if (p.email_verified) {
    const claimed = await claimGuestOrders(userId, email);
    if (claimed) await audit('auth.email_verified', { actorUserId: userId, metadata: { claimedOrders: claimed, via: p.method } });
  } else {
    await sendVerificationEmail({ id: userId, email, name });
  }
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
  await execute(`UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?`, [ip, userId]);
  await recordAttempt({ emailNormalized: normalizeEmail(email), userId, ip, success: true, reason: `signup_${p.method}`, userAgent: ua });
  await createSession(userId);
  await audit('auth.session.created', { actorUserId: userId, metadata: { portal: 'public', method: p.method } });
  await clearSignupCookie();
  return { ok: true, userId };
}

async function clearSignupCookie(): Promise<void> {
  (await cookies()).set(SIGNUP_COOKIE, '', { ...cookieBase, maxAge: 0 });
}

// ---------------------------------------------------------------------------
// Continue with Google (OpenID Connect, authorization code + PKCE; see src/app/api/auth/google)
// ---------------------------------------------------------------------------
export function googleConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${env.APP_URL}/api/auth/google/callback` };
}

export type GoogleProfile = { sub: string; email: string | null; emailVerified: boolean; givenName: string | null; familyName: string | null };

/** After Google confirmed who it is: sign in, link the Google account to a matching verified email, or start the last step. */
export async function googleSignIn(g: GoogleProfile): Promise<{ status: 'signed_in' | 'needs_profile' } | { error: string }> {
  const bySub = await queryOne<UserRow>(`SELECT * FROM users WHERE google_sub = ?`, [g.sub]);
  if (bySub) {
    const err = await signInExisting(bySub, 'google', { emailProven: false });
    return err ? { error: err } : { status: 'signed_in' };
  }
  const byEmail = g.email ? await findUserByEmail(g.email) : null;
  if (byEmail) {
    // Only an address Google has verified may be linked; otherwise anyone could claim someone else's account.
    if (!g.emailVerified) return { error: 'That Google account’s email isn’t verified, and a Fattixx account already uses it. Continue with your email instead.' };
    if (byEmail.google_sub && byEmail.google_sub !== g.sub) return { error: 'This email is linked to a different Google account. Continue with your email instead.' };
    if (!byEmail.google_sub) {
      await execute(`UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL`, [g.sub, byEmail.id]);
      await audit('auth.google.linked', { actorUserId: byEmail.id, targetType: 'user', targetId: byEmail.id });
    }
    const err = await signInExisting(byEmail, 'google', { emailProven: true });
    return err ? { error: err } : { status: 'signed_in' };
  }
  await startPendingSignup({ method: 'google', email: g.email ? normalizeEmail(g.email) : null, emailVerified: g.emailVerified && !!g.email, googleSub: g.sub, firstName: g.givenName, lastName: g.familyName });
  return { status: 'needs_profile' };
}
