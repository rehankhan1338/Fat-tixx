import { query, type Row } from '@/lib/db';
import { csvResponse, dollars, toCsv } from '@/lib/csv';
import { logExport, orgExportScope } from '@/lib/exports';
import { syncContacts } from '@/lib/pro/email-marketing';

/**
 * Email marketing contacts (Fattixx Pro) with their consent record: when and through which order they opted in, and
 * when and how they unsubscribed. Unsubscribed people are included so an import elsewhere does not email them.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const scope = await orgExportScope(new URL(req.url));
  if (scope instanceof Response) return scope;
  const { ctx } = scope;
  if (!ctx.isOrgAdmin && !ctx.perms.allEvents) return new Response('Forbidden', { status: 403 });
  await syncContacts(ctx.org.id);
  const rows = await query<Row>(
    `SELECT email, name, consent_at, consent_source, unsubscribed_at, unsubscribe_source, orders_count, tickets_count, spent_cents, first_order_at, last_order_at
       FROM marketing_contacts WHERE organization_id = ? ORDER BY email`, [ctx.org.id],
  );
  await logExport(ctx.session.user.id, 'marketing_contacts', { org: ctx.org.id, rows: rows.length });
  const body = toCsv(
    ['email', 'name', 'subscribed', 'opted_in_utc', 'opted_in_via', 'unsubscribed_utc', 'unsubscribed_via', 'orders', 'tickets', 'spent', 'first_order_utc', 'last_order_utc'],
    rows.map((r) => [r.email, r.name, r.unsubscribed_at ? 'no' : 'yes', r.consent_at, r.consent_source, r.unsubscribed_at, r.unsubscribe_source, r.orders_count, r.tickets_count,
      dollars(r.spent_cents), r.first_order_at, r.last_order_at]),
  );
  return csvResponse(`contacts-${ctx.org.slug}.csv`, body);
}
