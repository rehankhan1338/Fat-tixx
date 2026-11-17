import 'server-only';
import { query, queryOne, type Row, type SqlParam } from '../db';
import {
  blockedEitherWay, followState, followingIds, friendIds, getUserByUsername, hasBlocked, hasProfile, holdsTicket, holdsTicketSql, notBlockedSql,
  personCard, placeholders, type FollowState, type PersonCard, type SocialUserRow,
} from './core';

export type GuestListMode = 'off' | 'faces' | 'faces_total';

/** A user who has a profile and lets this event's guest list show them (their per-event choice, else their setting). */
const LISTED = `u.status = 'active' AND u.username IS NOT NULL AND u.age_confirmed_at IS NOT NULL
  AND COALESCE((SELECT g.visible FROM event_guest_prefs g WHERE g.event_id = ? AND g.user_id = u.id), u.show_on_guest_lists) = 1`;

export type WhosGoing = {
  mode: GuestListMode;
  /** the viewer may not see the list (password-protected event, not a ticket holder) */
  hidden: boolean;
  people: (PersonCard & { followed: boolean })[];
  /** everyone listed (people is the first `limit`) */
  listed: number;
  /** tickets out for the event: shown only in faces_total mode */
  total: number | null;
  /** the viewer's own state */
  viewer: { holder: boolean; listed: boolean; hasProfile: boolean } | null;
};

/**
 * Who's Going (11.4) for an event page or its full list. Only signed-in ticket holders who allow it appear; people the
 * viewer follows come first; blocked people are left out both ways. Password-protected events show it to ticket holders only.
 */
export async function whosGoing(
  event: { id: number; guest_list_mode: GuestListMode; access_password: string | null },
  viewerId: number | null,
  limit = 12,
): Promise<WhosGoing> {
  const mode = event.guest_list_mode ?? 'faces';
  const viewerRow = viewerId ? await queryOne<SocialUserRow>(`SELECT id, username, age_confirmed_at, status FROM users WHERE id = ?`, [viewerId]) : null;
  const holder = viewerId ? await holdsTicket(viewerId, event.id) : false;
  const viewerListed = viewerId && holder
    ? !!(await queryOne(`SELECT 1 FROM users u WHERE u.id = ? AND ${LISTED}`, [viewerId, event.id]))
    : false;
  const viewer = viewerId ? { holder, listed: viewerListed, hasProfile: hasProfile(viewerRow) } : null;
  const empty: WhosGoing = { mode, hidden: true, people: [], listed: 0, total: null, viewer };
  if (mode === 'off') return empty;
  if (event.access_password && !holder) return empty;

  const blockClause = viewerId ? ` AND ${notBlockedSql('u.id', '?')}` : '';
  const where = `${LISTED} AND ${holdsTicketSql('u')}${blockClause}`;
  const params: SqlParam[] = [event.id, event.id, event.id, ...(viewerId ? [viewerId] : [])];
  const followed = viewerId ? await followingIds(viewerId) : [];
  const followedOrder = followed.length ? `(u.id IN (${placeholders(followed)})) DESC, ` : '';
  const [rows, count, tickets] = await Promise.all([
    query<Row & { id: number; username: string; name: string; avatar_path: string | null; city: string | null }>(
      `SELECT u.id, u.username, u.name, u.avatar_path, u.city FROM users u WHERE ${where}
        ORDER BY ${followedOrder}(u.avatar_path IS NOT NULL) DESC, u.id LIMIT ${Math.max(1, Math.min(500, limit))}`,
      [...params, ...followed],
    ),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`, params),
    mode === 'faces_total'
      ? queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM tickets WHERE event_id = ? AND status IN ('valid','used')`, [event.id])
      : Promise.resolve(null),
  ]);
  const followedSet = new Set(followed);
  return {
    mode, hidden: false, viewer,
    people: rows.map((r) => ({ ...personCard(r), followed: followedSet.has(Number(r.id)) })),
    listed: Number(count?.n ?? 0),
    total: tickets ? Number(tickets.n) : null,
  };
}

/** "Maya, Jordan and 128 others are going" (faces_total) or "Maya, Jordan and more are going" (faces only). */
export function goingLine(g: Pick<WhosGoing, 'people' | 'listed' | 'total' | 'mode'>): string {
  const names = g.people.slice(0, 2).map((p) => p.name.trim().split(/\s+/)[0]);
  if (!names.length) return g.total ? `${g.total} going` : '';
  const shown = names.length;
  if (g.mode === 'faces_total' && g.total != null) {
    const others = Math.max(0, g.total - shown);
    if (!others) return `${names.join(' and ')} ${shown === 1 ? 'is' : 'are'} going`;
    return `${names.join(', ')} and ${others} ${others === 1 ? 'other' : 'others'} are going`;
  }
  if (g.listed > shown) return `${names.join(', ')} and more are going`;
  return `${names.join(' and ')} ${shown === 1 ? 'is' : 'are'} going`;
}

/** How many of the viewer's friends are going to each event and appear on its guest list ("3 friends going"). */
export async function friendsGoingCounts(viewerId: number, eventIds: number[]): Promise<Record<number, number>> {
  if (!eventIds.length) return {};
  const friends = await friendIds(viewerId);
  if (!friends.length) return {};
  const rows = await query<Row & { event_id: number; n: number }>(
    `SELECT e.id AS event_id, COUNT(DISTINCT u.id) AS n
       FROM events e
       JOIN orders o ON o.event_id = e.id AND o.status IN ('paid','partially_refunded')
       JOIN users u ON u.id = o.user_id
      WHERE e.id IN (${placeholders(eventIds)}) AND e.guest_list_mode <> 'off' AND e.access_password IS NULL
        AND u.id IN (${placeholders(friends)})
        AND u.status = 'active' AND u.username IS NOT NULL AND u.age_confirmed_at IS NOT NULL
        AND COALESCE((SELECT g.visible FROM event_guest_prefs g WHERE g.event_id = e.id AND g.user_id = u.id), u.show_on_guest_lists) = 1
        AND EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.id AND t.status IN ('valid','used') AND (t.transferred_from_id IS NULL OR t.attendee_email = o.buyer_email))
      GROUP BY e.id`,
    [...eventIds, ...friends],
  );
  return Object.fromEntries(rows.map((r) => [Number(r.event_id), Number(r.n)]));
}

// ---------------------------------------------------------------------------
// Profiles (11.3)
// ---------------------------------------------------------------------------
export type ProfileView = {
  user: PersonCard & { bio: string | null; instagram: string | null; tiktok: string | null; x: string | null; joined: Date };
  isMe: boolean;
  /** private profile and the viewer isn't an approved follower: name and photo only */
  limited: boolean;
  followers: number;
  following: number;
  /** the viewer → this person */
  viewerFollows: FollowState;
  /** this person → the viewer */
  followsViewer: boolean;
  viewerBlocked: boolean;
  needsApproval: boolean;
  /** shown only with "Show events I'm attending" on: event ids, upcoming and past */
  eventIds: { upcoming: number[]; past: number[] } | null;
};

/** The profile as `viewerId` may see it, or null when it doesn't exist or a block hides it. */
export async function profileView(username: string, viewerId: number | null): Promise<ProfileView | null> {
  const u = await getUserByUsername(username);
  if (!hasProfile(u)) return null;
  const isMe = viewerId === u.id;
  // A blocked person can't see the blocker's profile; the blocker can still open theirs (to unblock).
  if (viewerId && !isMe && (await hasBlocked(u.id, viewerId))) return null;
  const [counts, viewerFollows, followsViewer, viewerBlocked] = await Promise.all([
    queryOne<Row & { followers: number; following: number }>(
      `SELECT (SELECT COUNT(*) FROM user_follows WHERE followee_id = ? AND status = 'active') AS followers,
              (SELECT COUNT(*) FROM user_follows WHERE follower_id = ? AND status = 'active') AS following`, [u.id, u.id],
    ),
    viewerId && !isMe ? followState(viewerId, u.id) : Promise.resolve<FollowState>('none'),
    viewerId && !isMe ? followState(u.id, viewerId).then((s) => s === 'active') : Promise.resolve(false),
    viewerId && !isMe ? hasBlocked(viewerId, u.id) : Promise.resolve(false),
  ]);
  const limited = !isMe && !u.profile_public && viewerFollows !== 'active';
  let eventIds: ProfileView['eventIds'] = null;
  if (!limited && u.show_events_on_profile) eventIds = await profileEventIds(u.id);
  return {
    user: { ...personCard(u), bio: u.bio, instagram: u.instagram, tiktok: u.tiktok, x: u.x_handle, joined: new Date(u.created_at) },
    isMe, limited, viewerFollows, followsViewer, viewerBlocked, needsApproval: !!u.follow_approval,
    followers: Number(counts?.followers ?? 0), following: Number(counts?.following ?? 0), eventIds,
  };
}

/** Public, listed events the person holds tickets for (and didn't hide from the guest list), upcoming and past. */
async function profileEventIds(userId: number): Promise<{ upcoming: number[]; past: number[] }> {
  const rows = await query<Row & { id: number; upcoming: number }>(
    `SELECT DISTINCT e.id, (COALESCE(e.ends_at, e.starts_at + INTERVAL 6 HOUR) > NOW()) AS upcoming, e.starts_at
       FROM events e
       JOIN tickets t ON t.event_id = e.id AND t.status IN ('valid','used')
       JOIN orders o ON o.id = t.order_id
       JOIN users u ON u.id = ?
      WHERE e.status IN ('published','postponed','completed') AND e.visibility = 'public' AND e.access_password IS NULL
        AND ((o.user_id = u.id AND o.status IN ('paid','partially_refunded') AND (t.transferred_from_id IS NULL OR t.attendee_email = o.buyer_email))
             OR (u.email_verified_at IS NOT NULL AND t.attendee_email = u.email))
        AND COALESCE((SELECT g.visible FROM event_guest_prefs g WHERE g.event_id = e.id AND g.user_id = u.id), 1) = 1
      ORDER BY e.starts_at`,
    [userId],
  );
  return {
    upcoming: rows.filter((r) => Number(r.upcoming)).map((r) => Number(r.id)),
    past: rows.filter((r) => !Number(r.upcoming)).map((r) => Number(r.id)).reverse(),
  };
}

/** May the viewer see this person at all (profiles, lists)? */
export async function canSeePerson(viewerId: number | null, targetId: number): Promise<boolean> {
  return !viewerId || !(await blockedEitherWay(viewerId, targetId));
}

// ---------------------------------------------------------------------------
// Lists for the account pages
// ---------------------------------------------------------------------------
type PersonRow = Row & { id: number; username: string | null; name: string; avatar_path: string | null; city: string | null };
const PERSON_COLS = 'u.id, u.username, u.name, u.avatar_path, u.city';

export async function listFollowers(userId: number): Promise<(PersonCard & { mutual: boolean })[]> {
  const rows = await query<PersonRow & { mutual: number }>(
    `SELECT ${PERSON_COLS}, EXISTS (SELECT 1 FROM user_follows b WHERE b.follower_id = ? AND b.followee_id = u.id AND b.status = 'active') AS mutual
       FROM user_follows f JOIN users u ON u.id = f.follower_id
      WHERE f.followee_id = ? AND f.status = 'active' AND u.status = 'active' AND u.username IS NOT NULL ORDER BY f.created_at DESC LIMIT 500`, [userId, userId],
  );
  return rows.map((r) => ({ ...personCard(r), mutual: !!Number(r.mutual) }));
}

export async function listFollowing(userId: number): Promise<(PersonCard & { pending: boolean; mutual: boolean })[]> {
  const rows = await query<PersonRow & { status: string; mutual: number }>(
    `SELECT ${PERSON_COLS}, f.status, EXISTS (SELECT 1 FROM user_follows b WHERE b.follower_id = u.id AND b.followee_id = ? AND b.status = 'active') AS mutual
       FROM user_follows f JOIN users u ON u.id = f.followee_id
      WHERE f.follower_id = ? AND u.status = 'active' AND u.username IS NOT NULL ORDER BY f.created_at DESC LIMIT 500`, [userId, userId],
  );
  return rows.map((r) => ({ ...personCard(r), pending: r.status === 'pending', mutual: !!Number(r.mutual) }));
}

export async function listFollowRequests(userId: number): Promise<PersonCard[]> {
  const rows = await query<PersonRow>(
    `SELECT ${PERSON_COLS} FROM user_follows f JOIN users u ON u.id = f.follower_id
      WHERE f.followee_id = ? AND f.status = 'pending' AND u.status = 'active' ORDER BY f.created_at DESC LIMIT 200`, [userId],
  );
  return rows.map(personCard);
}

export async function listBlocked(userId: number): Promise<PersonCard[]> {
  const rows = await query<PersonRow>(`SELECT ${PERSON_COLS} FROM user_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC`, [userId]);
  return rows.map(personCard);
}

/** Find friends by name or username (11.6). Only people with a profile; blocks hide both ways. */
export async function searchPeople(q: string, viewerId: number, limit = 30): Promise<(PersonCard & { state: FollowState })[]> {
  const term = q.trim().replace(/^@/, '').slice(0, 60);
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await query<PersonRow & { state: FollowState | null }>(
    `SELECT ${PERSON_COLS}, (SELECT f.status FROM user_follows f WHERE f.follower_id = ? AND f.followee_id = u.id) AS state
       FROM users u
      WHERE u.status = 'active' AND u.username IS NOT NULL AND u.age_confirmed_at IS NOT NULL AND u.id <> ?
        AND (u.username LIKE ? OR u.name LIKE ?) AND ${notBlockedSql('u.id', '?')}
      ORDER BY (u.username = ?) DESC, (u.username LIKE ?) DESC, u.name LIMIT ${Math.max(1, Math.min(100, limit))}`,
    [viewerId, viewerId, like, like, viewerId, term.toLowerCase(), `${term.toLowerCase()}%`],
  );
  return rows.map((r) => ({ ...personCard(r), state: r.state ?? 'none' }));
}

// ---------------------------------------------------------------------------
// Organizer follows (11.5)
// ---------------------------------------------------------------------------
export type OrgFollowInfo = { following: boolean; muted: boolean; count: number | null; signedIn: boolean };

export async function orgFollowInfo(orgId: number, viewerId: number | null, opts: { showCount?: boolean } = {}): Promise<OrgFollowInfo> {
  const [mine, count] = await Promise.all([
    viewerId ? queryOne<Row & { muted: number }>(`SELECT muted FROM org_follows WHERE user_id = ? AND organization_id = ?`, [viewerId, orgId]) : Promise.resolve(null),
    opts.showCount ? queryOne<Row & { n: number; hide: number }>(
      `SELECT (SELECT COUNT(*) FROM org_follows f JOIN users u ON u.id = f.user_id WHERE f.organization_id = ? AND u.status = 'active') AS n,
              (SELECT hide_follower_count FROM organizations WHERE id = ?) AS hide`, [orgId, orgId],
    ) : Promise.resolve(null),
  ]);
  return { following: !!mine, muted: !!Number(mine?.muted), count: count && !Number(count.hide) ? Number(count.n) : null, signedIn: !!viewerId };
}

export async function listFollowedOrgs(userId: number): Promise<(Row & { slug: string; name: string; logo_path: string | null; muted: number; created_at: Date })[]> {
  return query(
    `SELECT o.slug, o.name, o.logo_path, f.muted, f.created_at FROM org_follows f JOIN organizations o ON o.id = f.organization_id
      WHERE f.user_id = ? AND o.status = 'active' ORDER BY o.name`, [userId],
  );
}
