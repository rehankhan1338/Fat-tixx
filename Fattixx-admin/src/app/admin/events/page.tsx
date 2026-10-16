import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff, hasPlatformRole } from "@/lib/auth/guard";
import { deleteEvent } from "@/lib/events/actions";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { query, queryOne, type Row } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";
import { parsePagination } from "@/lib/pagination";
import { PageHeader, Section, StatusBadge, EmptyState } from "@/components/shared";
import { TablePagination } from "@/components/table-pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Events" };

type Row_ = Row & { id: number; title: string; slug: string; status: string; visibility: string; starts_at: Date; timezone: string; currency: string; org_name: string; org_slug: string; sold: number; cap: number; gross: number; checked_in: number };

export default async function AdminEventsPage({ searchParams }: PageProps<"/admin/events">) {
  const session = await requirePlatformStaff(["super_admin", "finance"]);
  const isSuper = hasPlatformRole(session, "super_admin");
  const sp = await searchParams;
  const { page, perPage, offset } = parsePagination(sp);
  const [events, totalRow] = await Promise.all([
    query<Row_>(
      `SELECT e.id, e.title, e.slug, e.status, e.visibility, e.starts_at, e.timezone, e.currency, g.name AS org_name, g.slug AS org_slug,
              (SELECT COALESCE(SUM(t.sold),0) FROM ticket_types t WHERE t.event_id = e.id) AS sold,
              (SELECT COALESCE(SUM(t.quantity * t.seats_per_unit),0) FROM ticket_types t WHERE t.event_id = e.id) AS cap,
              (SELECT COALESCE(SUM(o.subtotal_cents - o.refunded_cents),0) FROM orders o WHERE o.event_id = e.id AND o.status IN ('paid','partially_refunded')) AS gross,
              (SELECT COUNT(*) FROM tickets k WHERE k.event_id = e.id AND k.status = 'used') AS checked_in
         FROM events e JOIN organizations g ON g.id = e.organization_id ORDER BY e.starts_at DESC LIMIT ? OFFSET ?`,
      [perPage, offset],
    ),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM events`),
  ]);
  const total = Number(totalRow?.n ?? 0);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="All events" description="Every event across every organization." />
      <Section>
        {events.length === 0 ? <EmptyState title={total === 0 ? "No events yet" : "No events on this page"} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Organization</TableHead><TableHead>When</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Checked in</TableHead><TableHead className="text-right">Net sales</TableHead>{isSuper ? <TableHead /> : null}</TableRow></TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell><Link href={`/org/${e.org_slug}/events/${e.id}`} className="font-medium hover:underline">{e.title}</Link><span className="block text-xs text-muted-foreground">/events/{e.slug}</span></TableCell>
                  <TableCell><Link href={`/admin/organizations/${e.org_slug}`} className="hover:underline">{e.org_name}</Link></TableCell>
                  <TableCell className="text-muted-foreground">{formatEventDate(new Date(e.starts_at), e.timezone)}</TableCell>
                  <TableCell><StatusBadge status={e.status} /></TableCell>
                  <TableCell className="text-right font-mono text-xs">{e.sold}/{e.cap}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.checked_in}</TableCell>
                  <TableCell className="text-right font-mono">{formatCents(Number(e.gross), e.currency)}</TableCell>
                  {isSuper ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" render={<Link href={`/org/${e.org_slug}/events/${e.id}?tab=details`} />}>Edit</Button>
                        <ConfirmButton action={deleteEvent} fields={{ org: e.org_slug, event_id: e.id }} title={`Delete “${e.title}”?`} description={Number(e.sold) > 0 ? `This event has ${e.sold} sold ticket(s). Deleting removes its orders, tickets and check-in records without refunds. Cancel the event instead if buyers must be refunded.` : "This cannot be undone."} confirmText="Delete" variant="ghost">Delete</ConfirmButton>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="mt-4"><TablePagination page={page} perPage={perPage} total={total} /></div>
      </Section>
    </div>
  );
}
