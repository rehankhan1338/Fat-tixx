'use server';

import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertPlatformRole } from '../auth/guard';
import { getSession } from '../auth/session';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { env } from '../env';
import { clientIp } from '../request';
import { BOT_MESSAGE, botCheck, rateLimited } from '../security/bot';
import { slugify, shortSuffix } from '../slug';
import { ensureUser, isEmail } from '../users';
import { createOneTimeToken } from '../tokens';

/**
 * Organizer onboarding with verification (Phase 2). Anyone can apply to sell tickets; platform staff
 * verify the person and business (legal name, tax ID last 4, website, address) before an organization
 * is created. Approved organizations are marked verified; the applicant becomes their Organization Admin.
 * When Stripe Connect is adopted, its identity verification plugs in at the approval step.
 */
export type ActionState = { error?: string; ok?: boolean; message?: string; field?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);

export async function submitApplication(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ip = await clientIp();
  if (rateLimited(`apply:${ip}`, 5, 60 * 60_000)) return { error: 'Too many applications from this network. Try again later.' };
  if (botCheck(fd)) return { error: BOT_MESSAGE };
  const v = {
    contactName: str(fd, 'contact_name', 160), email: str(fd, 'contact_email', 254).toLowerCase(), phone: str(fd, 'contact_phone', 40),
    orgName: str(fd, 'org_name', 160), legalName: str(fd, 'legal_name', 200), type: str(fd, 'business_type', 20), taxLast4: str(fd, 'tax_id_last4', 4),
    website: str(fd, 'website', 255), address: str(fd, 'address', 300), events: str(fd, 'expected_events', 500),
  };
  if (v.contactName.length < 2) return { error: 'Enter your name.', field: 'contact_name' };
  if (!isEmail(v.email)) return { error: 'Enter a valid email address.', field: 'contact_email' };
  if (v.orgName.length < 2) return { error: 'Enter the name buyers will see.', field: 'org_name' };
  if (v.legalName.length < 2) return { error: 'Enter the legal name of the person or business that will be paid.', field: 'legal_name' };
  if (!['individual', 'company', 'nonprofit', 'venue'].includes(v.type)) return { error: 'Choose the type of organizer.', field: 'business_type' };
  if (v.taxLast4 && !/^\d{4}$/.test(v.taxLast4)) return { error: 'Tax ID: enter the last 4 digits only.', field: 'tax_id_last4' };
  if (v.website && !/^https?:\/\/\S+$/i.test(v.website)) return { error: 'The website must start with http:// or https://', field: 'website' };
  if (v.address.length < 5) return { error: 'Enter the business address.', field: 'address' };
  if (!fd.get('agree')) return { error: 'Please accept the Organizer Agreement.', field: 'agree' };
  const open = await queryOne(`SELECT 1 FROM organizer_applications WHERE contact_email = ? AND status = 'pending'`, [v.email]);
  if (open) return { ok: true, message: 'You already have an application in review. We will email you when it is done.' };
  const session = await getSession();
  const r = await execute(
    `INSERT INTO organizer_applications (user_id, contact_name, contact_email, contact_phone, org_name, legal_name, business_type, tax_id_last4, website, address, expected_events, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [session?.user.id ?? null, v.contactName, v.email, v.phone || null, v.orgName, v.legalName, v.type, v.taxLast4 || null, v.website || null, v.address, v.events || null, ip],
  );
  await audit('application.submitted', { actorUserId: session?.user.id ?? null, targetType: 'organizer_application', targetId: r.insertId, metadata: { org: v.orgName } });
  const mail = await renderEmail('application_received', { contact_name: v.contactName, org_name: v.orgName });
  await sendEmail({ to: v.email, toName: v.contactName, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'organizer_application', id: r.insertId } });
  return { ok: true, message: 'Thanks! Your application is in review. We verify every organizer before they can sell, and will email you the result.' };
}

type AppRow = Row & { id: number; contact_name: string; contact_email: string; contact_phone: string | null; org_name: string; legal_name: string; website: string | null; status: string; expected_events: string | null };

export async function approveApplication(fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole(['super_admin', 'support']);
  const app = await queryOne<AppRow>(`SELECT * FROM organizer_applications WHERE id = ?`, [Number(fd.get('id'))]);
  if (!app || app.status !== 'pending') return { error: 'Application not found or already reviewed.' };
  let slug = slugify(app.org_name);
  if (await queryOne(`SELECT 1 FROM organizations WHERE slug = ?`, [slug])) slug = `${slug}-${shortSuffix()}`;
  const org = await execute(
    `INSERT INTO organizations (slug, name, legal_name, contact_email, contact_phone, website, description, created_by, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [slug, app.org_name, app.legal_name, app.contact_email, app.contact_phone, app.website, app.expected_events, session.user.id],
  );
  const { user, created } = await ensureUser(app.contact_email, app.contact_name);
  await execute(`INSERT IGNORE INTO organization_members (organization_id, user_id, role, invited_by) VALUES (?, ?, 'org_admin', ?)`, [org.insertId, user.id, session.user.id]);
  const notes = str(fd, 'notes', 1000) || null;
  const claim = await execute(
    `UPDATE organizer_applications SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), review_notes = ?, organization_id = ? WHERE id = ? AND status = 'pending'`,
    [session.user.id, notes, org.insertId, app.id],
  );
  if (!claim.affectedRows) return { error: 'Someone else reviewed this application just now.' };
  // A new user gets a set-password link; an existing one just signs in.
  const url = user.password_hash ? `${env.APP_URL}/org/${slug}` : `${env.APP_URL}/set-password/${await createOneTimeToken('set_password', user.email, user.id, session.user.id)}`;
  const mail = await renderEmail('application_approved', { contact_name: app.contact_name, org_name: app.org_name, url });
  await sendEmail({ to: app.contact_email, toName: app.contact_name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'organization', id: org.insertId } });
  await audit('application.approved', { actorUserId: session.user.id, targetType: 'organizer_application', targetId: app.id, metadata: { orgId: org.insertId, slug, userCreated: created } });
  await audit('org.created', { actorUserId: session.user.id, targetType: 'organization', targetId: org.insertId, metadata: { name: app.org_name, slug, viaApplication: app.id } });
  revalidatePath('/admin/applications');
  revalidatePath('/admin/organizations');
  return { ok: true, message: `Approved. ${app.org_name} was created and ${app.contact_email} is its Organization Admin.` };
}

export async function rejectApplication(fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole(['super_admin', 'support']);
  const notes = str(fd, 'notes', 1000);
  if (notes.length < 5) return { error: 'Explain briefly why, so the applicant can respond.' };
  const app = await queryOne<AppRow>(`SELECT * FROM organizer_applications WHERE id = ?`, [Number(fd.get('id'))]);
  if (!app || app.status !== 'pending') return { error: 'Application not found or already reviewed.' };
  await execute(`UPDATE organizer_applications SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), review_notes = ? WHERE id = ? AND status = 'pending'`, [session.user.id, notes, app.id]);
  const mail = await renderEmail('application_rejected', { contact_name: app.contact_name, org_name: app.org_name, notes });
  await sendEmail({ to: app.contact_email, toName: app.contact_name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'organizer_application', id: app.id } });
  await audit('application.rejected', { actorUserId: session.user.id, targetType: 'organizer_application', targetId: app.id });
  revalidatePath('/admin/applications');
  return { ok: true, message: 'Application declined and the applicant was emailed.' };
}
