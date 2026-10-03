'use server';

import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertPlatformRole, assertSuperAdmin } from '../auth/guard';
import type { PlatformRole } from '../auth/session';
import { resendOutboxEmail } from '../email';
import { setSetting, type SettingKey } from '../settings';
import { ensureUser, isEmail, sendSetPasswordLink } from '../users';

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
// Email outbox
// ---------------------------------------------------------------------------
export async function resendEmail(fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole(['super_admin', 'support']);
  const id = Number(fd.get('id'));
  if (!Number.isInteger(id)) return { error: 'Invalid request.' };
  const ok = await resendOutboxEmail(id);
  await audit('email.resent', { actorUserId: session.user.id, targetType: 'email', targetId: id, metadata: { ok } });
  revalidatePath('/admin/emails');
  return ok ? { ok: true } : { error: 'Could not send. Is SMTP_URL configured in .env.local?' };
}
