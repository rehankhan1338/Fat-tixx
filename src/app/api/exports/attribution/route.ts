import { csvResponse, dollars, toCsv } from '@/lib/csv';
import { logExport, orgExportScope } from '@/lib/exports';
import { utmReport } from '@/lib/marketing/queries';

/** UTM / channel report for one event. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const scope = await orgExportScope(new URL(req.url));
  if (scope instanceof Response) return scope;
  if (!scope.eventId) return new Response('Choose an event', { status: 400 });
  const rows = await utmReport(scope.eventId);
  await logExport(scope.ctx.session.user.id, 'attribution', { eventId: scope.eventId });
  return csvResponse(`channels-event-${scope.eventId}.csv`, toCsv(
    ['utm_source', 'utm_medium', 'utm_campaign', 'channel', 'orders', 'tickets', 'ticket_revenue'],
    rows.map((r) => [r.source, r.medium, r.campaign, r.channel, r.orders, r.tickets, dollars(r.revenue_cents)]),
  ));
}
