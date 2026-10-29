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
import { BOT_MESSAGE, CAPTCHA_MESSAGE, humanCheck, rateLimited } from '../security/bot';
import { slugify, shortSuffix } from '../slug';
import { ensureUser, isEmail } from '../users';
import { createOneTimeToken } from '../tokens';
import { assertOrg } from '../authz';
import { revokeAllUserSessions } from '../auth/session';
import { releaseHeldEvents } from '../orgs/verification';
import { hashPassword, passwordPolicyErrors, pwnedPasswordCount } from '../security/password';
import { readAnswers, type QuestionName } from './questionnaire';

/**
 * Organizer onboarding with verification (Phase 2). Anyone can apply to sell tickets; platform staff
 * verify the person and business (legal name, tax ID last 4, website, address) before an organization
 * is created. Approved organizations are marked verified; the applicant becomes their Organization Admin.
 * When Stripe Connect is adopted, its identity verification plugs in at the approval step.
 * The application opens with a skippable questionnaire about the organizer's events (questionnaire.ts).
 * An organization made on /create is unverified; its organizer sends the same details from /org/<slug>/verify
 * (submitOrgVerification), and approving that application verifies the organization and publishes its paid events
 * held in review (src/lib/orgs/verification.ts).
 */
export type ActionState = { error?: string; ok?: boolean; message?: string; field?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);

type Fields = {
  contactName: string; email: string; phone: string; orgName: string; legalName: string; type: string; taxLast4: string; website: string; address: string; events: string;
};

function readFields(fd: FormData): Fields | { error: string; field: string } {
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
  return v;
}

export async function submitApplication(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ip = await clientIp();
  if (rateLimited(`apply:${ip}`, 5, 60 * 60_000)) return { error: 'Too many applications from this network. Try again later.' };
  const bot = await humanCheck(fd, ip);
  if (bot) return { error: bot === 'captcha' ? CAPTCHA_MESSAGE : BOT_MESSAGE };
  const v = readFields(fd);
  if ('error' in v) return v;
  const open = await queryOne(`SELECT 1 FROM organizer_applications WHERE contact_email = ? AND status = 'pending'`, [v.email]);
  if (open) return { ok: true, message: 'You already have an application in review. We will email you when it is done.' };
  const session = await getSession();
  const q = readAnswers(fd);
  const r = await execute(
    `INSERT INTO organizer_applications (user_id, contact_name, contact_email, contact_phone, org_name, legal_name, business_type, tax_id_last4, website, address, expected_events,
       event_types, expected_revenue, events_per_year, typical_attendance, attendee_ages, audiences, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [session?.user.id ?? null, v.contactName, v.email, v.phone || null, v.orgName, v.legalName, v.type, v.taxLast4 || null, v.website || null, v.address, v.events || null,
      q.event_types, q.expected_revenue, q.events_per_year, q.typical_attendance, q.attendee_ages, q.audiences, ip],
  );
  await audit('application.submitted', { actorUserId: session?.user.id ?? null, targetType: 'organizer_application', targetId: r.insertId, metadata: { org: v.orgName } });
  const mail = await renderEmail('application_received', { contact_name: v.contactName, org_name: v.orgName });
  await sendEmail({ to: v.email, toName: v.contactName, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'organizer_application', id: r.insertId } });
  return { ok: true, message: 'Thanks! Your application is in review. We verify every organizer before they can sell, and will email you the result.' };
}

/**
 * Verification for an organization made on /create, sent by its Organization Admin. A password is set here when the
 * account has none (one-time-code sign-ups), since a verified organization sells paid tickets.
 */
export async function submitOrgVerification(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  const org = ctx.org;
  if (org.verified_at) return { ok: true, message: `${org.name} is already verified.` };
  if (rateLimited(`verify-org:${ctx.session.user.id}`, 5, 60 * 60_000)) return { error: 'Too many attempts. Try again later.' };
  if (await queryOne(`SELECT 1 FROM organizer_applications WHERE organization_id = ? AND status = 'pending'`, [org.id])) {
    return { ok: true, message: 'Your verification is already in review. We will email you when it is done.' };
  }
  fd.set('org_name', org.name);
  const v = readFields(fd);
  if ('error' in v) return v;

  const user = await queryOne<Row & { id: number; email: string; password_hash: string | null }>(`SELECT id, email, password_hash FROM users WHERE id = ?`, [ctx.session.user.id]);
  if (!user) return { error: 'Please sign in again.' };
  if (!user.password_hash) {
    const password = String(fd.get('password') ?? '');
    const errs = passwordPolicyErrors(password, user.email);
    if (errs.length) return { error: errs.join(' '), field: 'password' };
    if (password !== String(fd.get('confirm') ?? '')) return { error: 'The two passwords do not match.', field: 'confirm' };
    const pwned = await pwnedPasswordCount(password);
    if (pwned && pwned > 0) return { error: `That password has appeared in ${pwned.toLocaleString()} data breaches. Choose a different one.`, field: 'password' };
    await execute(`UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?`, [await hashPassword(password), user.id]);
    await revokeAllUserSessions(user.id, 'password_changed', ctx.session.id);
    await audit('auth.password.set', { actorUserId: user.id, metadata: { via: 'org_verification' } });
  }

  const q = await queryOne<Row & Record<QuestionName, string | null>>(
    `SELECT event_types, expected_revenue, events_per_year, typical_attendance, attendee_ages, audiences FROM organizations WHERE id = ?`, [org.id],
  );
  const r = await execute(
    `INSERT INTO organizer_applications (user_id, contact_name, contact_email, contact_phone, org_name, legal_name, business_type, tax_id_last4, website, address, expected_events,
       event_types, expected_revenue, events_per_year, typical_attendance, attendee_ages, audiences, organization_id, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, v.contactName, v.email, v.phone || null, org.name, v.legalName, v.type, v.taxLast4 || null, v.website || null, v.address, v.events || null,
      q?.event_types ?? null, q?.expected_revenue ?? null, q?.events_per_year ?? null, q?.typical_attendance ?? null, q?.attendee_ages ?? null, q?.audiences ?? null, org.id, await clientIp()],
  );
  await audit('application.submitted', { actorUserId: user.id, targetType: 'organizer_application', targetId: r.insertId, metadata: { org: org.name, orgId: Number(org.id) } });
  const mail = await renderEmail('application_received', { contact_name: v.contactName, org_name: org.name });
  await sendEmail({ to: v.email, toName: v.contactName, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'organizer_application', id: r.insertId } });
  revalidatePath(`/org/${org.slug}`, 'layout');
  return { ok: true, message: 'Thanks! Your verification is in review. Most reviews take one to two business days, and we will email you the result. Your paid events go live as soon as it is approved.' };
}

type AppRow = Row & { id: number; contact_name: string; contact_email: string; contact_phone: string | null; org_name: string; legal_name: string; website: string | null; status: string; expected_events: string | null; organization_id: number | null } & Record<QuestionName, string | null>;

/** Approving the verification of an organization made on /create: mark it verified and publish its held paid events. */
async function approveExistingOrg(app: AppRow, reviewerId: number, notes: string | null): Promise<ActionState> {
  const orgId = Number(app.organization_id);
  const org = await queryOne<Row & { slug: string; name: string }>(`SELECT slug, name FROM organizations WHERE id = ?`, [orgId]);
  if (!org) return { error: 'The organization no longer exists.' };
  const claim = await execute(
    `UPDATE organizer_applications SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), review_notes = ? WHERE id = ? AND status = 'pending'`,
    [reviewerId, notes, app.id],
  );
  if (!claim.affectedRows) return { error: 'Someone else reviewed this application just now.' };
  await execute(
    `UPDATE organizations SET verified_at = COALESCE(verified_at, NOW()), legal_name = ?, website = COALESCE(website, ?), contact_phone = COALESCE(contact_phone, ?) WHERE id = ?`,
    [app.legal_name, app.website, app.contact_phone, orgId],
  );
  const released = await releaseHeldEvents(orgId, reviewerId);
  const live = released.length
    ? `${released.length === 1 ? 'Your event' : 'Your events'} ${released.map((e) => `“${e.title}”`).join(', ')} ${released.length === 1 ? 'is' : 'are'} now live and on sale.`
    : 'You can now sell paid tickets.';
  const mail = await renderEmail('org_verified', { contact_name: app.contact_name, org_name: org.name, live_line: live, url: `${env.APP_URL}/org/${org.slug}` });
  await sendEmail({ to: app.contact_email, toName: app.contact_name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'organization', id: orgId } });
  await audit('application.approved', { actorUserId: reviewerId, targetType: 'organizer_application', targetId: app.id, metadata: { orgId, slug: org.slug, existingOrg: true, released: released.map((e) => e.id) } });
  await audit('org.verified', { actorUserId: reviewerId, targetType: 'organization', targetId: orgId, metadata: { viaApplication: app.id } });
  revalidatePath('/admin/applications');
  revalidatePath('/admin/organizations');
  revalidatePath('/');
  revalidatePath('/events');
  for (const e of released) revalidatePath(`/events/${e.slug}`);
  return { ok: true, message: `Approved. ${org.name} is verified${released.length ? ` and ${released.length} held event${released.length === 1 ? ' is' : 's are'} now live` : ''}.` };
}

export async function approveApplication(fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole(['super_admin', 'support']);
  const app = await queryOne<AppRow>(`SELECT * FROM organizer_applications WHERE id = ?`, [Number(fd.get('id'))]);
  if (!app || app.status !== 'pending') return { error: 'Application not found or already reviewed.' };
  if (app.organization_id) return approveExistingOrg(app, session.user.id, str(fd, 'notes', 1000) || null);
  let slug = slugify(app.org_name);
  if (await queryOne(`SELECT 1 FROM organizations WHERE slug = ?`, [slug])) slug = `${slug}-${shortSuffix()}`;
  const org = await execute(
    `INSERT INTO organizations (slug, name, legal_name, contact_email, contact_phone, website, description, created_by, verified_at,
       event_types, expected_revenue, events_per_year, typical_attendance, attendee_ages, audiences, questionnaire_done_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, NOW())`,
    [slug, app.org_name, app.legal_name, app.contact_email, app.contact_phone, app.website, app.expected_events, session.user.id,
      app.event_types, app.expected_revenue, app.events_per_year, app.typical_attendance, app.attendee_ages, app.audiences],
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
