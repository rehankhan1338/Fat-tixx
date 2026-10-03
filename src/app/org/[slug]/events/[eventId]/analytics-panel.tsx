import { DownloadIcon } from "lucide-react";
import { buyerMetrics, checkinsByQuarterHour, checkoutFunnel, salesByDay, ticketTypeBreakdown } from "@/lib/analytics";
import { listPromoCodes, listTrackingLinks, promoLabel, utmReport } from "@/lib/marketing/queries";
import { formatCents } from "@/lib/money";
import { ColumnChart, ShareBars } from "@/components/charts/column-chart";
import { Section, Stat } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Event analytics tab (plan 5.2 "Advanced analytics and reporting"). Server component; charts hydrate on the client. */
export async function AnalyticsPanel({ orgId, orgSlug, event }: { orgId: number; orgSlug: string; event: { id: number; currency: string; timezone: string } }) {
  const [days, types, funnel, buyers, checkins, utm, links, promos] = await Promise.all([
    salesByDay({ eventId: event.id }, 30), ticketTypeBreakdown(event.id), checkoutFunnel(event.id), buyerMetrics(event.id),
    checkinsByQuarterHour(event.id, event.timezone), utmReport(event.id), listTrackingLinks(orgId, event.id), listPromoCodes(event.id),
  ]);
  const c = (n: number) => formatCents(n, event.currency);
  const conversion = funnel.started ? Math.round((funnel.paid / funnel.started) * 100) : 0;
  const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/exports/orders?org=${orgSlug}&event=${event.id}`} />}><DownloadIcon /> Orders CSV</Button>
        <Button variant="outline" size="sm" nativeButton={false} render={<a href={`/api/exports/attribution?org=${orgSlug}&event=${event.id}`} />}><DownloadIcon /> Channels CSV</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Checkout conversion" value={`${conversion}%`} hint={`${funnel.paid} paid of ${funnel.started} started · ${funnel.abandoned} abandoned`} />
        <Stat label="Average order" value={c(buyers.avgOrderCents)} hint={`${buyers.ticketsPerOrder.toFixed(1)} tickets per order`} />
        <Stat label="Returning buyers" value={buyers.orders ? `${Math.round((buyers.returning / buyers.orders) * 100)}%` : "—"} hint={`${buyers.returning} bought another of your events`} />
        <Stat label="Marketing opt-in" value={buyers.orders ? `${Math.round((buyers.optedIn / buyers.orders) * 100)}%` : "—"} hint={`${buyers.optedIn} buyers`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Tickets sold per day" description="Last 30 days (UTC days), paid orders.">
          <ColumnChart data={days.map((d) => ({ label: short(d.day), value: d.tickets }))} valueLabel="tickets" />
        </Section>
        <Section title="Ticket revenue per day" description="Ticket price after discounts, before fees and tax.">
          <ColumnChart data={days.map((d) => ({ label: short(d.day), value: d.revenue_cents, display: c(d.revenue_cents) }))} valueLabel="revenue" />
        </Section>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Sales by ticket type">
          <ShareBars rows={types.map((t) => ({ label: t.name, value: Number(t.revenue_cents), display: c(Number(t.revenue_cents)), sub: `${t.sold}/${t.quantity}${Number(t.discount_cents) ? ` · ${c(Number(t.discount_cents))} discounted` : ""}` }))} />
        </Section>
        <Section title="Sales channels" description={`${funnel.online} online · ${funnel.boxOffice} box office · ${funnel.comps} complimentary · ${funnel.embed} via embedded widget`}>
          <ShareBars rows={utm.map((u) => ({ label: `${u.source} / ${u.medium}`, value: Number(u.revenue_cents), display: c(Number(u.revenue_cents)), sub: `${u.orders} orders${u.campaign !== "—" ? ` · ${u.campaign}` : ""}${u.channel === "embed" ? " · widget" : ""}` }))} />
        </Section>
      </div>
      <Section title="Promoter links" description="Clicks are counted when someone opens the link; orders are attributed for 7 days.">
        {links.length === 0 ? <p className="text-sm text-muted-foreground">No tracking links yet. Create them under Marketing in the sidebar.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Link</TableHead><TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Conversion</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
            <TableBody>{links.map((l) => (
              <TableRow key={l.id}><TableCell>{l.name}<span className="block font-mono text-xs text-muted-foreground">/r/{l.code}</span></TableCell><TableCell className="text-right tabular-nums">{l.clicks}</TableCell><TableCell className="text-right tabular-nums">{l.orders}</TableCell><TableCell className="text-right tabular-nums">{l.clicks ? `${((Number(l.orders) / Number(l.clicks)) * 100).toFixed(1)}%` : "—"}</TableCell><TableCell className="text-right tabular-nums">{l.tickets}</TableCell><TableCell className="text-right font-mono">{c(Number(l.revenue_cents))}</TableCell></TableRow>
            ))}</TableBody>
          </Table>
        )}
      </Section>
      <Section title="Promo code performance">
        {promos.length === 0 ? <p className="text-sm text-muted-foreground">No promo codes.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Discount</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Discount given</TableHead></TableRow></TableHeader>
            <TableBody>{promos.map((p) => <TableRow key={p.id}><TableCell className="font-mono">{p.code}</TableCell><TableCell>{promoLabel(p, event.currency)}</TableCell><TableCell className="text-right tabular-nums">{p.used}{p.max_uses ? ` / ${p.max_uses}` : ""}</TableCell><TableCell className="text-right font-mono">{c(Number(p.discount_total))}</TableCell></TableRow>)}</TableBody>
          </Table>
        )}
      </Section>
      <Section title="Check-ins every 15 minutes" description="When people arrived, in the event's time zone. Useful for staffing the doors next time.">
        <ColumnChart data={checkins} valueLabel="check-ins" emptyText="No check-ins yet." />
      </Section>
    </div>
  );
}
