import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { query, queryOne, type Row } from './db';
import { getSession, type CurrentSession } from './auth/session';
import { env } from './env';

/**
 * Organization-scoped authorization. Roles are per organization; the same user can be an
 * Organization Admin in one org and staff in another. Super Admins can act inside any org.
 *
 *   org_admin  → everything in the org (team, payouts, all events, refunds)
 *   organizer  → events they created or are assigned to (or all, if all_events = 1);
 *                refunds / overrides only when granted
 *   staff      → check-in only, on assigned events; no financial data
 */
export type OrgRole = 'org_admin' | 'organizer' | 'staff';

export interface OrgContext {
  session: CurrentSession;
  org: OrgRow;
  role: OrgRole | 'super_admin';
  perms: { canRefund: boolean; canOverrideCheckin: boolean; canUndoCheckin: boolean; allEvents: boolean };
  isOrgAdmin: boolean;      // org_admin or super_admin
  isSuperAdmin: boolean;
}

export type OrgRow = Row & {
  id: number; slug: string; name: string; legal_name: string | null; contact_email: string; contact_phone: string | null;
  website: string | null; description: string | null; logo_path: string | null; status: 'active' | 'suspended';
  fee_bps_override: number | null; fee_fixed_cents_override: number | null; created_at: Date;
  verified_at: Date | null; meta_pixel_id: string | null; ga4_id: string | null;
  /** Fattixx Pro (migration 0012): Pro features are on while pro_until is in the future; see lib/pro/status.ts */
  pro_until: Date | null; pro_comp_until: Date | null;
  brand_primary: string | null; brand_accent: string | null; brand_cover_path: string | null; brand_own_header: number; mailing_address: string | null;
  /** White-label add-on (migration 0014, lib/pro/white-label.ts) */
  white_label: number; email_sender_name: string | null;
  /** Organizer sign-up questionnaire (migration 0015): NULL until answered or skipped */
  questionnaire_done_at: Date | null;
};

export const getOrgBySlug = cache(async (slug: string): Promise<OrgRow | null> => {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  return queryOne<OrgRow>(`SELECT * FROM organizations WHERE slug = ?`, [slug]);
});

type MemberRow = Row & { role: OrgRole; can_refund: number; can_override_checkin: number; can_undo_checkin: number; all_events: number };

/** Resolve the caller's role inside `orgSlug`, or redirect to login / a denied page. */
export async function requireOrg(orgSlug: string, minimum: OrgRole | 'any' = 'any'): Promise<OrgContext> {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/org/${orgSlug}`)}`);
  const org = await getOrgBySlug(orgSlug);
  if (!org) redirect('/dashboard?missing=1');

  const isSuperAdmin = session.user.roles.includes('super_admin');
  let role: OrgContext['role'];
  let perms = { canRefund: true, canOverrideCheckin: true, canUndoCheckin: true, allEvents: true };

  const staff = platformStaffAccess(session);
  if (isSuperAdmin) {
    role = 'super_admin';
  } else if (staff) {
    role = staff.role; perms = staff.perms;
  } else {
    const m = await queryOne<MemberRow>(
      `SELECT role, can_refund, can_override_checkin, can_undo_checkin, all_events FROM organization_members WHERE organization_id = ? AND user_id = ?`,
      [org.id, session.user.id],
    );
    if (!m) redirect('/dashboard?denied=1');
    if (org.status !== 'active') redirect('/dashboard?suspended=1');
    role = m.role;
    perms = m.role === 'org_admin'
      ? { canRefund: true, canOverrideCheckin: true, canUndoCheckin: true, allEvents: true }
      : { canRefund: !!m.can_refund, canOverrideCheckin: !!m.can_override_checkin, canUndoCheckin: !!m.can_undo_checkin, allEvents: !!m.all_events };
  }

  const rank: Record<OrgContext['role'], number> = { staff: 1, organizer: 2, org_admin: 3, super_admin: 4 };
  if (minimum !== 'any' && rank[role] < rank[minimum]) redirect(`/org/${orgSlug}?denied=1`);

  return { session, org, role, perms, isOrgAdmin: role === 'org_admin' || role === 'super_admin', isSuperAdmin };
}

/** Same as requireOrg but throws (for Server Actions). */
export async function assertOrg(orgSlug: string, minimum: OrgRole | 'any' = 'any'): Promise<OrgContext> {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');
  const org = await getOrgBySlug(orgSlug);
  if (!org) throw new Error('Organization not found');
  const isSuperAdmin = session.user.roles.includes('super_admin');
  if (isSuperAdmin) {
    return { session, org, role: 'super_admin', perms: { canRefund: true, canOverrideCheckin: true, canUndoCheckin: true, allEvents: true }, isOrgAdmin: true, isSuperAdmin: true };
  }
  const staff = platformStaffAccess(session);
  if (staff) {
    const rank: Record<OrgContext['role'], number> = { staff: 1, organizer: 2, org_admin: 3, super_admin: 4 };
    if (minimum !== 'any' && rank[staff.role] < rank[minimum]) throw new Error('Forbidden');
    return { session, org, role: staff.role, perms: staff.perms, isOrgAdmin: staff.role === 'org_admin', isSuperAdmin: false };
  }
  const m = await queryOne<MemberRow>(
    `SELECT role, can_refund, can_override_checkin, can_undo_checkin, all_events FROM organization_members WHERE organization_id = ? AND user_id = ?`,
    [org.id, session.user.id],
  );
  if (!m || org.status !== 'active') throw new Error('Forbidden');
  const rank: Record<OrgContext['role'], number> = { staff: 1, organizer: 2, org_admin: 3, super_admin: 4 };
  if (minimum !== 'any' && rank[m.role] < rank[minimum]) throw new Error('Forbidden');
  const perms = m.role === 'org_admin'
    ? { canRefund: true, canOverrideCheckin: true, canUndoCheckin: true, allEvents: true }
    : { canRefund: !!m.can_refund, canOverrideCheckin: !!m.can_override_checkin, canUndoCheckin: !!m.can_undo_checkin, allEvents: !!m.all_events };
  return { session, org, role: m.role, perms, isOrgAdmin: m.role === 'org_admin', isSuperAdmin: false };
}

/**
 * Platform staff inside an organization: Finance acts like an Organization Admin (refunds, settlement);
 * Support acts like an Organizer with access to every event but no money or override powers.
 */
function platformStaffAccess(session: CurrentSession): { role: OrgRole; perms: OrgContext['perms'] } | null {
  if (session.user.roles.includes('finance')) return { role: 'org_admin', perms: { canRefund: true, canOverrideCheckin: true, canUndoCheckin: true, allEvents: true } };
  if (session.user.roles.includes('support')) return { role: 'organizer', perms: { canRefund: false, canOverrideCheckin: false, canUndoCheckin: false, allEvents: true } };
  return null;
}

/** Can this member see / work on the given event? */
export async function canAccessEvent(ctx: OrgContext, event: { id: number; organization_id: number; created_by: number | null }): Promise<boolean> {
  if (event.organization_id !== ctx.org.id) return false;
  if (ctx.isOrgAdmin) return true;
  if (ctx.role === 'organizer' && (ctx.perms.allEvents || event.created_by === ctx.session.user.id)) return true;
  const row = await queryOne(`SELECT 1 FROM event_members WHERE event_id = ? AND user_id = ?`, [event.id, ctx.session.user.id]);
  return !!row;
}

/** SQL fragment + params restricting an events query to what the member may see. */
export function eventVisibilityClause(ctx: OrgContext): { sql: string; params: (number | string)[] } {
  if (ctx.isOrgAdmin || (ctx.role === 'organizer' && ctx.perms.allEvents)) return { sql: '', params: [] };
  if (ctx.role === 'organizer') {
    return { sql: ' AND (e.created_by = ? OR EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = ?))', params: [ctx.session.user.id, ctx.session.user.id] };
  }
  return { sql: ' AND EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = ?)', params: [ctx.session.user.id] };
}

export type MembershipSummary = Row & { organization_id: number; slug: string; name: string; role: OrgRole; status: string; logo_path: string | null };

/** All organizations the signed-in user belongs to (for the dashboard / org switcher). */
export async function listMemberships(userId: number): Promise<MembershipSummary[]> {
  return query<MembershipSummary>(
    `SELECT o.id AS organization_id, o.slug, o.name, o.status, o.logo_path, m.role
       FROM organization_members m JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ? ORDER BY o.name`,
    [userId],
  );
}

/** Where should this user land after login? */
export async function homeFor(session: CurrentSession): Promise<string> {
  // Platform staff live in the admin console (a separate app, see Fattixx-admin/).
  if (session.user.roles.length) return `${env.ADMIN_URL}/admin`;
  const memberships = await listMemberships(session.user.id);
  if (memberships.length === 1) return `/org/${memberships[0].slug}`;
  if (memberships.length > 1) return '/dashboard';
  return '/account';
}
