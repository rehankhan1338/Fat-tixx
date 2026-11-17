import 'server-only';
import { after } from 'next/server';
import { execute, query, queryOne, type Row } from '../db';
import { env } from '../env';
import { sendNotice } from '../simple-email';
import { uploadUrl } from '../uploads';
import { getSession } from '../auth/session';
import { getSocialUser, hasProfile, holdsTicket, holdsTicketSql, initials, placeholders } from './core';

/**
 * Event activity feed (11.7). Off by default; the organizer turns it on per event. Signed-in ticket holders and RSVP
 * guests can read it; posting needs a profile (the post shows the person's name and photo). The organizer's team posts
 * updates, and "Alert" posts are pinned. Event updates sent by email (date / time / place changes, organizer broadcasts)
 * are copied in automatically. `feed_open_days` after the event the feed turns read-only.
 */

export type FeedEvent = Row & {
  id: number; organization_id: number; slug: string; title: string; status: string; feed_enabled: number; feed_attendee_photos: number;
  feed_open_days: number; starts_at: Date; ends_at: Date | null; org_name: string; org_logo: string | null;
};

export async function getFeedEvent(eventId: number): Promise<FeedEvent | null> {
  return queryOne<FeedEvent>(
    `SELECT e.id, e.organization_id, e.slug, e.title, e.status, e.feed_enabled, e.feed_attendee_photos, e.feed_open_days, e.starts_at, e.ends_at,
            o.name AS org_name, o.logo_path AS org_logo
       FROM events e JOIN organizations o ON o.id = e.organization_id WHERE e.id = ?`, [eventId],
  );
}

export type FeedAccess = {
  canView: boolean;
  canPost: boolean;
  /** the organizer's team (Organizer or Organization Admin) or platform staff: post as the organizer, pin, delete, mute, remove */
  moderator: boolean;
  readOnly: boolean;
  /** why the viewer can't take part, for the empty state */
  reason: 'off' | 'signin' | 'holders' | 'profile' | 'removed' | 'muted' | null;
  userId: number | null;
  notificationsMuted: boolean;
};

/** End of the event, then the feed stays open `feed_open_days`. */
export function feedClosesAt(e: Pick<FeedEvent, 'starts_at' | 'ends_at' | 'feed_open_days'>): Date {
  const end = e.ends_at ? new Date(e.ends_at) : new Date(new Date(e.starts_at).getTime() + 6 * 3_600_000);
  return new Date(end.getTime() + Number(e.feed_open_days) * 86_400_000);
}

export async function isEventModerator(userId: number, roles: string[], event: Pick<FeedEvent, 'organization_id' | 'id'>): Promise<boolean> {
  if (roles.includes('super_admin') || roles.includes('support')) return true;
  const m = await queryOne<Row & { role: string; all_events: number }>(
    `SELECT role, all_events FROM organization_members WHERE organization_id = ? AND user_id = ?`, [event.organization_id, userId],
  );
  if (!m || m.role === 'staff') return false;
  if (m.role === 'org_admin' || Number(m.all_events)) return true;
  return !!(await queryOne(
    `SELECT 1 FROM events e WHERE e.id = ? AND (e.created_by = ? OR EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = ?))`,
    [event.id, userId, userId],
  ));
}

export async function feedAccess(event: FeedEvent): Promise<FeedAccess> {
  const base: FeedAccess = { canView: false, canPost: false, moderator: false, readOnly: false, reason: null, userId: null, notificationsMuted: false };
  if (!Number(event.feed_enabled)) return { ...base, reason: 'off' };
  const readOnly = Date.now() > feedClosesAt(event).getTime() || event.status === 'cancelled';
  const session = await getSession();
  if (!session) return { ...base, readOnly, reason: 'signin' };
  const userId = session.user.id;
  if (await isEventModerator(userId, session.user.roles, event)) {
    return { ...base, canView: true, canPost: !readOnly, moderator: true, readOnly, userId };
  }
  if (!(await holdsTicket(userId, event.id))) return { ...base, readOnly, reason: 'holders', userId };
  const member = await queryOne<Row & { state: string; notifications_muted: number }>(
    `SELECT state, notifications_muted FROM event_feed_members WHERE event_id = ? AND user_id = ?`, [event.id, userId],
  );
  if (member?.state === 'removed') return { ...base, readOnly, reason: 'removed', userId };
  const me = await getSocialUser(userId);
  const muted = member?.state === 'muted';
  const profile = hasProfile(me);
  return {
    ...base, canView: true, readOnly, userId, notificationsMuted: !!Number(member?.notifications_muted),
    canPost: !readOnly && !muted && profile,
    reason: muted ? 'muted' : profile ? null : 'profile',
  };
}

export type FeedPost = {
  id: number; kind: 'post' | 'alert' | 'update'; body: string; image: string | null; pinned: boolean; createdAt: string;
  author: { id: number | null; name: string; username: string | null; avatar: string | null; initials: string; organizer: boolean };
  reactions: { emoji: string; count: number; mine: boolean }[];
  replies: FeedPost[];
  mine: boolean;
};

export const REACTIONS = ['❤️', '🔥', '🙌', '😂', '😮', '👍'] as const;

type PostRow = Row & {
  id: number; parent_id: number | null; kind: FeedPost['kind']; as_organizer: number; body: string; image_path: string | null; pinned: number; created_at: Date;
  user_id: number | null; name: string | null; username: string | null; avatar_path: string | null;
};

/** The feed for a viewer who may see it: pinned alerts first, then newest; replies oldest first. Blocked people are hidden both ways. */
export async function listFeed(event: FeedEvent, viewerId: number | null, opts: { limit?: number; before?: number } = {}): Promise<FeedPost[]> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 30));
  const block = viewerId
    ? ` AND (p.user_id IS NULL OR p.as_organizer = 1 OR NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE (ub.blocker_id = ? AND ub.blocked_id = p.user_id) OR (ub.blocker_id = p.user_id AND ub.blocked_id = ?)))`
    : '';
  const blockParams = viewerId ? [viewerId, viewerId] : [];
  const cols = `p.id, p.parent_id, p.kind, p.as_organizer, p.body, p.image_path, p.pinned, p.created_at, p.user_id, u.name, u.username, u.avatar_path`;
  const top = await query<PostRow>(
    `SELECT ${cols} FROM event_posts p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.event_id = ? AND p.parent_id IS NULL AND p.deleted_at IS NULL ${opts.before ? 'AND p.id < ?' : ''}${block}
      ORDER BY p.pinned DESC, p.id DESC LIMIT ${limit}`,
    [event.id, ...(opts.before ? [opts.before] : []), ...blockParams],
  );
  if (!top.length) return [];
  const ids = top.map((p) => Number(p.id));
  const replies = await query<PostRow>(
    `SELECT ${cols} FROM event_posts p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.parent_id IN (${placeholders(ids)}) AND p.deleted_at IS NULL${block} ORDER BY p.id LIMIT 2000`,
    [...ids, ...blockParams],
  );
  const all = [...ids, ...replies.map((r) => Number(r.id))];
  const reacts = await query<Row & { post_id: number; emoji: string; n: number; mine: number }>(
    `SELECT post_id, emoji, COUNT(*) AS n, SUM(user_id = ?) AS mine FROM event_post_reactions WHERE post_id IN (${placeholders(all)}) GROUP BY post_id, emoji`,
    [viewerId ?? 0, ...all],
  );
  const view = (p: PostRow): FeedPost => {
    const organizer = !!Number(p.as_organizer) || p.user_id == null;
    const name = organizer ? event.org_name : (p.name ?? 'Former member');
    return {
      id: Number(p.id), kind: p.kind, body: p.body, image: uploadUrl(p.image_path), pinned: !!Number(p.pinned), createdAt: new Date(p.created_at).toISOString(),
      author: {
        id: organizer ? null : p.user_id == null ? null : Number(p.user_id), name, username: organizer ? null : p.username,
        avatar: organizer ? uploadUrl(event.org_logo) : uploadUrl(p.avatar_path), initials: initials(name), organizer,
      },
      reactions: reacts.filter((r) => Number(r.post_id) === Number(p.id)).map((r) => ({ emoji: r.emoji, count: Number(r.n), mine: Number(r.mine) > 0 })),
      replies: [],
      mine: viewerId != null && Number(p.user_id) === viewerId,
    };
  };
  const out = top.map(view);
  const byId = new Map(out.map((p) => [p.id, p]));
  for (const r of replies) byId.get(Number(r.parent_id))?.replies.push(view(r));
  return out;
}

// ---------------------------------------------------------------------------
// Automatic filtering (11.11): links, spam and profanity in attendee posts.
// ---------------------------------------------------------------------------
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|ly|gg|me|xyz|link|app|info|biz|ru|tk)\b)/i;
// A short list on purpose: blocks the obvious slurs and insults, masks common swearing.
const BLOCKED_WORDS = ['nigger', 'nigga', 'faggot', 'fag', 'retard', 'kike', 'spic', 'chink', 'tranny', 'wetback'];
const MASKED_WORDS = ['fuck', 'fucking', 'shit', 'bitch', 'cunt', 'asshole', 'dick', 'pussy', 'motherfucker', 'bastard'];

export type FilterResult = { ok: true; body: string } | { ok: false; error: string };

export function filterPost(raw: string, opts: { organizer: boolean }): FilterResult {
  const body = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (body.length < 1) return { ok: false, error: 'Write something first.' };
  if (body.length > 2000) return { ok: false, error: 'Keep posts to 2,000 characters.' };
  if (opts.organizer) return { ok: true, body };
  const lower = body.toLowerCase();
  if (LINK_RE.test(body)) return { ok: false, error: 'Links aren’t allowed in posts.' };
  if (BLOCKED_WORDS.some((w) => new RegExp(`\\b${w}s?\\b`, 'i').test(lower))) return { ok: false, error: 'That post breaks the community rules.' };
  if (/(.)\1{9,}/.test(body) || (body.length > 30 && body.replace(/[^A-Z]/g, '').length / body.replace(/[^A-Za-z]/g, '').length > 0.8)) {
    return { ok: false, error: 'That looks like spam. Try writing it differently.' };
  }
  let out = body;
  for (const w of MASKED_WORDS) out = out.replace(new RegExp(`\\b${w}\\b`, 'gi'), (m) => m[0] + '*'.repeat(m.length - 1));
  return { ok: true, body: out };
}

// ---------------------------------------------------------------------------
// Notifications: replies to my posts, organizer alerts. Sent after the response.
// ---------------------------------------------------------------------------
function later(fn: () => Promise<unknown>) {
  const run = () => fn().catch((e) => console.error('[feed] notification failed', e));
  try { after(run); } catch { void run(); }
}

export function notifyReply(event: FeedEvent, parentId: number, replierId: number) {
  later(async () => {
    const parent = await queryOne<Row & { user_id: number | null; as_organizer: number; email: string; name: string; muted: number | null }>(
      `SELECT p.user_id, p.as_organizer, u.email, u.name,
              (SELECT m.notifications_muted FROM event_feed_members m WHERE m.event_id = p.event_id AND m.user_id = p.user_id) AS muted
         FROM event_posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.deleted_at IS NULL AND u.status = 'active'`, [parentId],
    );
    if (!parent || parent.user_id == null || Number(parent.user_id) === replierId || Number(parent.muted) || Number(parent.as_organizer)) return;
    const replier = await getSocialUser(replierId);
    await sendNotice({ email: parent.email, name: parent.name }, `New reply in ${event.title}`,
      [`${replier?.name ?? 'Someone'} replied to your post in the ${event.title} feed.`, 'Mute the feed from the event page if you’d rather not get these.'],
      { href: `${env.APP_URL}/events/${event.slug}#feed`, label: 'See the reply' }, { type: 'event', id: event.id });
  });
}

/** An organizer alert goes to every ticket holder with an account who hasn't muted the feed. */
export function notifyAlert(event: FeedEvent, body: string, authorId: number) {
  later(async () => {
    const people = await query<Row & { id: number; email: string; name: string }>(
      `SELECT u.id, u.email, u.name FROM users u
        WHERE u.status = 'active' AND u.id <> ? AND ${holdsTicketSql('u')}
          AND NOT EXISTS (SELECT 1 FROM event_feed_members m WHERE m.event_id = ? AND m.user_id = u.id AND (m.notifications_muted = 1 OR m.state = 'removed'))`,
      [authorId, event.id, event.id, event.id],
    );
    const short = body.length > 400 ? `${body.slice(0, 400)}…` : body;
    for (const p of people) {
      await sendNotice({ email: p.email, name: p.name }, `Alert from ${event.org_name}: ${event.title}`, [short],
        { href: `${env.APP_URL}/events/${event.slug}#feed`, label: 'Open the event feed' }, { type: 'event', id: event.id });
    }
  });
}

/** Event updates sent by email (Section 9) also appear in the feed, when it is on. */
export async function postEventUpdate(eventId: number, body: string): Promise<void> {
  const text = body.trim().slice(0, 2000);
  if (!text) return;
  await execute(
    `INSERT INTO event_posts (event_id, user_id, kind, as_organizer, body) SELECT id, NULL, 'update', 1, ? FROM events WHERE id = ? AND feed_enabled = 1`,
    [text, eventId],
  );
}
