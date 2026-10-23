'use server';

import { revalidatePath } from 'next/cache';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertPlatformRole } from '../auth/guard';
import { assertOrg } from '../authz';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { env } from '../env';
import { orgIsPro } from './gate';
import { getSupportRequest, SUPPORT_CATEGORIES, SUPPORT_STATUSES, type SupportStatus } from './support';

/** Support requests: organizers open and reply; Support staff and Super Admins answer, assign and resolve. */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);

async function staffRecipients(): Promise<{ email: string; name: string }[]> {
  return query<Row & { email: string; name: string }>(
    `SELECT DISTINCT u.email, u.name FROM users u JOIN user_platform_roles r ON r.user_id = u.id WHERE r.role IN ('support','super_admin') AND u.status = 'active'`,
  );
}

export async function openSupportRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const subject = str(fd, 'subject', 200), body = str(fd, 'body', 10_000);
  const category = SUPPORT_CATEGORIES.some((c) => c.value === str(fd, 'category', 20)) ? str(fd, 'category', 20) : 'other';
  if (subject.length < 4) return { error: 'Add a short subject.' };
  if (body.length < 10) return { error: 'Tell us a little more so we can help.' };
  const recent = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM support_requests WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 HOUR`, [ctx.session.user.id]);
  if (Number(recent?.n) >= 10) return { error: 'You have opened many requests in the last hour. Please add to an existing one.' };
  const priority = orgIsPro(ctx.org) ? 'priority' : 'normal';
  const r = await execute(
    `INSERT INTO support_requests (organization_id, user_id, email, name, category, subject, priority) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [ctx.org.id, ctx.session.user.id, ctx.session.user.email, ctx.session.user.name, category, subject, priority],
  );
  await execute(`INSERT INTO support_messages (request_id, author_user_id, from_staff, body) VALUES (?, ?, 0, ?)`, [r.insertId, ctx.session.user.id, body]);
  await audit('support.request.created', { actorUserId: ctx.session.user.id, targetType: 'support_request', targetId: r.insertId, metadata: { org: ctx.org.id, priority } });
  try {
    const mail = await renderEmail('support_request_staff', {
      priority: priority === 'priority' ? 'Priority' : 'Normal', org_name: ctx.org.name, requester: `${ctx.session.user.name} <${ctx.session.user.email}>`,
      category, subject, message: body.slice(0, 2000), url: `${env.ADMIN_URL}/admin/support/${r.insertId}`,
    });
    for (const s of await staffRecipients()) await sendEmail({ to: s.email, toName: s.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'support_request', id: r.insertId } });
  } catch (e) { console.error('[support] staff alert failed', e); }
  revalidatePath(`/org/${ctx.org.slug}/support`);
  return { ok: true, message: priority === 'priority' ? 'Sent. As a Pro organizer you are at the front of the queue.' : 'Sent. We will get back to you by email.' };
}

/** The organizer adds to their own request (reopens it if it was resolved). */
export async function replySupportAsOrganizer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const req = await getSupportRequest(Number(fd.get('request_id')));
  if (!req || Number(req.organization_id) !== ctx.org.id) return { error: 'Request not found.' };
  const body = str(fd, 'body', 10_000);
  if (body.length < 2) return { error: 'Write a message.' };
  await execute(`INSERT INTO support_messages (request_id, author_user_id, from_staff, body) VALUES (?, ?, 0, ?)`, [req.id, ctx.session.user.id, body]);
  await execute(`UPDATE support_requests SET status = IF(status IN ('waiting','resolved'), 'open', status), resolved_at = NULL WHERE id = ?`, [req.id]);
  await audit('support.request.replied', { actorUserId: ctx.session.user.id, targetType: 'support_request', targetId: req.id, metadata: { staff: false } });
  revalidatePath(`/org/${ctx.org.slug}/support`);
  return { ok: true, message: 'Added.' };
}

/** Staff reply: emailed to the requester; the first one stops the response-time clock. */
export async function replySupportAsStaff(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole(['super_admin', 'support']);
  const req = await getSupportRequest(Number(fd.get('request_id')));
  if (!req) return { error: 'Request not found.' };
  const body = str(fd, 'body', 10_000);
  if (body.length < 2) return { error: 'Write a reply.' };
  const status = (SUPPORT_STATUSES as readonly string[]).includes(str(fd, 'status', 20)) ? (str(fd, 'status', 20) as SupportStatus) : 'waiting';
  await execute(`INSERT INTO support_messages (request_id, author_user_id, from_staff, body) VALUES (?, ?, 1, ?)`, [req.id, session.user.id, body]);
  await execute(
    `UPDATE support_requests SET status = ?, first_response_at = COALESCE(first_response_at, NOW()), assigned_to = COALESCE(assigned_to, ?), resolved_at = IF(? = 'resolved', NOW(), NULL) WHERE id = ?`,
    [status, session.user.id, status, req.id],
  );
  try {
    const mail = await renderEmail('support_reply', {
      name: req.name ?? 'there', subject: req.subject, message: body.slice(0, 5000),
      url: req.org_slug ? `${env.APP_URL}/org/${req.org_slug}/support?request=${req.id}` : `${env.APP_URL}/dashboard`,
    });
    await sendEmail({ to: req.email, toName: req.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'support_request', id: req.id } });
  } catch (e) { console.error('[support] reply email failed', e); }
  await audit('support.request.replied', { actorUserId: session.user.id, targetType: 'support_request', targetId: req.id, metadata: { staff: true, status } });
  revalidatePath('/admin/support', 'layout');
  return { ok: true, message: 'Reply sent.' };
}

export async function updateSupportRequest(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole(['super_admin', 'support']);
  const req = await getSupportRequest(Number(fd.get('request_id')));
  if (!req) return { error: 'Request not found.' };
  const status = (SUPPORT_STATUSES as readonly string[]).includes(str(fd, 'status', 20)) ? (str(fd, 'status', 20) as SupportStatus) : req.status;
  const priority = str(fd, 'priority', 10) === 'priority' ? 'priority' : 'normal';
  const assignee = str(fd, 'assigned_to', 12) === 'me' ? session.user.id : str(fd, 'assigned_to', 12) === '' ? null : Number(req.assigned_to) || null;
  await execute(`UPDATE support_requests SET status = ?, priority = ?, assigned_to = ?, resolved_at = IF(? = 'resolved', COALESCE(resolved_at, NOW()), NULL) WHERE id = ?`, [status, priority, assignee, status, req.id]);
  await audit('support.request.updated', { actorUserId: session.user.id, targetType: 'support_request', targetId: req.id, metadata: { status, priority, assignee } });
  revalidatePath('/admin/support', 'layout');
  return { ok: true, message: 'Saved.' };
}
