'use server';

import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertPlatformRole, assertSuperAdmin } from '../auth/guard';
import type { PlatformRole } from '../auth/session';
import { emailDeliveryStatus, htmlLayout, escapeHtml, resendOutboxEmail, sendEmail, testBrevoKey } from '../email';
import { getEmailSettings, saveEmailSettings as persistEmailSettings, setSetting, type SettingKey } from '../settings';
import { ensureUser, isEmail, sendSetPasswordLink } from '../users';
import { listOrdersForUser } from '../orders/queries';

export type ActionState = { error?: string; ok?: boolean; message?: string; link?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);

// ---------------------------------------------------------------------------
// Platform staff users (Super Admin / Support / Finance)
// ---------------------------------------------------------------------------
const PLATFORM_ROLES: PlatformRole[] = ['super_admin', 'support', 'finance'];

export async function createPlatformUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const email = str(fd, 'email', 254);
  const name = str(fd, 'name', 120);
  const role = str(fd, 'role', 20) as PlatformRole;
  if (!isEmail(email)) return { error: 'Enter a valid email address.' };
  if (name.length < 2) return { error: 'Enter a name.' };
  if (!PLATFORM_ROLES.includes(role)) return { error: 'Choose a role.' };

  const { user, created } = await ensureUser(email, name);
  await execute(`INSERT IGNORE INTO user_platform_roles (user_id, role, granted_by) VALUES (?, ?, ?)`, [user.id, role, session.user.id]);
  if (created) await audit('user.created', { actorUserId: session.user.id, targetType: 'user', targetId: user.id, metadata: { email } });
  await audit('user.role.granted', { actorUserId: session.user.id, targetType: 'user', targetId: user.id, metadata: { role } });

  let link: string | undefined;
  if (!user.password_hash) link = await sendSetPasswordLink(user, { invitedBy: session.user.id, context: 'the Fat Tixx platform team' });
  revalidatePath('/admin/users');
  return { ok: true, message: link ? `${user.name} was added as ${role.replace('_', ' ')}. Share this link if email is not configured.` : `${role.replace('_', ' ')} role granted to ${user.name}.`, link };
}

export async function revokePlatformRole(fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const userId = Number(fd.get('user_id'));
  const role = str(fd, 'role', 20) as PlatformRole;
  if (!Number.isInteger(userId) || !PLATFORM_ROLES.includes(role)) return { error: 'Invalid request.' };
  if (userId === session.user.id && role === 'super_admin') return { error: 'You cannot remove your own Super Admin role.' };
  const admins = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM user_platform_roles WHERE role = 'super_admin'`);
  if (role === 'super_admin' && Number(admins?.n ?? 0) <= 1) return { error: 'There must always be at least one Super Admin.' };
  await execute(`DELETE FROM user_platform_roles WHERE user_id = ? AND role = ?`, [userId, role]);
  await execute(`UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'role_revoked' WHERE user_id = ? AND revoked_at IS NULL`, [userId]);
  await audit('user.role.revoked', { actorUserId: session.user.id, targetType: 'user', targetId: userId, metadata: { role } });
  revalidatePath('/admin/users');
  return { ok: true };
}

export async function setUserStatus(fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const userId = Number(fd.get('user_id'));
  const status = str(fd, 'status', 20);
  if (!Number.isInteger(userId) || !['active', 'suspended', 'disabled'].includes(status)) return { error: 'Invalid request.' };
  if (userId === session.user.id) return { error: 'You cannot change your own status.' };
  await execute(`UPDATE users SET status = ? WHERE id = ?`, [status, userId]);
  if (status !== 'active') await execute(`UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'status_changed' WHERE user_id = ? AND revoked_at IS NULL`, [userId]);
  await audit('user.status.changed', { actorUserId: session.user.id, targetType: 'user', targetId: userId, metadata: { status } });
  revalidatePath('/admin/users');
  return { ok: true };
}

export async function sendPasswordLinkToUser(fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole(['super_admin', 'support']);
  const userId = Number(fd.get('user_id'));
  const user = await queryOne<Row & { id: number; email: string; name: string; password_hash: string | null; status: string }>(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) return { error: 'User not found.' };
  const link = await sendSetPasswordLink(user as never, { invitedBy: session.user.id, context: 'Fat Tixx', purpose: user.password_hash ? 'reset_password' : 'set_password' });
  await audit('user.invited', { actorUserId: session.user.id, targetType: 'user', targetId: user.id });
  return { ok: true, message: 'Password link created.', link };
}

export type UserOrderView = { id: number; code: string; status: string; source: string; event_title: string; org_name: string; org_slug: string; ticket_count: number; total_cents: number; refunded_cents: number; currency: string; date: string | null };

/** Orders placed by one account, for the orders popup on /admin/users. */
export async function getUserOrders(userId: number): Promise<{ error?: string; orders?: UserOrderView[] }> {
  await assertPlatformRole(['super_admin', 'support']);
  if (!Number.isInteger(userId) || userId <= 0) return { error: 'Invalid user.' };
  const rows = await listOrdersForUser(userId);
  return {
    orders: rows.map((o) => {
      const when = o.paid_at ?? o.created_at;
      return {
        id: o.id, code: o.code, status: o.status, source: o.source, event_title: o.event_title, org_name: o.org_name, org_slug: o.org_slug,
        ticket_count: Number(o.ticket_count), total_cents: Number(o.total_cents), refunded_cents: Number(o.refunded_cents), currency: o.currency,
        date: when ? new Date(when).toISOString() : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Platform settings (fees, defaults)
// ---------------------------------------------------------------------------
export async function updatePlatformSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const pct = (k: string) => Math.round(Number(str(fd, k, 10)) * 100); // "5.00" % → 500 bps
  const cents = (k: string) => Math.round(Number(str(fd, k, 10)) * 100);
  const platformFeeBps = pct('platform_fee_pct');
  const platformFeeFixed = cents('platform_fee_fixed');
  const processingBps = pct('processing_fee_pct');
  const processingFixed = cents('processing_fee_fixed');
  const holdMinutes = Number(str(fd, 'hold_minutes', 5));
  const feeMode = str(fd, 'default_fee_mode', 20);
  const platformName = str(fd, 'platform_name', 60);
  const supportEmail = str(fd, 'support_email', 254);
  if (![platformFeeBps, platformFeeFixed, processingBps, processingFixed].every((n) => Number.isFinite(n) && n >= 0)) return { error: 'Fees must be zero or positive numbers.' };
  if (platformFeeBps > 5000) return { error: 'Platform fee cannot exceed 50%.' };
  if (!Number.isInteger(holdMinutes) || holdMinutes < 3 || holdMinutes > 60) return { error: 'Hold time must be between 3 and 60 minutes.' };
  if (!['buyer_pays', 'organizer_absorbs'].includes(feeMode)) return { error: 'Choose a fee mode.' };
  if (!isEmail(supportEmail)) return { error: 'Enter a valid support email.' };

  const pairs: [SettingKey, string][] = [
    ['platform_fee_bps', String(platformFeeBps)], ['platform_fee_fixed_cents', String(platformFeeFixed)],
    ['processing_fee_bps', String(processingBps)], ['processing_fee_fixed_cents', String(processingFixed)],
    ['hold_minutes', String(holdMinutes)], ['default_fee_mode', feeMode], ['platform_name', platformName || 'Fat Tixx'], ['support_email', supportEmail],
  ];
  for (const [k, v] of pairs) await setSetting(k, v, session.user.id);
  await audit('settings.updated', { actorUserId: session.user.id, metadata: Object.fromEntries(pairs) });
  revalidatePath('/admin/settings');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Email delivery (Brevo) — key stored encrypted in platform_settings, shared by the site and the console
// ---------------------------------------------------------------------------
export async function saveEmailSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const apiKey = str(fd, 'brevo_api_key', 200);
  const from = str(fd, 'mail_from', 254);
  const fromEmail = from.match(/<([^>]+)>\s*$/)?.[1]?.trim() ?? from;
  if (!from || !isEmail(fromEmail)) return { error: 'Enter the sender as an address or "Name <address>", e.g. Fat Tixx <tickets@fattixx.com>.' };
  if (apiKey && apiKey !== 'clear' && !/^xkeysib-/.test(apiKey)) return { error: 'A Brevo API key starts with xkeysib-. Create one under Brevo → Settings → SMTP & API → API keys.' };
  const current = await getEmailSettings();
  // Blank keeps the saved key; the literal word "clear" removes it (the environment fallback then applies).
  const nextKey = apiKey === 'clear' ? '' : apiKey || (current.source === 'settings' ? current.apiKey ?? '' : '');
  let verified = '';
  if (nextKey) {
    const t = await testBrevoKey(nextKey, from);
    if (!t.ok) return { error: `Brevo rejected the key: ${t.error}` };
    verified = ` Verified with Brevo (${t.account}).${t.senderVerified === false ? ` Warning: ${fromEmail} is not a verified sender in that account, so sends will be rejected until you verify it in Brevo → Senders.` : ''}`;
  }
  await persistEmailSettings({ apiKey: nextKey, from }, session.user.id);
  await audit('settings.email', { actorUserId: session.user.id, metadata: { key: nextKey ? 'saved' : 'cleared', from } });
  revalidatePath('/admin/settings');
  revalidatePath('/admin/monitoring');
  revalidatePath('/admin/emails');
  return { ok: true, message: `Email settings saved.${verified}` };
}

/** Sends a short message to the signed-in admin so delivery can be confirmed end to end. */
export async function sendTestEmail(): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const status = await emailDeliveryStatus();
  if (!status.configured) return { error: 'Email delivery is not configured yet: save a Brevo API key first.' };
  const id = await sendEmail({
    to: session.user.email, toName: session.user.name, subject: 'Fat Tixx test email',
    text: `This is a test message from Fat Tixx. Delivery via ${status.provider} as ${status.from} works.`,
    html: htmlLayout('Test email', `<p>This is a test message from Fat Tixx. Delivery via ${escapeHtml(status.provider ?? '')} as <strong>${escapeHtml(status.from)}</strong> works.</p>`),
    related: { type: 'test', id: session.user.id },
  });
  const row = await queryOne<Row & { status: string; error: string | null }>(`SELECT status, error FROM email_outbox WHERE id = ?`, [id]);
  await audit('email.test', { actorUserId: session.user.id, targetType: 'email', targetId: id, metadata: { status: row?.status } });
  revalidatePath('/admin/emails');
  if (row?.status !== 'sent') return { error: `Send failed: ${row?.error ?? 'unknown error'}. The message is in Admin → Emails.` };
  return { ok: true, message: `Test email sent to ${session.user.email}.` };
}

// ---------------------------------------------------------------------------
// Email outbox
// ---------------------------------------------------------------------------
export async function resendEmail(fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole(['super_admin', 'support']);
  const id = Number(fd.get('id'));
  if (!Number.isInteger(id)) return { error: 'Invalid request.' };
  const ok = await resendOutboxEmail(id);
  await audit('email.resent', { actorUserId: session.user.id, targetType: 'email', targetId: id, metadata: { ok } });
  revalidatePath('/admin/emails');
  return ok ? { ok: true } : { error: 'Could not send. Is a Brevo API key saved under Settings → Integrations (or SMTP_URL set)?' };
}

// ---------------------------------------------------------------------------
// Log maintenance (Super Admin only)
// ---------------------------------------------------------------------------

/** Wipes the audit log, then records who did it so the wipe itself stays on the record. */
export async function clearAuditLog(): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const r = await execute(`DELETE FROM audit_log`);
  await audit('audit.cleared', { actorUserId: session.user.id, metadata: { removed: r.affectedRows } });
  revalidatePath('/admin/audit');
  revalidatePath('/admin');
  return { ok: true, message: `${r.affectedRows} audit entries removed.` };
}

/** Clears every recorded sign-in attempt. This also resets active lockouts, since they are derived from this table. */
export async function clearLoginAttempts(): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const r = await execute(`DELETE FROM login_attempts`);
  await audit('auth.attempts.cleared', { actorUserId: session.user.id, metadata: { removed: r.affectedRows } });
  revalidatePath('/admin/security');
  return { ok: true, message: `${r.affectedRows} sign-in attempts removed.` };
}

export async function deleteLoginAttempt(fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const id = Number(str(fd, 'id', 20));
  if (!Number.isInteger(id) || id <= 0) return { error: 'Invalid attempt.' };
  const r = await execute(`DELETE FROM login_attempts WHERE id = ?`, [id]);
  if (!r.affectedRows) return { error: 'That attempt was already removed.' };
  await audit('auth.attempt.deleted', { actorUserId: session.user.id, targetType: 'login_attempt', targetId: id });
  revalidatePath('/admin/security');
  return { ok: true };
}
