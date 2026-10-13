'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertSuperAdmin } from '../auth/guard';
import { assertOrg, type OrgRole } from '../authz';
import { slugify, shortSuffix } from '../slug';
import { ensureUser, isEmail, sendSetPasswordLink } from '../users';
import { deleteUpload, saveImageUpload } from '../uploads';

export type ActionState = { error?: string; ok?: boolean; message?: string; link?: string } | undefined;

const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);
const optInt = (fd: FormData, k: string): number | null => { const v = str(fd, k, 20); if (v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };

// ---------------------------------------------------------------------------
// Super Admin: organizations
// ---------------------------------------------------------------------------
export async function createOrganization(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const name = str(fd, 'name', 160);
  const contactEmail = str(fd, 'contact_email', 254);
  const adminEmail = str(fd, 'admin_email', 254);
  const adminName = str(fd, 'admin_name', 120);
  if (name.length < 2) return { error: 'Enter the organization name.' };
  if (!isEmail(contactEmail)) return { error: 'Enter a valid contact email.' };
  if (adminEmail && !isEmail(adminEmail)) return { error: 'Enter a valid email for the Organization Admin.' };

  let slug = slugify(str(fd, 'slug', 64) || name);
  if (await queryOne(`SELECT 1 FROM organizations WHERE slug = ?`, [slug])) slug = `${slug}-${shortSuffix()}`;

  const r = await execute(
    `INSERT INTO organizations (slug, name, legal_name, contact_email, contact_phone, website, description, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [slug, name, str(fd, 'legal_name', 200) || null, contactEmail, str(fd, 'contact_phone', 40) || null, str(fd, 'website', 255) || null, str(fd, 'description', 2000) || null, session.user.id],
  );
  const orgId = r.insertId;
  await audit('org.created', { actorUserId: session.user.id, targetType: 'organization', targetId: orgId, metadata: { name, slug } });

  let link: string | undefined;
  if (adminEmail) {
    const { user, created } = await ensureUser(adminEmail, adminName);
    await execute(`INSERT IGNORE INTO organization_members (organization_id, user_id, role, invited_by) VALUES (?, ?, 'org_admin', ?)`, [orgId, user.id, session.user.id]);
    await audit('org.member.added', { actorUserId: session.user.id, targetType: 'organization', targetId: orgId, metadata: { userId: user.id, role: 'org_admin' } });
    if (!user.password_hash) link = await sendSetPasswordLink(user, { invitedBy: session.user.id, context: `${name} on Fat Tixx` });
    if (created) await audit('user.created', { actorUserId: session.user.id, targetType: 'user', targetId: user.id, metadata: { email: adminEmail } });
  }
  revalidatePath('/admin/organizations');
  redirect(`/admin/organizations/${slug}${link ? `?invite=${encodeURIComponent(link)}` : ''}`);
}

export async function updateOrganization(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'org_admin');
  const name = str(fd, 'name', 160);
  const contactEmail = str(fd, 'contact_email', 254);
  if (name.length < 2) return { error: 'Enter the organization name.' };
  if (!isEmail(contactEmail)) return { error: 'Enter a valid contact email.' };

  let logoPath = ctx.org.logo_path;
  const logo = fd.get('logo');
  if (logo instanceof File && logo.size > 0) {
    try { const p = await saveImageUpload(logo, 'orgs', 600); await deleteUpload(logoPath); logoPath = p; } catch (e) { return { error: (e as Error).message }; }
  }
  await execute(
    `UPDATE organizations SET name = ?, legal_name = ?, contact_email = ?, contact_phone = ?, website = ?, description = ?, logo_path = ? WHERE id = ?`,
    [name, str(fd, 'legal_name', 200) || null, contactEmail, str(fd, 'contact_phone', 40) || null, str(fd, 'website', 255) || null, str(fd, 'description', 2000) || null, logoPath, ctx.org.id],
  );
  await audit('org.updated', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id });
  revalidatePath(`/org/${orgSlug}`);
  revalidatePath(`/admin/organizations/${orgSlug}`);
  return { ok: true };
}

/** Super Admin only: fee overrides and suspension. */
export async function updateOrganizationPlatformSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const orgSlug = str(fd, 'org', 64);
  const org = await queryOne<Row & { id: number }>(`SELECT id FROM organizations WHERE slug = ?`, [orgSlug]);
  if (!org) return { error: 'Organization not found.' };
  const feeBps = optInt(fd, 'fee_bps_override');
  const feeFixed = optInt(fd, 'fee_fixed_cents_override');
  const status = str(fd, 'status', 20) === 'suspended' ? 'suspended' : 'active';
  if (feeBps !== null && feeBps > 5000) return { error: 'Platform fee cannot exceed 50%.' };
  await execute(`UPDATE organizations SET fee_bps_override = ?, fee_fixed_cents_override = ?, status = ? WHERE id = ?`, [feeBps, feeFixed, status, org.id]);
  await audit('org.updated', { actorUserId: session.user.id, targetType: 'organization', targetId: org.id, metadata: { feeBps, feeFixed, status } });
  revalidatePath(`/admin/organizations/${orgSlug}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Team members (Org Admin or Super Admin)
// ---------------------------------------------------------------------------
const ROLES: OrgRole[] = ['org_admin', 'organizer', 'staff'];

export async function addOrgMember(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'org_admin');
  const email = str(fd, 'email', 254);
  const name = str(fd, 'name', 120);
  const role = str(fd, 'role', 20) as OrgRole;
  if (!isEmail(email)) return { error: 'Enter a valid email address.' };
  if (!ROLES.includes(role)) return { error: 'Choose a role.' };

  const { user, created } = await ensureUser(email, name);
  const existing = await queryOne(`SELECT 1 FROM organization_members WHERE organization_id = ? AND user_id = ?`, [ctx.org.id, user.id]);
  if (existing) return { error: 'That person is already a member of this organization.' };

  await execute(
    `INSERT INTO organization_members (organization_id, user_id, role, can_refund, can_override_checkin, can_undo_checkin, all_events, invited_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [ctx.org.id, user.id, role, fd.get('can_refund') ? 1 : 0, fd.get('can_override_checkin') ? 1 : 0, fd.get('can_undo_checkin') ? 1 : 0, role === 'organizer' && fd.get('all_events') ? 1 : 0, ctx.session.user.id],
  );
  if (created) await audit('user.created', { actorUserId: ctx.session.user.id, targetType: 'user', targetId: user.id, metadata: { email } });
  await audit('org.member.added', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { userId: user.id, role } });

  let link: string | undefined;
  if (!user.password_hash) {
    link = await sendSetPasswordLink(user, { invitedBy: ctx.session.user.id, context: `${ctx.org.name} on Fat Tixx` });
    await audit('user.invited', { actorUserId: ctx.session.user.id, targetType: 'user', targetId: user.id });
  }
  revalidatePath(`/org/${orgSlug}/team`);
  revalidatePath(`/admin/organizations/${orgSlug}`);
  return { ok: true, message: link ? `${user.name} was added. They have not set a password yet; share this link with them if email is not configured.` : `${user.name} was added and can sign in with their existing password.`, link };
}

export async function updateOrgMember(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'org_admin');
  const userId = Number(fd.get('user_id'));
  const role = str(fd, 'role', 20) as OrgRole;
  if (!Number.isInteger(userId) || !ROLES.includes(role)) return { error: 'Invalid request.' };
  if (userId === ctx.session.user.id && role !== 'org_admin' && !ctx.isSuperAdmin) return { error: 'You cannot remove your own admin role.' };
  const r = await execute(
    `UPDATE organization_members SET role = ?, can_refund = ?, can_override_checkin = ?, can_undo_checkin = ?, all_events = ? WHERE organization_id = ? AND user_id = ?`,
    [role, fd.get('can_refund') ? 1 : 0, fd.get('can_override_checkin') ? 1 : 0, fd.get('can_undo_checkin') ? 1 : 0, role === 'organizer' && fd.get('all_events') ? 1 : 0, ctx.org.id, userId],
  );
  if (!r.affectedRows) return { error: 'Member not found.' };
  await audit('org.member.updated', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { userId, role } });
  revalidatePath(`/org/${orgSlug}/team`);
  return { ok: true };
}

export async function removeOrgMember(fd: FormData): Promise<ActionState> {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'org_admin');
  const userId = Number(fd.get('user_id'));
  if (!Number.isInteger(userId)) return { error: 'Invalid request.' };
  if (userId === ctx.session.user.id && !ctx.isSuperAdmin) return { error: 'You cannot remove yourself.' };
  await execute(`DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?`, [ctx.org.id, userId]);
  // Access ends immediately: drop event assignments and kill their sessions if they have no other org roles.
  await execute(`DELETE em FROM event_members em JOIN events e ON e.id = em.event_id WHERE e.organization_id = ? AND em.user_id = ?`, [ctx.org.id, userId]);
  await execute(`UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'membership_removed' WHERE user_id = ? AND revoked_at IS NULL`, [userId]);
  await audit('org.member.removed', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { userId } });
  revalidatePath(`/org/${orgSlug}/team`);
  revalidatePath(`/admin/organizations/${orgSlug}`);
  return { ok: true };
}

export async function resendMemberInvite(fd: FormData): Promise<ActionState> {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'org_admin');
  const userId = Number(fd.get('user_id'));
  const user = await queryOne<Row & { id: number; email: string; name: string; password_hash: string | null; status: string }>(
    `SELECT u.* FROM users u JOIN organization_members m ON m.user_id = u.id WHERE u.id = ? AND m.organization_id = ?`, [userId, ctx.org.id],
  );
  if (!user) return { error: 'Member not found.' };
  const link = await sendSetPasswordLink(user as never, { invitedBy: ctx.session.user.id, context: `${ctx.org.name} on Fat Tixx`, purpose: user.password_hash ? 'reset_password' : 'set_password' });
  await audit('user.invited', { actorUserId: ctx.session.user.id, targetType: 'user', targetId: user.id });
  return { ok: true, message: 'Link sent.', link };
}
