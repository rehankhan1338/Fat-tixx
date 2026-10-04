import { assertOrg, listMemberships } from '@/lib/authz';
import { listVisibleEvents } from '@/lib/events/queries';
import { checkinCounts } from '@/lib/orders/queries';
import { formatEventDate } from '@/lib/tz';
import { handle, json, requireUser } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/**
 * GET (Bearer) → upcoming events the user may check people in for, across every organisation they belong to.
 * Visibility follows the same rules as the organiser dashboard (staff only see events they are assigned to).
 */
export const GET = handle(async () => {
  const session = await requireUser();
  const memberships = (await listMemberships(session.user.id)).filter((m) => m.status === 'active');
  const out: { orgSlug: string; orgName: string; role: string; eventId: number; title: string; startsAt: string; when: string; timezone: string; venue: string | null; counts: { total: number; used: number } }[] = [];
  for (const m of memberships) {
    let ctx;
    try { ctx = await assertOrg(m.slug); } catch { continue; }
    const events = await listVisibleEvents(ctx, 'upcoming');
    for (const e of events) {
      if (!['published', 'postponed', 'completed'].includes(e.status)) continue;
      out.push({
        orgSlug: m.slug, orgName: m.name, role: ctx.role, eventId: Number(e.id), title: e.title, startsAt: new Date(e.starts_at).toISOString(),
        when: formatEventDate(new Date(e.starts_at), e.timezone), timezone: e.timezone, venue: e.venue_name, counts: await checkinCounts(Number(e.id)),
      });
    }
  }
  out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return json({ events: out });
});
