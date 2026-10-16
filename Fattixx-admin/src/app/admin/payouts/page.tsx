import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { countPayouts, dueCents, listPayouts, listSettlements, payoutTotals } from "@/lib/admin/finance-queries";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";
import { parsePagination } from "@/lib/pagination";
import { PageHeader, Section, Stat, StatusBadge, formatDate, EmptyState } from "@/components/shared";
import { TablePagination } from "@/components/table-pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ApproveSettlementDialog, MarkPaidDialog, VoidPayoutButton } from "./payout-dialogs";

export const metadata: Metadata = { title: "Payouts" };

export default async function PayoutsPage({ searchParams }: PageProps<"/admin/payouts">) {
  await requirePlatformStaff(["super_admin", "finance"]);
  const sp = await searchParams;
  const { page, perPage, offset } = parsePagination(sp);
  const [settlements, payouts, payoutCount, totals] = await Promise.all([listSettlements(), listPayouts(perPage, offset), countPayouts(), payoutTotals()]);
  const due = settlements.map((s) => ({ s, due: dueCents(s) }));
  const totalDue = due.reduce((n, d) => n + d.due, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Organizer payouts" description="What each event owes its organizer after refunds and absorbed fees. Approve a settlement, send the money by bank transfer or check, then record the payout." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Awaiting approval" value={formatCents(totalDue)} hint={`${due.filter((d) => d.due > 0).length} event(s) with a balance`} />
        <Stat label="Approved, not yet paid" value={formatCents(totals.approvedCents)} hint={`${totals.approvedCount} payout(s)`} />
        <Stat label="Paid out to date" value={formatCents(totals.paidCents)} hint={`${totals.paidCount} payout(s)`} />
      </div>

      <Section title="Settlements by event" description="Payout due = ticket revenue − refunds − fees absorbed by the organizer − amounts already approved or paid.">
        {settlements.length === 0 ? <EmptyState title="Nothing to settle yet" description="Events appear here once they have paid orders." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Organization</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Net revenue</TableHead><TableHead className="text-right">Absorbed fees</TableHead><TableHead className="text-right">Paid / approved</TableHead><TableHead className="text-right">Due</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {due.map(({ s, due: d }) => (
                <TableRow key={s.event_id}>
                  <TableCell><Link href={`/org/${s.org_slug}/events/${s.event_id}?tab=sales`} className="font-medium hover:underline">{s.event_title}</Link><span className="block text-xs text-muted-foreground">{formatEventDate(new Date(s.starts_at), "America/New_York", { withTime: false })} · {s.tickets} tickets · {s.paid_orders} orders</span></TableCell>
                  <TableCell>{s.legal_name ?? s.org_name}<span className="block text-xs text-muted-foreground">{s.org_name}</span></TableCell>
                  <TableCell><StatusBadge status={s.status} /></TableCell>
                  <TableCell className="text-right font-mono">{formatCents(Number(s.gross_cents) - Number(s.refunded_cents), s.currency)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">−{formatCents(Number(s.absorbed_cents), s.currency)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{formatCents(Number(s.paid_out_cents) + Number(s.approved_cents), s.currency)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{formatCents(d, s.currency)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" render={<Link href={`/org/${s.org_slug}/events/${s.event_id}/settlement`} target="_blank" />}>Statement</Button>
                      {d > 0 ? <ApproveSettlementDialog eventId={s.event_id} eventTitle={s.event_title} dueCents={d} currency={s.currency} /> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Payout history">
        {payouts.length === 0 ? <p className="text-sm text-muted-foreground">{payoutCount === 0 ? "No payouts approved yet." : "No payouts on this page."}</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Approved</TableHead><TableHead>Organization</TableHead><TableHead>Event</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Sent</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {payouts.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(p.approved_at)}<span className="block">{p.approved_by_name}</span></TableCell>
                  <TableCell>{p.org_name}</TableCell>
                  <TableCell className="max-w-56 truncate">{p.event_title ?? "—"}{p.notes ? <span className="block truncate text-xs text-muted-foreground">{p.notes}</span> : null}</TableCell>
                  <TableCell className="text-right font-mono">{formatCents(Number(p.amount_cents), p.currency)}</TableCell>
                  <TableCell><StatusBadge status={p.status === "approved" ? "pending" : p.status === "paid" ? "paid" : "cancelled"} /> <span className="ml-1 text-xs text-muted-foreground">{p.status}</span></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.paid_at ? <>{formatDate(p.paid_at)}<span className="block">{p.method}{p.reference ? ` · ${p.reference}` : ""}{p.paid_by_name ? ` · ${p.paid_by_name}` : ""}</span></> : "—"}</TableCell>
                  <TableCell className="text-right">{p.status === "approved" ? <div className="flex justify-end gap-1"><MarkPaidDialog payoutId={p.id} amountLabel={formatCents(Number(p.amount_cents), p.currency)} /><VoidPayoutButton payoutId={p.id} /></div> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="mt-4"><TablePagination page={page} perPage={perPage} total={payoutCount} /></div>
      </Section>
    </div>
  );
}
