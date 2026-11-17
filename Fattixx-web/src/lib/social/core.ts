import 'server-only';
import { query, queryOne, type Row, type SqlParam } from '../db';
import { uploadUrl } from '../uploads';

/**
 * Social & Community (plan section 11): the shared rules every social page follows.
 *
 *  - Social features need an account with a profile: a username and the 18+ confirmation (11.11). Guest checkout
 *    still works without one.
 *  - A ticket holder is someone with a live ticket (valid or used) for the event, on an order tied to their account,
 *    or a ticket made out to their confirmed email (transfers). RSVP (free) events count the same way.
 *  - Social pages never show ticket types, prices, order numbers or QR codes: nothing here selects them.
 *  - A block hides both people from each other (profiles, Who's Going, feed posts) and removes follows between them.
 */

export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])?$/;
const RESERVED = new Set([
  'admin', 'support', 'fattixx', 'help', 'account', 'settings', 'events', 'event', 'org', 'orgs', 'login', 'register', 'api', 'me', 'you',
  'staff', 'security', 'privacy', 'terms', 'about', 'official', 'team', 'root', 'system', 'null', 'undefined', 'invite', 'u',
]);

/** "@Maya.J " → "maya.j" */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, '').toLowerCase();
}

/** Why a username can't be used, or null when it can (availability is checked separately). */
export function usernameProblem(u: string): string | null {
  if (u.length < 3 || u.length > 30) return 'Usernames are 3 to 30 characters.';
  if (!USERNAME_RE.test(u)) return 'Use letters, numbers, dots and underscores, starting and ending with a letter or number.';
  if (/[._]{2}/.test(u)) return 'Dots and underscores can’t be next to each other.';
  if (RESERVED.has(u)) return 'That username is reserved.';
  return null;
}

/** "@maya" from a typed handle or a profile URL; null when it isn't a plausible handle. */
export function normalizeHandle(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/(www\.)?(instagram\.com|tiktok\.com|x\.com|twitter\.com)\//i, '').replace(/[/?#].*$/, '').replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,40}$/.test(s) ? s : null;
}

export type HandleNetwork = 'instagram' | 'tiktok' | 'x';
export function handleUrl(network: HandleNetwork, handle: string): string {
  if (network === 'instagram') return `https://instagram.com/${handle}`;
  if (network === 'tiktok') return `https://www.tiktok.com/@${handle}`;
  return `https://x.com/${handle}`;
}

export const profileHref = (username: string) => `/u/${username}`;

export type SocialUserRow = Row & {
  id: number; public_id: string; name: string; email: string; email_verified_at: Date | null; status: string;
  username: string | null; avatar_path: string | null; bio: string | null; city: string | null;
  instagram: string | null; tiktok: string | null; x_handle: string | null;
  profile_public: number; show_on_guest_lists: number; show_events_on_profile: number; follow_approval: number;
  social_sms_opt_in: number; favorite_categories: string | null; age_confirmed_at: Date | null; phone: string | null; created_at: Date; marketing_opt_in: number;
};

const SOCIAL_COLS = `id, public_id, name, email, email_verified_at, status, username, avatar_path, bio, city, instagram, tiktok, x_handle,
  profile_public, show_on_guest_lists, show_events_on_profile, follow_approval, social_sms_opt_in, favorite_categories, age_confirmed_at, phone, created_at, marketing_opt_in`;

export async function getSocialUser(id: number): Promise<SocialUserRow | null> {
  return queryOne<SocialUserRow>(`SELECT ${SOCIAL_COLS} FROM users WHERE id = ?`, [id]);
}

export async function getUserByUsername(username: string): Promise<SocialUserRow | null> {
  const u = normalizeUsername(username);
  if (!USERNAME_RE.test(u)) return null;
  return queryOne<SocialUserRow>(`SELECT ${SOCIAL_COLS} FROM users WHERE username = ? AND status = 'active'`, [u]);
}

/** Has a username and confirmed they are 18 or older: may use social features (and appear to others). */
export function hasProfile(u: Pick<SocialUserRow, 'username' | 'age_confirmed_at' | 'status'> | null | undefined): u is SocialUserRow & { username: string } {
  return !!u && !!u.username && !!u.age_confirmed_at && u.status === 'active';
}

/** The first name only, as Who's Going shows people ("Maya, Jordan and 128 others"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() || '?';
}

export type PersonCard = { id: number; username: string; name: string; avatar: string | null; initials: string; city?: string | null };

export function personCard(u: { id: number; username: string | null; name: string; avatar_path: string | null; city?: string | null }): PersonCard {
  return { id: Number(u.id), username: u.username ?? '', name: u.name, avatar: uploadUrl(u.avatar_path), initials: initials(u.name), city: u.city ?? null };
}

/**
 * SQL condition: user `alias` holds a live ticket for event `?`. Uses two placeholders, both the event id.
 * Transferred tickets count for the recipient once their email is confirmed.
 */
export function holdsTicketSql(alias: string): string {
  return `(EXISTS (SELECT 1 FROM orders o JOIN tickets t ON t.order_id = o.id
                    WHERE o.user_id = ${alias}.id AND o.event_id = ? AND o.status IN ('paid','partially_refunded') AND t.status IN ('valid','used')
                      AND (t.transferred_from_id IS NULL OR t.attendee_email = o.buyer_email))
        OR (${alias}.email_verified_at IS NOT NULL AND EXISTS (SELECT 1 FROM tickets t2 WHERE t2.event_id = ? AND t2.status IN ('valid','used') AND t2.attendee_email = ${alias}.email)))`;
}

export async function holdsTicket(userId: number, eventId: number): Promise<boolean> {
  const r = await queryOne(`SELECT 1 FROM users u WHERE u.id = ? AND ${holdsTicketSql('u')}`, [userId, eventId, eventId]);
  return !!r;
}

/** Events the user holds a live ticket for (ids). */
export async function attendingEventIds(userId: number): Promise<number[]> {
  const rows = await query<Row & { event_id: number }>(
    `SELECT DISTINCT o.event_id FROM orders o JOIN tickets t ON t.order_id = o.id
      WHERE o.user_id = ? AND o.status IN ('paid','partially_refunded') AND t.status IN ('valid','used')
        AND (t.transferred_from_id IS NULL OR t.attendee_email = o.buyer_email)
     UNION
     SELECT DISTINCT t.event_id FROM tickets t JOIN users u ON u.email = t.attendee_email AND u.email_verified_at IS NOT NULL
      WHERE u.id = ? AND t.status IN ('valid','used')`,
    [userId, userId],
  );
  return rows.map((r) => Number(r.event_id));
}

/** SQL condition: neither user `a` nor `b` (column expressions or placeholders) has blocked the other. */
export function notBlockedSql(a: string, b: string): string {
  return `NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = ${a} AND ub.blocked_id = ${b}) OR (ub.blocker_id = ${b} AND ub.blocked_id = ${a}))`;
}

export async function blockedEitherWay(a: number, b: number): Promise<boolean> {
  if (a === b) return false;
  const r = await queryOne(`SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`, [a, b, b, a]);
  return !!r;
}

export async function hasBlocked(blocker: number, blocked: number): Promise<boolean> {
  return !!(await queryOne(`SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`, [blocker, blocked]));
}

export type FollowState = 'none' | 'pending' | 'active';

export async function followState(follower: number, followee: number): Promise<FollowState> {
  const r = await queryOne<Row & { status: 'active' | 'pending' }>(`SELECT status FROM user_follows WHERE follower_id = ? AND followee_id = ?`, [follower, followee]);
  return r?.status ?? 'none';
}

/** Friends follow each other (both follows approved). */
export async function areFriends(a: number, b: number): Promise<boolean> {
  const r = await queryOne<Row & { n: number }>(
    `SELECT COUNT(*) AS n FROM user_follows WHERE status = 'active' AND ((follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?))`, [a, b, b, a],
  );
  return Number(r?.n) === 2;
}

/** Ids of the people `userId` follows (active), for "friends first" ordering. */
export async function followingIds(userId: number): Promise<number[]> {
  const rows = await query<Row & { id: number }>(`SELECT followee_id AS id FROM user_follows WHERE follower_id = ? AND status = 'active'`, [userId]);
  return rows.map((r) => Number(r.id));
}

/** Ids of mutual follows. */
export async function friendIds(userId: number): Promise<number[]> {
  const rows = await query<Row & { id: number }>(
    `SELECT a.followee_id AS id FROM user_follows a JOIN user_follows b ON b.follower_id = a.followee_id AND b.followee_id = a.follower_id AND b.status = 'active'
      WHERE a.follower_id = ? AND a.status = 'active'`, [userId],
  );
  return rows.map((r) => Number(r.id));
}

/** "?, ?, ?" for an IN list (callers guarantee the list is not empty). */
export function placeholders(values: readonly SqlParam[]): string {
  return values.map(() => '?').join(', ');
}
