'use server';

import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { saveImageUpload } from '../uploads';
import { rateLimited } from '../security/bot';
import { feedAccess, filterPost, getFeedEvent, listFeed, notifyAlert, notifyReply, REACTIONS, type FeedPost } from './feed';

export type FeedResult = { ok: boolean; error?: string; posts?: FeedPost[] };

async function load(eventId: number) {
  const event = await getFeedEvent(Number(eventId));
  if (!event) return null;
  return { event, access: await feedAccess(event) };
}

/** Reload the feed (after posting, or "Load more" with `before`). */
export async function fetchFeed(eventId: number, before?: number): Promise<FeedResult> {
  const r = await load(eventId);
  if (!r || !r.access.canView) return { ok: false, error: 'You can’t see this feed.' };
  return { ok: true, posts: await listFeed(r.event, r.access.userId, { before }) };
}

/** A post, a reply (parent_id) or, for the organizer's team, an Alert (pinned and sent to ticket holders). */
export async function createPost(fd: FormData): Promise<FeedResult> {
  const r = await load(Number(fd.get('event_id')));
  if (!r) return { ok: false, error: 'Event not found.' };
  const { event, access } = r;
  if (!access.canPost || !access.userId) {
    return { ok: false, error: access.readOnly ? 'This feed is read-only now.' : access.reason === 'profile' ? 'Set up your profile to post.' : 'You can’t post here.' };
  }
  if (rateLimited(`feed-post:${access.userId}`, access.moderator ? 30 : 6, 60_000)) return { ok: false, error: 'You’re posting a lot. Wait a minute and try again.' };
  const filtered = filterPost(String(fd.get('body') ?? ''), { organizer: access.moderator });
  if (!filtered.ok) return { ok: false, error: filtered.error };
  const parentId = Number(fd.get('parent_id')) || null;
  if (parentId) {
    const parent = await queryOne<Row & { event_id: number; parent_id: number | null }>(`SELECT event_id, parent_id FROM event_posts WHERE id = ? AND deleted_at IS NULL`, [parentId]);
    if (!parent || Number(parent.event_id) !== event.id || parent.parent_id) return { ok: false, error: 'That post is gone.' };
  }
  // Same text twice in a row: spam.
  const last = await queryOne<Row & { body: string }>(`SELECT body FROM event_posts WHERE event_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1`, [event.id, access.userId]);
  if (!access.moderator && last?.body === filtered.body) return { ok: false, error: 'You already posted that.' };

  const alert = access.moderator && !parentId && fd.get('alert') === 'on';
  const asOrganizer = access.moderator && fd.get('as_organizer') !== 'off';
  let image: string | null = null;
  const file = fd.get('image');
  if (file instanceof File && file.size > 0 && !parentId) {
    if (!access.moderator && !Number(event.feed_attendee_photos)) return { ok: false, error: 'Only the organizer can add photos here.' };
    try { image = await saveImageUpload(file, 'posts', 1600); } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  await execute(
    `INSERT INTO event_posts (event_id, user_id, parent_id, kind, as_organizer, body, image_path, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.id, access.userId, parentId, alert ? 'alert' : 'post', asOrganizer ? 1 : 0, filtered.body, image, alert ? 1 : 0],
  );
  if (parentId) notifyReply(event, parentId, access.userId);
  if (alert) notifyAlert(event, filtered.body, access.userId);
  return { ok: true, posts: await listFeed(event, access.userId) };
}

export async function deletePost(eventId: number, postId: number): Promise<FeedResult> {
  const r = await load(eventId);
  if (!r || !r.access.userId) return { ok: false, error: 'Please sign in.' };
  const post = await queryOne<Row & { user_id: number | null; event_id: number }>(`SELECT user_id, event_id FROM event_posts WHERE id = ? AND deleted_at IS NULL`, [postId]);
  if (!post || Number(post.event_id) !== r.event.id) return { ok: false, error: 'That post is gone.' };
  const own = Number(post.user_id) === r.access.userId;
  if (!own && !r.access.moderator) return { ok: false, error: 'You can’t delete that.' };
  await execute(`UPDATE event_posts SET deleted_at = NOW(), deleted_by = ? WHERE id = ? OR parent_id = ?`, [r.access.userId, postId, postId]);
  if (!own) await audit('social.post.removed', { actorUserId: r.access.userId, targetType: 'event_post', targetId: postId, metadata: { eventId: r.event.id } });
  return { ok: true, posts: await listFeed(r.event, r.access.userId) };
}

export async function setPinned(eventId: number, postId: number, pinned: boolean): Promise<FeedResult> {
  const r = await load(eventId);
  if (!r?.access.moderator) return { ok: false, error: 'Only the organizer can pin posts.' };
  await execute(`UPDATE event_posts SET pinned = ? WHERE id = ? AND event_id = ? AND parent_id IS NULL`, [pinned ? 1 : 0, postId, r.event.id]);
  return { ok: true, posts: await listFeed(r.event, r.access.userId) };
}

export async function react(eventId: number, postId: number, emoji: string): Promise<FeedResult> {
  const r = await load(eventId);
  if (!r?.access.canView || !r.access.userId || r.access.readOnly || r.access.reason === 'muted') return { ok: false, error: 'You can’t react here.' };
  if (!(REACTIONS as readonly string[]).includes(emoji)) return { ok: false, error: 'Unknown reaction.' };
  if (rateLimited(`feed-react:${r.access.userId}`, 60, 60_000)) return { ok: false, error: 'Slow down a little.' };
  const post = await queryOne<Row & { event_id: number }>(`SELECT event_id FROM event_posts WHERE id = ? AND deleted_at IS NULL`, [postId]);
  if (!post || Number(post.event_id) !== r.event.id) return { ok: false, error: 'That post is gone.' };
  const del = await execute(`DELETE FROM event_post_reactions WHERE post_id = ? AND user_id = ? AND emoji = ?`, [postId, r.access.userId, emoji]);
  if (!del.affectedRows) await execute(`INSERT IGNORE INTO event_post_reactions (post_id, user_id, emoji) VALUES (?, ?, ?)`, [postId, r.access.userId, emoji]);
  return { ok: true, posts: await listFeed(r.event, r.access.userId) };
}

/** The attendee's own switch: stop emails about replies and alerts for this feed. */
export async function setFeedNotificationsMuted(eventId: number, muted: boolean): Promise<FeedResult> {
  const r = await load(eventId);
  if (!r?.access.userId || !r.access.canView) return { ok: false, error: 'Please sign in.' };
  await execute(
    `INSERT INTO event_feed_members (event_id, user_id, notifications_muted) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE notifications_muted = VALUES(notifications_muted)`,
    [r.event.id, r.access.userId, muted ? 1 : 0],
  );
  return { ok: true };
}

/** Organizer moderation: mute (read-only), remove (can't see the feed) or restore a person. Removing also hides their posts. */
export async function moderateMember(eventId: number, userId: number, state: 'ok' | 'muted' | 'removed'): Promise<FeedResult> {
  const r = await load(eventId);
  if (!r?.access.moderator || !r.access.userId) return { ok: false, error: 'Only the organizer can do that.' };
  if (userId === r.access.userId) return { ok: false, error: 'That’s you.' };
  await execute(
    `INSERT INTO event_feed_members (event_id, user_id, state) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE state = VALUES(state)`, [r.event.id, userId, state],
  );
  if (state === 'removed') await execute(`UPDATE event_posts SET deleted_at = NOW(), deleted_by = ? WHERE event_id = ? AND user_id = ? AND deleted_at IS NULL`, [r.access.userId, r.event.id, userId]);
  await audit('social.feed.moderated', { actorUserId: r.access.userId, targetType: 'user', targetId: userId, metadata: { eventId: r.event.id, state } });
  revalidatePath(`/events/${r.event.slug}`);
  return { ok: true, posts: await listFeed(r.event, r.access.userId) };
}
