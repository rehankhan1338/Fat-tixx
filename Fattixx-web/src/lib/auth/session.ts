import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { execute, queryOne, type Row } from '../db';
import { env } from '../env';
import { randomToken, sha256 } from '../security/crypto';
import { clientIp, userAgent } from '../request';

/**
 * Server-side sessions.
 *
 *  - The client holds a random 256-bit token; the DB stores only its SHA-256, so a database
 *    dump cannot be replayed as a live session.
 *  - Browser sessions: HttpOnly cookie, absolute lifetime SESSION_ABSOLUTE_HOURS, idle timeout
 *    SESSION_IDLE_MINUTES (sliding). Cookie is SameSite=Strict, Secure in production, `__Host-`
 *    prefix in production (browser refuses to accept it from a subdomain or with a Domain/Path attribute).
 *  - Mobile app sessions: the same table, but the token travels in `Authorization: Bearer <token>`
 *    (never sent automatically by a browser, so no CSRF surface) and is kept in the device keychain.
 *    They live MOBILE_SESSION_DAYS with no idle timeout; signing out or changing the password revokes them.
 */
export const SESSION_ABSOLUTE_HOURS = 12;
export const SESSION_IDLE_MINUTES = 30;
export const MOBILE_SESSION_DAYS = 30;
/** How recent the sign-in must be for step-up protected actions (e.g. revoking every session). */
export const FRESH_AUTH_MINUTES = 10;
/** Stored in sessions.user_agent so the account page can tell app sessions from browser sessions. */
export const MOBILE_UA_PREFIX = 'FatTixxApp/';

/**
 * The public site and the admin console (Fattixx-admin/) use different cookie names, so a console sign-in is never
 * visible on the public site even when both run on localhost (browsers share cookies across ports).
 */
export const SESSION_COOKIE = env.IS_ADMIN_APP
  ? (env.IS_PROD ? '__Host-fx_admin' : 'fx_admin')
  : (env.IS_PROD ? '__Host-fx_session' : 'fx_session');

export type PlatformRole = 'super_admin' | 'support' | 'finance';

export interface SessionUser {
  id: number;
  publicId: string;
  email: string;
  name: string;
  roles: PlatformRole[];
  emailVerified: boolean;
}

export interface CurrentSession {
  id: string;
  user: SessionUser;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  /** 'cookie' for the website, 'bearer' for the mobile app. */
  via: 'cookie' | 'bearer';
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.IS_PROD,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: maxAgeSeconds,
    priority: 'high' as const,
  };
}

export async function createSession(userId: number, opts: { label?: string } = {}): Promise<void> {
  const token = randomToken(32);
  const id = sha256(token);
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
  await execute(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
     VALUES (?, ?, NOW() + INTERVAL ? HOUR, ?, ?)`,
    [id, userId, SESSION_ABSOLUTE_HOURS, ip, opts.label ? opts.label.slice(0, 512) : ua],
  );
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_ABSOLUTE_HOURS * 3600));
}

/**
 * Mobile sign-in: create a long-lived session and return the plaintext token once. The app stores it
 * in the OS keychain / keystore and sends it as a Bearer header. `device` is a short label
 * ("iPhone 15 / iOS 18") shown in the account page's session list.
 */
export async function createBearerSession(userId: number, device: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const id = sha256(token);
  const ip = await clientIp();
  const label = `${MOBILE_UA_PREFIX}${(device ?? 'unknown device').replace(/[\r\n]/g, ' ').slice(0, 200)}`;
  await execute(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
     VALUES (?, ?, NOW() + INTERVAL ? DAY, ?, ?)`,
    [id, userId, MOBILE_SESSION_DAYS, ip, label],
  );
  return { token, expiresAt: new Date(Date.now() + MOBILE_SESSION_DAYS * 86_400_000) };
}

type SessionRow = Row & {
  id: string; user_id: number; created_at: Date; last_seen_at: Date; expires_at: Date;
  public_id: string; email: string; name: string; status: string; roles: string | null; email_verified_at: Date | null;
};

/** Token syntax check before touching the database. */
function plausibleToken(token: string | undefined | null): token is string {
  return !!token && token.length >= 32 && token.length <= 128 && /^[A-Za-z0-9_-]+$/.test(token);
}

async function resolveSession(token: string, via: CurrentSession['via']): Promise<CurrentSession | null> {
  const id = sha256(token);
  // Browser sessions expire after SESSION_IDLE_MINUTES without activity; app sessions only at expires_at. An app
  // session is never accepted as a browser cookie: a token copied out of the app must not become a website login
  // that the app's own activity keeps from idling out.
  const idleClause = via === 'cookie' ? `AND s.last_seen_at > (NOW() - INTERVAL ? MINUTE) AND (s.user_agent IS NULL OR s.user_agent NOT LIKE '${MOBILE_UA_PREFIX}%')` : '';
  const params: (string | number)[] = via === 'cookie' ? [id, SESSION_IDLE_MINUTES] : [id];
  const row = await queryOne<SessionRow>(
    `SELECT s.id, s.user_id, s.created_at, s.last_seen_at, s.expires_at,
            u.public_id, u.email, u.name, u.status, u.email_verified_at,
            (SELECT GROUP_CONCAT(r.role) FROM user_platform_roles r WHERE r.user_id = u.id) AS roles
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        ${idleClause}`,
    params,
  );
  if (!row || row.status !== 'active') return null;

  // Slide the idle window, but write at most once a minute to keep reads cheap.
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
    void execute(`UPDATE sessions SET last_seen_at = NOW() WHERE id = ?`, [id]).catch(() => {});
  }

  return {
    id: row.id,
    user: {
      id: Number(row.user_id),
      publicId: row.public_id,
      email: row.email,
      name: row.name,
      roles: (row.roles ? row.roles.split(',') : []) as PlatformRole[],
      emailVerified: row.email_verified_at != null,
    },
    createdAt: new Date(row.created_at),
    lastSeenAt: new Date(row.last_seen_at),
    expiresAt: new Date(row.expires_at),
    via,
  };
}

/**
 * Resolve the current session: `Authorization: Bearer` for the app, else the cookie for the website.
 * Cached per request so layouts, pages, actions and route handlers share one lookup.
 * Returns null for missing, expired, idle, revoked, or suspended.
 */
export const getSession = cache(async (): Promise<CurrentSession | null> => {
  // The app's Bearer header wins over the cookie: a stray browser cookie on the phone must never shadow,
  // or (once idle) hide, the app session the request names.
  const auth = (await headers()).get('authorization');
  const m = auth?.match(/^Bearer\s+([A-Za-z0-9_-]{32,128})$/i);
  if (m && plausibleToken(m[1])) return resolveSession(m[1], 'bearer');

  const store = await cookies();
  const cookieToken = store.get(SESSION_COOKIE)?.value;
  if (!plausibleToken(cookieToken)) return null;
  const session = await resolveSession(cookieToken, 'cookie');
  // Platform staff exist only in the admin console: the public site never treats a staff account as signed in,
  // whatever cookie it is handed. (Bearer sessions are unaffected: Support may use the mobile app.)
  if (session && !env.IS_ADMIN_APP && session.user.roles.length) return null;
  return session;
});

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await execute(`UPDATE sessions SET revoked_at = NOW(), revoked_reason = ? WHERE id = ? AND revoked_at IS NULL`, [reason, sessionId]);
}

export async function revokeAllUserSessions(userId: number, reason: string, exceptSessionId?: string): Promise<number> {
  const r = await execute(
    `UPDATE sessions SET revoked_at = NOW(), revoked_reason = ?
      WHERE user_id = ? AND revoked_at IS NULL ${exceptSessionId ? 'AND id <> ?' : ''}`,
    exceptSessionId ? [reason, userId, exceptSessionId] : [reason, userId],
  );
  return r.affectedRows;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
}

/** Step-up check: the sign-in itself must be recent. */
export function authIsFresh(session: CurrentSession): boolean {
  return Date.now() - session.createdAt.getTime() < FRESH_AUTH_MINUTES * 60_000;
}
