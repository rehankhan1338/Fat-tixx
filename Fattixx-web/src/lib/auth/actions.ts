'use server';

import { redirect } from 'next/navigation';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { homeFor } from '../authz';
import { env } from '../env';
import { clientIp, userAgent } from '../request';
import { hashPassword, passwordPolicyErrors, pwnedPasswordCount } from '../security/password';
import { ipIsThrottled, recordAttempt } from '../security/rate-limit';
import { consumeOneTimeToken, peekOneTimeToken } from '../tokens';
import { BOT_MESSAGE, botCheck, rateLimited } from '../security/bot';
import { findUserByEmail, isEmail, normalizeEmail, sendSetPasswordLink } from '../users';
import { authenticateWithPassword, platformRolesOf, registerAttendeeAccount, sendVerificationEmail } from './credentials';
import { authIsFresh, clearSessionCookie, createSession, getSession, revokeAllUserSessions, revokeSession } from './session';

/**
 * Server Actions for authentication. Every export here is a public POST endpoint, so each
 * one validates its own input and authorization and returns only what the UI needs.
 * The credential checks themselves live in ./credentials.ts, shared with the mobile API.
 */

export type ActionState = { error?: string; ok?: boolean; message?: string; field?: string } | undefined;

/** Only allow same-site relative redirects after login. */
function safeNext(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw : '';
  return /^\/(?!\/)[\w\-./?=&%]*$/.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
/**
 * Two sign-in pages share one credential check but admit different accounts:
 *  - `public` (the main site's /login): attendees, organizers, scanners and organization admins. Platform staff
 *    are turned away so a Super Admin account is never used on the public site.
 *  - `admin` (the admin console in Fattixx-admin/, homepage): platform staff only (super_admin, support, finance).
 * The check runs after the password is verified, so a wrong-portal attempt costs the same as a bad password
 * and is logged like one.
 */
type LoginPortal = 'public' | 'admin';

// Not exported: a 'use server' module may only export async functions.
const STAFF_ONLY_PORTAL_ERROR = 'This sign-in page is for Fat Tixx platform staff. Please use the regular sign-in page.';

async function signIn(portal: LoginPortal, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = safeNext(formData.get('next'));

  const result = await authenticateWithPassword(email, password);
  if (!result.ok) return { error: result.error };
  const { user } = result;

  const roles = await platformRolesOf(user.id);
  const wrongPortal = portal === 'public' ? roles.length > 0 : roles.length === 0;
  if (wrongPortal) {
    const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
    await recordAttempt({ emailNormalized: normalizeEmail(email), userId: user.id, ip, success: false, reason: `wrong_portal:${portal}`, userAgent: ua });
    await audit('auth.login.failed', { actorUserId: user.id, metadata: { reason: 'wrong_portal', portal } });
    return { error: portal === 'public' ? `Platform staff sign in at the admin console: ${env.ADMIN_URL}` : STAFF_ONLY_PORTAL_ERROR };
  }

  await createSession(user.id);
  await audit('auth.session.created', { actorUserId: user.id, metadata: { portal } });

  // The console hosts the staff pages (/admin/*) and the organizer dashboards staff may open (/org/*).
  if (portal === 'admin') redirect(next && /^\/(admin|org)(\/|$)/.test(next) ? next : '/admin');
  const session = await getSession();
  redirect(next ?? (session ? await homeFor(session) : '/'));
}

/** Main site /login: everyone except platform staff. */
export async function loginWithPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return signIn('public', formData);
}

/** Admin console sign-in: platform staff only. */
export async function adminLoginWithPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return signIn('admin', formData);
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

  // Platform staff are never signed in on the public site: they continue at the admin console's sign-in page.
  if (!env.IS_ADMIN_APP && (await platformRolesOf(user.id)).length) redirect(`${env.ADMIN_URL}/?ready=1`);

  await createSession(user.id);
  const session = await getSession();
  redirect(session ? await homeFor(session) : '/login');
}

// ---------------------------------------------------------------------------
// Attendee self-registration (optional accounts; guest checkout stays available)
// ---------------------------------------------------------------------------
export async function registerAttendee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (botCheck(formData)) return { error: BOT_MESSAGE };
  const result = await registerAttendeeAccount({
    email: String(formData.get('email') ?? ''), name: String(formData.get('name') ?? ''), password: String(formData.get('password') ?? ''),
  });
  if (result.kind === 'error') return { error: result.error, field: result.field };
  if (result.kind === 'existing') return { ok: true, message: result.message };
  await createSession(result.userId);
  const next = safeNext(formData.get('next'));
  redirect(next ? `${next}${next.includes('?') ? '&' : '?'}verify=sent` : '/account?verify=sent');
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

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
async function endSession(): Promise<void> {
  const session = await getSession();
  if (session) {
    await revokeSession(session.id, 'logout');
    await audit('auth.logout', { actorUserId: session.user.id });
  }
  await clearSessionCookie();
}

/** Sign out of the main site. */
export async function logout(): Promise<void> {
  await endSession();
  redirect('/login');
}

/** Sign out of the admin console, whose sign-in page is its homepage. */
export async function adminLogout(): Promise<void> {
  await endSession();
  redirect('/');
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
