import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/authz";
import { listVisibleEvents } from "@/lib/events/queries";
import { formatCents } from "@/lib/money";
import { orgIsPro } from "@/lib/pro/gate";
import { attendeeGeography, compareEvents, PACE_DAYS, refundBreakdown, refundTrend, type GeoRow } from "@/lib/pro/reports";
import { formatEventDate } from "@/lib/tz";
import { ColumnChart } from "@/components/charts/column-chart";
import { PageHeader, Section, Stat } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProUpsell, SubNav } from "@/components/pro/dashboard";

export const metadata: Metadata = { title: "Reports" };

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const TABS = ["refunds", "geography", "compare"] as const;

function GeoTable({ title, rows, total }: { title: string; rows: GeoRow[]; total: number }) {
  return (
    <Section title={title}>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No locations yet.</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>{title.replace(/^Top /, "")}</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Share</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}><TableCell>{r.key}</TableCell><TableCell className="text-right tabular-nums">{r.orders}</TableCell><TableCell className="text-right tabular-nums">{r.tickets}</TableCell><TableCell className="text-right tabular-nums">{total ? pct(r.orders / total) : "—"}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

export default async function ReportsPage({ params, searchParams }: PageProps<"/org/[slug]/reports">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug);
  if (ctx.role === "staff") notFound();
  const tab = TABS.find((t) => t === sp.tab) ?? "refunds";
  const base = `/org/${slug}/reports`;
  const nav = [{ href: base, label: "Refund trends" }, { href: `${base}?tab=geography`, label: "Where attendees are from" }, { href: `${base}?tab=compare`, label: "Compare events" }];
  const current = tab === "refunds" ? base : `${base}?tab=${tab}`;
  const header = (
    <>
      <PageHeader title="Reports" description="Advanced reports for Fattixx Pro: refund trends, where your attendees come from, and your events side by side." />
      <SubNav items={nav} current={current} />
    </>
  );
  if (!orgIsPro(ctx.org)) {
    return <div className="mx-auto max-w-6xl space-y-6">{header}<ProUpsell ctx={ctx} feature="Advanced reports" text="See refund trends, where attendees travel from and how your events compare. Basic sales reports stay on the Analytics page." /></div>;
  }

  const events = await listVisibleEvents(ctx, "all");
  // organizers who only see some events get reports on those events only
  const scope = ctx.isOrgAdmin || ctx.perms.allEvents ? null : events.map((e) => Number(e.id));
  const currency = events[0]?.currency ?? "USD";
  const c = (n: number, cur = currency) => formatCents(n, cur);

  if (tab === "refunds") {
    const [trend, breakdown] = await Promise.all([refundTrend(ctx.org.id, scope), refundBreakdown(ctx.org.id, scope)]);
    const gross = trend.reduce((n, m) => n + m.grossCents, 0), refunded = trend.reduce((n, m) => n + m.refundedCents, 0);
    const last3 = trend.slice(-3), prev3 = trend.slice(-6, -3);
    const rate = (a: typeof trend) => { const g = a.reduce((n, m) => n + m.grossCents, 0); return g ? a.reduce((n, m) => n + m.refundedCents, 0) / g : 0; };
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        {header}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Refunded, last 12 months" value={c(refunded)} hint={`${trend.reduce((n, m) => n + m.refunds, 0)} refunds`} />
          <Stat label="Refund rate, 12 months" value={pct(gross ? refunded / gross : 0, 1)} hint="Refunded ÷ sales" />
          <Stat label="Refund rate, last 3 months" value={pct(rate(last3), 1)} hint={`${pct(rate(prev3), 1)} the 3 months before`} />
          <Stat label="Most common" value={breakdown.reasons[0]?.reason ?? "—"} hint={breakdown.reasons[0] ? `${breakdown.reasons[0].count} refunds` : undefined} />
        </div>
        <Section title="Refunded per month" description="By the month the refund was made.">
          <ColumnChart data={trend.map((m) => ({ label: monthLabel(m.month), value: m.refundedCents, display: c(m.refundedCents) }))} valueLabel="refunded" height={180} emptyText="No refunds in the last 12 months." />
          <Table className="mt-4">
            <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Refunded</TableHead><TableHead className="text-right">Refunds</TableHead><TableHead className="text-right">Rate</TableHead></TableRow></TableHeader>
            <TableBody>
              {[...trend].reverse().map((m) => (
                <TableRow key={m.month}><TableCell>{monthLabel(m.month)}</TableCell><TableCell className="text-right font-mono">{c(m.grossCents)}</TableCell><TableCell className="text-right font-mono">{c(m.refundedCents)}</TableCell><TableCell className="text-right tabular-nums">{m.refunds}</TableCell><TableCell className="text-right tabular-nums">{m.grossCents ? pct(m.rate, 1) : "—"}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="When refunds happen" description="Time between the refund and the event start.">
            <ColumnChart data={breakdown.timing.map((t) => ({ label: t.bucket, value: t.count }))} valueLabel="refunds" height={140} emptyText="No refunds yet." />
          </Section>
          <Section title="Reasons">
            {breakdown.reasons.length === 0 ? <p className="text-sm text-muted-foreground">No refunds yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Reason</TableHead><TableHead className="text-right">Refunds</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>{breakdown.reasons.map((r) => <TableRow key={r.reason}><TableCell className="text-sm">{r.reason}</TableCell><TableCell className="text-right tabular-nums">{r.count}</TableCell><TableCell className="text-right font-mono">{c(r.amountCents)}</TableCell></TableRow>)}</TableBody>
              </Table>
            )}
            {breakdown.kinds.length ? <p className="mt-3 text-xs text-muted-foreground">{breakdown.kinds.map((k) => `${k.kind.replace(/_/g, " ")}: ${k.count}`).join(" · ")}</p> : null}
          </Section>
        </div>
        <Section title="Events with the most refunds" description="Highest share of sales refunded first.">
          {breakdown.events.length === 0 ? <p className="text-sm text-muted-foreground">No refunds yet.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Event</TableHead><TableHead className="text-right">Orders refunded</TableHead><TableHead className="text-right">Refunded</TableHead><TableHead className="text-right">Rate</TableHead></TableRow></TableHeader>
              <TableBody>{breakdown.events.map((e) => <TableRow key={e.id}><TableCell>{e.title}</TableCell><TableCell className="text-right tabular-nums">{e.refundedOrders} of {e.orders}</TableCell><TableCell className="text-right font-mono">{c(e.refundedCents, e.currency)}</TableCell><TableCell className="text-right tabular-nums">{pct(e.grossCents ? e.refundedCents / e.grossCents : 0, 1)}</TableCell></TableRow>)}</TableBody>
            </Table>
          )}
        </Section>
      </div>
    );
  }

  if (tab === "geography") {
    const eventId = Number(sp.event) || null;
    const ids = eventId ? (events.some((e) => Number(e.id) === eventId) ? [eventId] : []) : scope;
    const g = await attendeeGeography(ctx.org.id, ids);
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        {header}
        <form action={base} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="geography" />
          <select name="event" defaultValue={eventId ? String(eventId) : ""} aria-label="Event" className="h-10 min-w-[260px] rounded-lg border bg-white px-3 text-sm">
            <option value="">All events</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <Button type="submit" variant="outline">Show</Button>
        </form>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Orders with a location" value={g.orders ? pct(g.located / g.orders) : "—"} hint={`${g.located} of ${g.orders}. From the card's billing address; box office and free orders have none.`} />
          <Stat label="From another state" value={g.comparable ? pct(g.fromAway / g.comparable) : "—"} hint={g.comparable ? `${g.fromAway} of ${g.comparable} orders where both are known` : "Needs the buyer's and the venue's state"} />
          <Stat label="Top country" value={g.countries[0]?.key ?? "—"} hint={g.countries[0] ? `${g.countries[0].tickets} tickets` : undefined} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <GeoTable title="Top states / regions" rows={g.regions} total={g.located} />
          <GeoTable title="Top postal codes" rows={g.postalCodes} total={g.located} />
          <GeoTable title="Top cities" rows={g.cities} total={g.located} />
          <GeoTable title="Countries" rows={g.countries} total={g.located} />
        </div>
      </div>
    );
  }

  // compare
  const picked = (Array.isArray(sp.e) ? sp.e : typeof sp.e === "string" ? [sp.e] : []).map(Number).filter((id) => events.some((e) => Number(e.id) === id)).slice(0, 5);
  const rows = picked.length >= 2 ? await compareEvents(ctx.org.id, picked) : [];
  const metric = (label: string, f: (r: (typeof rows)[number]) => string) => (
    <TableRow key={label}><TableCell className="font-medium">{label}</TableCell>{rows.map((r) => <TableCell key={r.id} className="text-right tabular-nums">{f(r)}</TableCell>)}</TableRow>
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {header}
      <Section title="Choose 2 to 5 events">
        <form action={base} className="space-y-3">
          <input type="hidden" name="tab" value="compare" />
          <div className="grid max-h-64 gap-1 overflow-y-auto rounded-xl border bg-white p-3 sm:grid-cols-2">
            {events.map((e) => (
              <label key={e.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="e" value={e.id} defaultChecked={picked.includes(Number(e.id))} className="size-4" />
                <span className="truncate">{e.title}</span><span className="shrink-0 text-xs text-muted-foreground">{formatEventDate(new Date(e.starts_at), e.timezone, { withTime: false })}</span>
              </label>
            ))}
          </div>
          <Button type="submit">Compare</Button>
        </form>
      </Section>
      {picked.length >= 2 ? (
        <>
          <Section title="Side by side">
            <Table>
              <TableHeader><TableRow><TableHead />{rows.map((r) => <TableHead key={r.id} className="text-right">{r.title}<span className="block text-xs font-normal text-muted-foreground">{formatEventDate(r.startsAt, r.timezone, { withTime: false })}</span></TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {metric("Tickets sold", (r) => `${r.sold.toLocaleString()} / ${r.capacity.toLocaleString()}`)}
                {metric("Sell-through", (r) => (r.capacity ? pct(r.sold / r.capacity) : "—"))}
                {metric("Orders", (r) => r.orders.toLocaleString())}
                {metric("Sales", (r) => c(r.grossCents, r.currency))}
                {metric("Refunded", (r) => `${c(r.refundedCents, r.currency)} (${pct(r.grossCents ? r.refundedCents / r.grossCents : 0, 1)})`)}
                {metric("Net sales", (r) => c(r.netCents, r.currency))}
                {metric("Average order", (r) => c(r.avgOrderCents, r.currency))}
                {metric("Orders with a promo code", (r) => (r.orders ? pct(r.promoOrders / r.orders) : "—"))}
                {metric("Checked in", (r) => (r.sold ? `${r.checkedIn} (${pct(r.checkedIn / r.sold)})` : "—"))}
                {metric("Days on sale before the event", (r) => (r.daysOnSale === null ? "—" : String(r.daysOnSale)))}
              </TableBody>
            </Table>
          </Section>
          <Section title="Sales pace" description="Share of each event's final paid tickets already sold, by days before the event.">
            <Table>
              <TableHeader><TableRow><TableHead>Days before</TableHead>{rows.map((r) => <TableHead key={r.id} className="text-right">{r.title}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {PACE_DAYS.map((d, i) => (
                  <TableRow key={d}><TableCell>{d === 0 ? "At the start" : `${d} days`}</TableCell>{rows.map((r) => <TableCell key={r.id} className="text-right tabular-nums">{pct(r.pace[i])}</TableCell>)}</TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        </>
      ) : picked.length === 1 ? <p className="text-sm text-muted-foreground">Pick at least one more event.</p> : null}
    </div>
  );
}
