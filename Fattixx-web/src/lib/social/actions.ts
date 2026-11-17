'use server';

import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { getSession } from '../auth/session';
import { audit } from '../audit';
import { deleteUpload, saveImageUpload } from '../uploads';
import { rateLimited } from '../security/bot';
import { listCategories } from '../site-content/categories';
import {
  blockedEitherWay, getSocialUser, hasProfile, holdsTicket, normalizeHandle, normalizeUsername, usernameProblem,
} from './core';

export type SocialState = { error?: string; ok?: boolean; message?: string; field?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);
const on = (fd: FormData, k: string) => fd.get(k) === 'on' || fd.get(k) === '1' || fd.get(k) === 'true';

async function signedIn() {
  const session = await getSession();
  if (!session) throw new Error('Please sign in.');
  return session;
}

/** Profile (11.3): username, name, photo, bio, city, social handles, favorite categories, the 18+ confirmation. */
export async function saveProfile(_prev: SocialState, fd: FormData): Promise<SocialState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in again.' };
  const me = await getSocialUser(session.user.id);
  if (!me) return { error: 'Account not found.' };

  const username = normalizeUsername(str(fd, 'username', 40));
  const problem = usernameProblem(username);
  if (problem) return { error: problem, field: 'username' };
  if (username !== me.username) {
    const taken = await queryOne(`SELECT 1 FROM users WHERE username = ? AND id <> ?`, [username, me.id]);
    if (taken) return { error: 'That username is taken.', field: 'username' };
  }
  const name = str(fd, 'name', 120);
  if (name.length < 2) return { error: 'Add your name.', field: 'name' };
  const bio = str(fd, 'bio', 400);
  if (bio.length > 160) return { error: 'Keep your bio to 160 characters.', field: 'bio' };
  const handles = { instagram: str(fd, 'instagram', 120), tiktok: str(fd, 'tiktok', 120), x: str(fd, 'x', 120) };
  const parsed = { instagram: normalizeHandle(handles.instagram), tiktok: normalizeHandle(handles.tiktok), x: normalizeHandle(handles.x) };
  for (const k of ['instagram', 'tiktok', 'x'] as const) if (handles[k] && !parsed[k]) return { error: `That ${k === 'x' ? 'X' : k === 'tiktok' ? 'TikTok' : 'Instagram'} handle doesn’t look right.`, field: k };
  const adult = me.age_confirmed_at != null || on(fd, 'adult');
  if (!adult) return { error: 'Profiles are for people 18 or older. Confirm your age to continue.', field: 'adult' };
  const known = new Set((await listCategories()).map((c) => c.name));
  const categories = fd.getAll('categories').map(String).filter((c) => known.has(c)).slice(0, 12);

  let avatar = me.avatar_path;
  const file = fd.get('avatar');
  if (file instanceof File && file.size > 0) {
    try { avatar = await saveImageUpload(file, 'avatars', 512); } catch (e) { return { error: (e as Error).message, field: 'avatar' }; }
  } else if (on(fd, 'remove_avatar')) avatar = null;

  await execute(
    `UPDATE users SET username = ?, name = ?, bio = ?, city = ?, instagram = ?, tiktok = ?, x_handle = ?, avatar_path = ?, favorite_categories = ?,
            age_confirmed_at = COALESCE(age_confirmed_at, NOW()) WHERE id = ?`,
    [username, name, bio || null, str(fd, 'city', 120) || null, parsed.instagram, parsed.tiktok, parsed.x, avatar, categories.join(',') || null, me.id],
  );
  if (avatar !== me.avatar_path && me.avatar_path) await deleteUpload(me.avatar_path);
  await audit('user.updated', { actorUserId: me.id, targetType: 'user', targetId: me.id, metadata: { profile: true } });
  revalidatePath(`/u/${username}`);
  return { ok: true, message: 'Profile saved.' };
}

/** Privacy settings (11.11). */
export async function savePrivacy(_prev: SocialState, fd: FormData): Promise<SocialState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in again.' };
  const me = await getSocialUser(session.user.id);
  if (!me) return { error: 'Account not found.' };
  const approval = str(fd, 'who_can_follow', 10) === 'approved' ? 1 : 0;
  await execute(
    `UPDATE users SET profile_public = ?, show_on_guest_lists = ?, show_events_on_profile = ?, follow_approval = ?, marketing_opt_in = ?, social_sms_opt_in = ? WHERE id = ?`,
    [on(fd, 'profile_public') ? 1 : 0, on(fd, 'show_on_guest_lists') ? 1 : 0, on(fd, 'show_events_on_profile') ? 1 : 0, approval, on(fd, 'marketing') ? 1 : 0, on(fd, 'social_sms') ? 1 : 0, me.id],
  );
  // Switching to "anyone can follow" approves the people who were waiting.
  if (!approval && me.follow_approval) await execute(`UPDATE user_follows SET status = 'active' WHERE followee_id = ? AND status = 'pending'`, [me.id]);
  await audit('user.updated', { actorUserId: me.id, targetType: 'user', targetId: me.id, metadata: { privacy: true } });
  if (me.username) revalidatePath(`/u/${me.username}`);
  return { ok: true, message: 'Privacy settings saved.' };
}

// ---------------------------------------------------------------------------
// Following organizers (11.5): needs an account, not a profile.
// ---------------------------------------------------------------------------
export async function setOrgFollow(orgSlug: string, follow: boolean, source = 'page'): Promise<{ ok: boolean; following: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, following: false, error: 'signin' };
  if (rateLimited(`org-follow:${session.user.id}`, 60, 60_000)) return { ok: false, following: !follow, error: 'Too many changes. Try again in a minute.' };
  const org = await queryOne<Row & { id: number }>(`SELECT id FROM organizations WHERE slug = ? AND status = 'active'`, [orgSlug]);
  if (!org) return { ok: false, following: false, error: 'Organizer not found.' };
  if (follow) {
    await execute(`INSERT IGNORE INTO org_follows (user_id, organization_id, source) VALUES (?, ?, ?)`, [session.user.id, org.id, source.slice(0, 20)]);
  } else {
    await execute(`DELETE FROM org_follows WHERE user_id = ? AND organization_id = ?`, [session.user.id, org.id]);
  }
  return { ok: true, following: follow };
}

export async function setOrgMuted(orgSlug: string, muted: boolean): Promise<{ ok: boolean }> {
  const session = await signedIn();
  await execute(
    `UPDATE org_follows f JOIN organizations o ON o.id = f.organization_id SET f.muted = ? WHERE f.user_id = ? AND o.slug = ?`, [muted ? 1 : 0, session.user.id, orgSlug],
  );
  revalidatePath('/account/following');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Following attendees (11.6)
// ---------------------------------------------------------------------------
async function socialMe() {
  const session = await getSession();
  if (!session) return { error: 'signin' as const };
  const me = await getSocialUser(session.user.id);
  if (!hasProfile(me)) return { error: 'profile' as const };
  return { me };
}

export async function followUser(targetId: number): Promise<{ ok: boolean; state?: 'active' | 'pending'; error?: string }> {
  const r = await socialMe();
  if ('error' in r) return { ok: false, error: r.error };
  const { me } = r;
  if (targetId === me.id) return { ok: false, error: 'That’s you.' };
  if (rateLimited(`user-follow:${me.id}`, 100, 60 * 60_000)) return { ok: false, error: 'Too many follows in a short time. Try again later.' };
  const target = await getSocialUser(targetId);
  if (!hasProfile(target) || (await blockedEitherWay(me.id, target.id))) return { ok: false, error: 'This profile isn’t available.' };
  const state = target.follow_approval ? 'pending' : 'active';
  await execute(`INSERT INTO user_follows (follower_id, followee_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = IF(status = 'active', 'active', VALUES(status))`, [me.id, target.id, state]);
  revalidatePath(`/u/${target.username}`);
  return { ok: true, state };
}

export async function unfollowUser(targetId: number): Promise<{ ok: boolean }> {
  const session = await signedIn();
  await execute(`DELETE FROM user_follows WHERE follower_id = ? AND followee_id = ?`, [session.user.id, targetId]);
  revalidatePath('/account/friends');
  return { ok: true };
}

/** Approve or decline a follow request; also removes an existing follower. */
export async function answerFollowRequest(followerId: number, approve: boolean): Promise<{ ok: boolean }> {
  const session = await signedIn();
  if (approve) await execute(`UPDATE user_follows SET status = 'active' WHERE follower_id = ? AND followee_id = ? AND status = 'pending'`, [followerId, session.user.id]);
  else await execute(`DELETE FROM user_follows WHERE follower_id = ? AND followee_id = ?`, [followerId, session.user.id]);
  revalidatePath('/account/friends');
  return { ok: true };
}

/** Blocking (11.11): stops them seeing my profile and posts or following me; follows both ways are removed. */
export async function setBlocked(targetId: number, block: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await signedIn();
  if (targetId === session.user.id) return { ok: false, error: 'That’s you.' };
  if (block) {
    await execute(`INSERT IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)`, [session.user.id, targetId]);
    await execute(`DELETE FROM user_follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)`, [session.user.id, targetId, targetId, session.user.id]);
  } else {
    await execute(`DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`, [session.user.id, targetId]);
  }
  revalidatePath('/account/friends');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Who's Going (11.4): the attendee's choice for one event.
// ---------------------------------------------------------------------------
export async function setGuestListChoice(eventId: number, visible: boolean): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'signin' };
  const me = await getSocialUser(session.user.id);
  if (visible && !hasProfile(me)) return { ok: false, error: 'profile' };
  if (!(await holdsTicket(session.user.id, eventId))) return { ok: false, error: 'Only ticket holders can choose this.' };
  await execute(
    `INSERT INTO event_guest_prefs (event_id, user_id, visible) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE visible = VALUES(visible)`,
    [eventId, session.user.id, visible ? 1 : 0],
  );
  return { ok: true };
}
