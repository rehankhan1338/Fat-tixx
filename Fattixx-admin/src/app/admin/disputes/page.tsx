import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { countDisputes, listDisputes, openDisputeTotals } from "@/lib/admin/finance-queries";
import { getActiveStripe } from "@/lib/payments/stripe";
import { syncDisputesFromStripe } from "@/lib/admin/finance-actions";
import { formatCents } from "@/lib/money";
import { parsePagination } from "@/lib/pagination";
import { PageHeader, Section, formatDate, EmptyState } from "@/components/shared";
import { TablePagination } from "@/components/table-pagination";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmButton } from "@/components/confirm-button";
import { DisputeDialog } from "./dispute-dialog";

export const metadata: Metadata = { title: "Disputes" };

export default async function DisputesPage({ searchParams }: PageProps<"/admin/disputes">) {
  await requirePlatformStaff(["super_admin", "finance"]);
  const sp = await searchParams;
  const { page, perPage, offset } = parsePagination(sp);
  const [disputes, total, open, active] = await Promise.all([listDisputes(perPage, offset), countDisputes(), openDisputeTotals(), getActiveStripe()]);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Chargebacks & disputes"
        description="Disputes arrive automatically from Stripe. Check-in records and order details are your evidence; respond in the Stripe Dashboard before the due date."
        actions={active ? <ConfirmButton action={syncDisputesFromStripe} title="Sync disputes from Stripe?" description={`Pulls open and recent disputes from the ${active.mode} account and updates their status here.`} confirmText="Sync" variant="outline" size="default" successText="Synced">Sync from Stripe</ConfirmButton> : null}
      />
      {!active ? <Alert><AlertTitle>Stripe is not configured</AlertTitle><AlertDescription>Disputes appear here once Stripe keys are added under Payments and the webhook is connected.</AlertDescription></Alert> : null}
      <Section title={`Open disputes (${open.count})`} description={open.count ? `${formatCents(open.cents)} under dispute · ${total.toLocaleString()} total` : undefined}>
        {disputes.length === 0 ? <EmptyState title={total === 0 ? "No disputes" : "No disputes on this page"} description={total === 0 ? "Nothing has been charged back. Keep check-in records tidy; they win disputes." : undefined} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Opened</TableHead><TableHead>Order</TableHead><TableHead>Event</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead>Evidence due</TableHead><TableHead>Checked in</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {disputes.map((d) => (
                <TableRow key={d.id} className={d.closed_at ? "opacity-60" : ""}>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(d.opened_at)}</TableCell>
                  <TableCell><Link href={`/org/${d.org_slug}/orders/${d.order_code}`} className="font-mono text-xs hover:underline">{d.order_code}</Link><span className="block text-xs text-muted-foreground">{d.buyer_email}</span></TableCell>
                  <TableCell className="max-w-48 truncate">{d.event_title}<span className="block text-xs text-muted-foreground">{d.org_name}</span></TableCell>
                  <TableCell className="text-right font-mono">{formatCents(Number(d.amount_cents), d.currency)}{Number(d.fee_cents) ? <span className="block text-xs text-muted-foreground">+ {formatCents(Number(d.fee_cents), d.currency)} fee</span> : null}</TableCell>
                  <TableCell className="text-xs">{d.reason?.replace(/_/g, " ") ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={d.closed_at ? "" : "border-red-500/40 text-red-700"}>{d.status.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.evidence_due_at ? formatDate(d.evidence_due_at) : "—"}</TableCell>
                  <TableCell className="text-xs">{Number(d.checkins) > 0 ? <span className="text-emerald-700">{d.checkins} ticket(s) scanned</span> : <span className="text-muted-foreground">not scanned</span>}</TableCell>
                  <TableCell className="text-right"><DisputeDialog dispute={{ id: d.id, code: d.order_code, status: d.status, notes: d.notes, evidenceDue: d.evidence_due_at ? new Date(d.evidence_due_at).toISOString().slice(0, 16) : "", closed: !!d.closed_at, stripeId: d.stripe_dispute_id }} /></TableCell>
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
