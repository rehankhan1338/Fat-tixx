import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DownloadIcon } from "lucide-react";
import { requireOrg } from "@/lib/authz";
import { orgEventPerformance, salesByDay } from "@/lib/analytics";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";
import { ColumnChart } from "@/components/charts/column-chart";
import { PageHeader, Section, Stat, StatusBadge } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Analytics" };

export default async function OrgAnalyticsPage({ params }: PageProps<"/org/[slug]/analytics">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  if (ctx.role === "staff") notFound();
  const [days, events] = await Promise.all([salesByDay({ orgId: ctx.org.id }, 60), orgEventPerformance(ctx.org.id)]);
  const currency = events[0]?.currency ?? "USD";
  const c = (n: number) => formatCents(n, currency);
  const last30 = days.slice(-30), prev30 = days.slice(0, 30);
  const sum = (a: typeof days, k: "tickets" | "revenue_cents" | "orders") => a.reduce((n, d) => n + d[k], 0);
  const change = (cur: number, prev: number) => (prev ? `${cur >= prev ? "+" : ""}${Math.round(((cur - prev) / prev) * 100)}% vs previous 30 days` : "No sales in the previous 30 days");
  const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const totalCap = events.reduce((n, e) => n + Number(e.capacity), 0), totalSold = events.reduce((n, e) => n + Number(e.sold), 0);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Analytics" description="Sales across all your events. Each event's Analytics tab has channels, promo codes and check-in timing."
        actions={<Button variant="outline" nativeButton={false} render={<a href={`/api/exports/orders?org=${slug}`} />}><DownloadIcon /> All orders CSV</Button>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tickets, last 30 days" value={sum(last30, "tickets").toLocaleString()} hint={change(sum(last30, "tickets"), sum(prev30, "tickets"))} />
        <Stat label="Ticket revenue, last 30 days" value={c(sum(last30, "revenue_cents"))} hint={change(sum(last30, "revenue_cents"), sum(prev30, "revenue_cents"))} />
        <Stat label="Orders, last 30 days" value={sum(last30, "orders").toLocaleString()} />
        <Stat label="Sell-through, all events" value={totalCap ? `${Math.round((totalSold / totalCap) * 100)}%` : "—"} hint={`${totalSold.toLocaleString()} of ${totalCap.toLocaleString()} seats`} />
      </div>
      <Section title="Tickets sold per day" description="Last 60 days, all events.">
        <ColumnChart data={days.map((d) => ({ label: short(d.day), value: d.tickets }))} valueLabel="tickets" height={180} />
      </Section>
      <Section title="Events">
        <Table>
          <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Sold</TableHead><TableHead className="text-right">Sell-through</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Net ticket sales</TableHead><TableHead className="text-right">Checked in</TableHead></TableRow></TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.id}>
                <TableCell><Link href={`/org/${slug}/events/${e.id}?tab=analytics`} className="font-medium hover:underline">{e.title}</Link><span className="block text-xs text-muted-foreground">{formatEventDate(new Date(e.starts_at), e.timezone)}</span></TableCell>
                <TableCell><StatusBadge status={e.status} /></TableCell>
                <TableCell className="text-right tabular-nums">{Number(e.sold)}/{Number(e.capacity)}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(e.capacity) ? `${Math.round((Number(e.sold) / Number(e.capacity)) * 100)}%` : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{e.orders}</TableCell>
                <TableCell className="text-right font-mono">{formatCents(Number(e.revenue_cents), e.currency)}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(e.checked_in)}{Number(e.sold) ? ` (${Math.round((Number(e.checked_in) / Number(e.sold)) * 100)}%)` : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}
