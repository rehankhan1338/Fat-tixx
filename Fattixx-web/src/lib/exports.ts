import 'server-only';
import { audit } from './audit';
import { assertOrg, canAccessEvent, type OrgContext } from './authz';
import { getSession, type CurrentSession } from './auth/session';
import { getEvent } from './events/queries';

/**
 * Authorization for report downloads (route handlers). Returns a Response to send back on failure.
 *  - Organization scope: organizers and admins of that organization (and platform Finance / Super Admin), limited to events they can access.
 *  - Platform scope: Finance or Super Admin.
 */
export async function orgExportScope(url: URL): Promise<{ ctx: OrgContext; eventId: number | null } | Response> {
  let ctx: OrgContext;
  try { ctx = await assertOrg(url.searchParams.get('org') ?? '', 'organizer'); } catch { return new Response('Forbidden', { status: 403 }); }
  const eventId = Number(url.searchParams.get('event')) || null;
  if (eventId) {
    const ev = await getEvent(ctx.org.id, eventId);
    if (!ev || !(await canAccessEvent(ctx, ev))) return new Response('Not found', { status: 404 });
  } else if (!ctx.perms.allEvents && !ctx.isOrgAdmin) {
    return new Response('Choose an event', { status: 400 });
  }
  return { ctx, eventId };
}

export async function financeExportScope(roles: ('super_admin' | 'finance' | 'support')[] = ['super_admin', 'finance']): Promise<CurrentSession | Response> {
  const session = await getSession();
  if (!session) return new Response('Sign in first', { status: 401 });
  if (!session.user.roles.some((r) => roles.includes(r))) return new Response('Forbidden', { status: 403 });
  return session;
}

/** Date range from ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, UTC); defaults to the last 31 days. */
export function dateRange(url: URL): { from: Date; to: Date; label: string } {
  const p = (k: string) => { const v = url.searchParams.get(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null; };
  const to = p('to') ?? new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const from = p('from') ?? new Date(to.getTime() - 30 * 86_400_000);
  const end = new Date(to.getTime() + 86_400_000);
  return { from, to: end, label: `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}` };
}

export async function logExport(userId: number, kind: string, meta: Record<string, unknown>): Promise<void> {
  await audit('export.downloaded', { actorUserId: userId, targetType: 'export', targetId: kind, metadata: meta });
}
