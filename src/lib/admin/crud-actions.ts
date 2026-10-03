'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertSuperAdmin } from '../auth/guard';
import { deleteUpload } from '../uploads';
import { isEmail, normalizeEmail } from '../users';

/**
 * Super Admin "full control" actions: edit and delete organizations, users and anything they own.
 * Every action re-checks the role, refuses self-harm (deleting yourself / the last Super Admin), and
 * writes an audit entry. Deletions cascade in the database (events → orders → tickets → check-in log).
 */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------
export async function deleteOrganization(fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const slug = str(fd, 'org', 64);
  const org = await queryOne<Row & { id: number; name: string; logo_path: string | null }>(`SELECT id, name, logo_path FROM organizations WHERE slug = ?`, [slug]);
  if (!org) return { error: 'Organization not found.' };
  const counts = await queryOne<Row & { events: number; orders: number }>(
    `SELECT (SELECT COUNT(*) FROM events WHERE organization_id = ?) AS events, (SELECT COUNT(*) FROM orders WHERE organization_id = ? AND status IN ('paid','partially_refunded')) AS orders`,
    [org.id, org.id],
  );
  const images = await query<Row & { image_path: string | null }>(`SELECT image_path FROM events WHERE organization_id = ? AND image_path IS NOT NULL`, [org.id]);
  for (const r of images) await deleteUpload(r.image_path);
  await deleteUpload(org.logo_path);
  await execute(`DELETE FROM organizations WHERE id = ?`, [org.id]);
  await audit('org.deleted', { actorUserId: session.user.id, targetType: 'organization', targetId: org.id, metadata: { name: org.name, slug, events: Number(counts?.events ?? 0), paidOrders: Number(counts?.orders ?? 0) } });
  revalidatePath('/admin/organizations');
  revalidatePath('/admin/events');
  revalidatePath('/');
  redirect('/admin/organizations?deleted=1');
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export async function updateUser(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const userId = Number(fd.get('user_id'));
  const name = str(fd, 'name', 120);
  const email = str(fd, 'email', 254);
  const phone = str(fd, 'phone', 40);
  if (!Number.isInteger(userId)) return { error: 'Invalid request.' };
  if (name.length < 2) return { error: 'Enter a name.' };
  if (!isEmail(email)) return { error: 'Enter a valid email address.' };
  const clash = await queryOne<Row & { id: number }>(`SELECT id FROM users WHERE email_normalized = ? AND id <> ?`, [normalizeEmail(email), userId]);
  if (clash) return { error: 'Another account already uses that email.' };
  const before = await queryOne<Row & { email: string; name: string }>(`SELECT email, name FROM users WHERE id = ?`, [userId]);
  if (!before) return { error: 'User not found.' };
  await execute(`UPDATE users SET name = ?, email = ?, email_normalized = ?, phone = ? WHERE id = ?`, [name, email, normalizeEmail(email), phone || null, userId]);
  if (normalizeEmail(before.email) !== normalizeEmail(email)) {
    // Keep their purchase history reachable under the new address.
    await execute(`UPDATE orders SET buyer_email = ? WHERE user_id = ?`, [normalizeEmail(email), userId]);
  }
  await audit('user.updated', { actorUserId: session.user.id, targetType: 'user', targetId: userId, metadata: { from: { name: before.name, email: before.email }, to: { name, email } } });
  revalidatePath('/admin/users');
  return { ok: true };
}

export async function deleteUser(fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const userId = Number(fd.get('user_id'));
  if (!Number.isInteger(userId)) return { error: 'Invalid request.' };
  if (userId === session.user.id) return { error: 'You cannot delete your own account.' };
  const user = await queryOne<Row & { email: string; name: string }>(`SELECT email, name FROM users WHERE id = ?`, [userId]);
  if (!user) return { error: 'User not found.' };
  const isAdmin = await queryOne(`SELECT 1 FROM user_platform_roles WHERE user_id = ? AND role = 'super_admin'`, [userId]);
  if (isAdmin) return { error: 'Super Admins cannot be deleted. Remove their Super Admin role first.' };
  // Orders they bought stay (buyer email is kept on the order); memberships, sessions, roles and tokens cascade.
  await execute(`DELETE FROM users WHERE id = ?`, [userId]);
  await audit('user.deleted', { actorUserId: session.user.id, targetType: 'user', targetId: userId, metadata: { email: user.email, name: user.name } });
  revalidatePath('/admin/users');
  return { ok: true };
}
