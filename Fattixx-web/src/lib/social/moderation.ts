'use server';

import { revalidatePath } from 'next/cache';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { env } from '../env';
import { getSession, revokeAllUserSessions } from '../auth/session';
import { assertPlatformRole } from '../auth/guard';
import { assertOrg } from '../authz';
import { rateLimited } from '../security/bot';
import { noticeToStaff, sendNotice } from '../simple-email';
import { deleteUpload } from '../uploads';
import { isEventModerator } from './feed';

/**
 * Reports and moderation (11.11). Anyone signed in can report a post or a profile. A post report goes to the event's
 * organizer (for their feed) and to Fattixx support; a profile report to support. Support can remove content and
 * suspend accounts; organizers can remove posts from their own feeds. Every action is in the audit log (Section 13).
 */
export type ReportState = { ok?: boolean; error?: string; message?: string } | undefined;

export async function reportContent(targetType: 'post' | 'profile', targetId: number, reason: string): Promise<ReportState> {
  const session = await getSession();
  if (!session) return { error: 'Please sign in to report.' };
  const text = reason.trim().slice(0, 500);
  if (text.length < 3) return { error: 'Tell us briefly what’s wrong.' };
  if (rateLimited(`report:${session.user.id}`, 10, 60 * 60_000)) return { error: 'You’ve sent a lot of reports. Try again later.' };
  let eventId: number | null = null, orgId: number | null = null, eventTitle = '', eventSlug = '';
  if (targetType === 'post') {
    const p = await queryOne<Row & { event_id: number; organization_id: number; title: string; slug: string }>(
      `SELECT p.event_id, e.organization_id, e.title, e.slug FROM event_posts p JOIN events e ON e.id = p.event_id WHERE p.id = ? AND p.deleted_at IS NULL`, [targetId],
    );
    if (!p) return { error: 'That post is gone.' };
    eventId = Number(p.event_id); orgId = Number(p.organization_id); eventTitle = p.title; eventSlug = p.slug;
  } else {
    const u = await queryOne(`SELECT 1 FROM users WHERE id = ? AND username IS NOT NULL`, [targetId]);
    if (!u) return { error: 'That profile is gone.' };
  }
  const dup = await queryOne(`SELECT 1 FROM content_reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'`, [session.user.id, targetType, targetId]);
  if (dup) return { ok: true, message: 'Thanks, we already have your report.' };
  const r = await execute(
    `INSERT INTO content_reports (reporter_id, target_type, target_id, event_id, organization_id, reason) VALUES (?, ?, ?, ?, ?, ?)`,
    [session.user.id, targetType, targetId, eventId, orgId, text],
  );
  await audit('social.report.created', { actorUserId: session.user.id, targetType: `report_${targetType}`, targetId, metadata: { reportId: r.insertId } });
  await noticeToStaff(`New ${targetType} report`, [`A ${targetType} was reported${eventTitle ? ` in the ${eventTitle} feed` : ''}.`, `Reason: ${text}`],
    { href: `${env.ADMIN_URL}/admin/reports`, label: 'Open reports' }, ['super_admin', 'support']);
  if (orgId) {
    const admins = await query<Row & { email: string; name: string }>(
      `SELECT u.email, u.name FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.role = 'org_admin' AND u.status = 'active'`, [orgId],
    );
    const slug = await queryOne<Row & { slug: string }>(`SELECT slug FROM organizations WHERE id = ?`, [orgId]);
    for (const a of admins) {
      await sendNotice({ email: a.email, name: a.name }, `A post was reported in ${eventTitle}`, [`Someone reported a post in your event feed for ${eventTitle}.`, `Reason: ${text}`],
        { href: `${env.APP_URL}/org/${slug?.slug}/audience?tab=reports`, label: 'Review reports' });
    }
    void eventSlug;
  }
  return { ok: true, message: 'Thanks. We’ll take a look.' };
}

export type ReportRow = Row & {
  id: number; target_type: 'post' | 'profile'; target_id: number; event_id: number | null; organization_id: number | null; reason: string; status: string;
  created_at: Date; reporter_name: string | null; post_body: string | null; post_author_id: number | null; post_author: string | null;
  profile_username: string | null; profile_name: string | null; event_title: string | null; event_slug: string | null; resolution: string | null;
};

const REPORT_SELECT = `SELECT r.*, ru.name AS reporter_name, p.body AS post_body, p.user_id AS post_author_id, pu.name AS post_author,
    tu.username AS profile_username, tu.name AS profile_name, e.title AS event_title, e.slug AS event_slug
  FROM content_reports r
  LEFT JOIN users ru ON ru.id = r.reporter_id
  LEFT JOIN event_posts p ON r.target_type = 'post' AND p.id = r.target_id
  LEFT JOIN users pu ON pu.id = p.user_id
  LEFT JOIN users tu ON r.target_type = 'profile' AND tu.id = r.target_id
  LEFT JOIN events e ON e.id = r.event_id`;

export async function listReportsForStaff(status: 'open' | 'all' = 'open'): Promise<ReportRow[]> {
  await assertPlatformRole(['super_admin', 'support']);
  return query<ReportRow>(`${REPORT_SELECT} ${status === 'open' ? "WHERE r.status = 'open'" : ''} ORDER BY r.status = 'open' DESC, r.id DESC LIMIT 300`);
}

export async function listReportsForOrg(orgSlug: string): Promise<ReportRow[]> {
  const ctx = await assertOrg(orgSlug, 'organizer');
  return query<ReportRow>(`${REPORT_SELECT} WHERE r.organization_id = ? AND r.target_type = 'post' ORDER BY r.status = 'open' DESC, r.id DESC LIMIT 200`, [ctx.org.id]);
}

async function closeReport(id: number, status: 'resolved' | 'dismissed', userId: number, resolution: string) {
  await execute(`UPDATE content_reports SET status = ?, resolved_by = ?, resolved_at = NOW(), resolution = ? WHERE id = ?`, [status, userId, resolution.slice(0, 200), id]);
  await audit('social.report.resolved', { actorUserId: userId, targetType: 'content_report', targetId: id, metadata: { status, resolution } });
}

/** The organizer's team on a post report in their own feed: remove the post or dismiss. */
export async function resolveOrgReport(orgSlug: string, reportId: number, action: 'remove' | 'dismiss'): Promise<ReportState> {
  const ctx = await assertOrg(orgSlug, 'organizer');
  const r = await queryOne<Row & { target_id: number; event_id: number; organization_id: number }>(
    `SELECT target_id, event_id, organization_id FROM content_reports WHERE id = ? AND target_type = 'post'`, [reportId],
  );
  if (!r || Number(r.organization_id) !== ctx.org.id) return { error: 'Report not found.' };
  if (!(await isEventModerator(ctx.session.user.id, ctx.session.user.roles, { id: Number(r.event_id), organization_id: ctx.org.id }))) return { error: 'You don’t manage that event.' };
  if (action === 'remove') {
    await execute(`UPDATE event_posts SET deleted_at = NOW(), deleted_by = ? WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL`, [ctx.session.user.id, r.target_id, r.target_id]);
    await audit('social.post.removed', { actorUserId: ctx.session.user.id, targetType: 'event_post', targetId: r.target_id, metadata: { reportId } });
  }
  await execute(`UPDATE content_reports SET status = ?, resolved_by = ?, resolved_at = NOW(), resolution = ? WHERE target_type = 'post' AND target_id = ? AND status = 'open'`,
    [action === 'remove' ? 'resolved' : 'dismissed', ctx.session.user.id, action === 'remove' ? 'Post removed by the organizer' : 'Dismissed by the organizer', r.target_id]);
  await audit('social.report.resolved', { actorUserId: ctx.session.user.id, targetType: 'content_report', targetId: reportId, metadata: { action } });
  revalidatePath(`/org/${orgSlug}/audience`);
  return { ok: true };
}

/**
 * Fattixx support: remove the reported content (post, or the profile's photo, bio and links), suspend the account
 * (signs them out everywhere), or dismiss the report.
 */
export async function resolveStaffReport(reportId: number, action: 'remove' | 'suspend' | 'dismiss'): Promise<ReportState> {
  const session = await assertPlatformRole(['super_admin', 'support']);
  const r = await queryOne<Row & { target_type: 'post' | 'profile'; target_id: number }>(`SELECT target_type, target_id FROM content_reports WHERE id = ?`, [reportId]);
  if (!r) return { error: 'Report not found.' };
  if (action === 'dismiss') {
    await closeReport(reportId, 'dismissed', session.user.id, 'Dismissed by support');
    return { ok: true };
  }
  const post = r.target_type === 'post' ? await queryOne<Row & { user_id: number | null }>(`SELECT user_id FROM event_posts WHERE id = ?`, [r.target_id]) : null;
  const userId = r.target_type === 'profile' ? Number(r.target_id) : post?.user_id != null ? Number(post.user_id) : null;
  if (action === 'remove') {
    if (r.target_type === 'post') {
      await execute(`UPDATE event_posts SET deleted_at = NOW(), deleted_by = ? WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL`, [session.user.id, r.target_id, r.target_id]);
      await audit('social.post.removed', { actorUserId: session.user.id, targetType: 'event_post', targetId: r.target_id, metadata: { reportId } });
    } else {
      const u = await queryOne<Row & { avatar_path: string | null }>(`SELECT avatar_path FROM users WHERE id = ?`, [r.target_id]);
      await execute(`UPDATE users SET avatar_path = NULL, bio = NULL, instagram = NULL, tiktok = NULL, x_handle = NULL, city = NULL WHERE id = ?`, [r.target_id]);
      if (u?.avatar_path) await deleteUpload(u.avatar_path);
      await audit('social.profile.removed', { actorUserId: session.user.id, targetType: 'user', targetId: r.target_id, metadata: { reportId } });
    }
    await execute(`UPDATE content_reports SET status = 'resolved', resolved_by = ?, resolved_at = NOW(), resolution = 'Content removed by support' WHERE target_type = ? AND target_id = ? AND status = 'open'`,
      [session.user.id, r.target_type, r.target_id]);
    return { ok: true };
  }
  if (!userId) return { error: 'There is no account to suspend for this report.' };
  const staff = await queryOne(`SELECT 1 FROM user_platform_roles WHERE user_id = ?`, [userId]);
  if (staff) return { error: 'Platform staff accounts can’t be suspended here.' };
  await execute(`UPDATE users SET status = 'suspended' WHERE id = ?`, [userId]);
  await revokeAllUserSessions(userId, 'suspended_by_support');
  await audit('user.status.changed', { actorUserId: session.user.id, targetType: 'user', targetId: userId, metadata: { status: 'suspended', reportId } });
  await closeReport(reportId, 'resolved', session.user.id, 'Account suspended by support');
  return { ok: true };
}
