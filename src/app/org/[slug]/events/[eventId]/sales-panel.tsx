import Link from "next/link";
import type { SalesSummary } from "@/lib/orders/queries";
import { formatCents } from "@/lib/money";
import { Section, Stat } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export function SalesPanel({ orgSlug, event, sales }: { orgSlug: string; event: { id: number; currency: string; fee_mode: string }; sales: SalesSummary }) {
  const c = (n: number) => formatCents(n, event.currency);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gross sales" value={c(sales.grossCents)} hint={`${sales.paidOrders} orders · ${sales.ticketsSold} tickets (${sales.compTickets} comps)${sales.addonGrossCents ? ` · incl. ${c(sales.addonGrossCents)} add-ons` : ""}`} />
        <Stat label="Refunds" value={c(sales.refundedCents)} hint={`${sales.refundsCount} refund(s)`} />
        <Stat label={event.fee_mode === "buyer_pays" ? "Fees paid by buyers" : "Fees absorbed"} value={c(event.fee_mode === "buyer_pays" ? sales.buyerFeesCents + sales.processingFeesCents : sales.absorbedFeesCents)} hint={event.fee_mode === "buyer_pays" ? "Not deducted from you" : "Deducted from payout"} />
        <Stat label="Estimated payout" value={c(sales.payoutCents)} hint="Gross − refunds − absorbed fees" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Sales by ticket type">
          <Table>
            <TableHeader><TableRow><TableHead>Ticket type</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Gross</TableHead></TableRow></TableHeader>
            <TableBody>
              {sales.byType.map((t) => <TableRow key={t.name}><TableCell>{t.name}</TableCell><TableCell className="text-right tabular-nums">{t.sold}</TableCell><TableCell className="text-right font-mono">{c(t.grossCents)}</TableCell></TableRow>)}
              {sales.byAddon.map((a) => <TableRow key={`addon-${a.name}`}><TableCell>{a.name} <span className="text-xs text-muted-foreground">add-on</span></TableCell><TableCell className="text-right tabular-nums">{a.sold}</TableCell><TableCell className="text-right font-mono">{c(a.grossCents)}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </Section>

        <Section title="Settlement statement" description="Per-event summary for reconciliation. Taxes collected are reported separately." actions={<Button variant="outline" size="sm" render={<Link href={`/org/${orgSlug}/events/${event.id}/settlement`} target="_blank" />}>Printable</Button>}>
          <Table>
            <TableBody>
              <TableRow><TableCell>Gross ticket sales</TableCell><TableCell className="text-right font-mono">{c(sales.grossCents)}</TableCell></TableRow>
              <TableRow><TableCell>Refunds</TableCell><TableCell className="text-right font-mono">−{c(sales.refundedCents)}</TableCell></TableRow>
              <TableRow><TableCell>Platform fees absorbed by organizer</TableCell><TableCell className="text-right font-mono">−{c(sales.absorbedFeesCents)}</TableCell></TableRow>
              <TableRow className="font-semibold"><TableCell>Net payout to organizer</TableCell><TableCell className="text-right font-mono">{c(sales.payoutCents)}</TableCell></TableRow>
              <TableRow><TableCell className="text-muted-foreground">Service fees paid by buyers (platform revenue)</TableCell><TableCell className="text-right font-mono text-muted-foreground">{c(sales.buyerFeesCents)}</TableCell></TableRow>
              <TableRow><TableCell className="text-muted-foreground">Processing fees paid by buyers</TableCell><TableCell className="text-right font-mono text-muted-foreground">{c(sales.processingFeesCents)}</TableCell></TableRow>
              <TableRow><TableCell className="text-muted-foreground">Tax collected (remit per seller-of-record decision)</TableCell><TableCell className="text-right font-mono text-muted-foreground">{c(sales.taxCents)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </Section>
      </div>
      <p className="text-xs text-muted-foreground"><Link href={`/org/${orgSlug}/orders?event=${event.id}`} className="underline-offset-4 hover:underline">View all orders for this event</Link></p>
    </div>
  );
}
