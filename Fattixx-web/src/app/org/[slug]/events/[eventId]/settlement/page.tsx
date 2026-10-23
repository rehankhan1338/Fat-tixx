import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg, canAccessEvent } from "@/lib/authz";
import { getEvent } from "@/lib/events/queries";
import { eventSalesSummary } from "@/lib/orders/queries";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";

export const metadata: Metadata = { title: "Settlement statement" };

export default async function SettlementPage({ params }: PageProps<"/org/[slug]/events/[eventId]/settlement">) {
  const { slug, eventId } = await params;
  const ctx = await requireOrg(slug, "organizer");
  const event = await getEvent(ctx.org.id, Number(eventId));
  if (!event || !(await canAccessEvent(ctx, event))) notFound();
  const s = await eventSalesSummary(event.id);
  const c = (n: number) => formatCents(n, event.currency);
  const row = (label: string, value: string, strong = false) => (
    <tr className={strong ? "font-semibold" : ""}><td className="py-1.5 pr-8">{label}</td><td className="py-1.5 text-right font-mono">{value}</td></tr>
  );
  return (
    <main className="mx-auto max-w-2xl bg-white p-10 text-black print:p-0" style={{ colorScheme: "light" }}>
      <header className="mb-8 flex items-start justify-between border-b pb-4">
        <div><p className="text-xs uppercase tracking-widest text-neutral-500">Fattixx · Settlement statement</p><h1 className="mt-1 text-2xl font-bold">{event.title}</h1><p className="text-sm text-neutral-600">{formatEventDate(new Date(event.starts_at), event.timezone)}{event.venue_name ? ` · ${event.venue_name}` : ""}</p></div>
        <div className="text-right text-sm"><p className="font-semibold">{ctx.org.legal_name ?? ctx.org.name}</p><p className="text-neutral-600">{ctx.org.contact_email}</p><p className="text-neutral-500">Generated {new Date().toLocaleDateString()}</p></div>
      </header>
      <table className="w-full text-sm"><tbody>
        {row("Paid orders", String(s.paidOrders))}
        {row("Tickets issued (incl. complimentary)", `${s.ticketsSold} (${s.compTickets} comps)`)}
        {row("Gross sales (tickets + add-ons)", c(s.grossCents))}
        {row("Refunds", `−${c(s.refundedCents)}`)}
        {row("Platform fees absorbed by organizer", `−${c(s.absorbedFeesCents)}`)}
        {row("Net payout to organizer", c(s.payoutCents), true)}
        {s.connectTransferredCents ? row("Of which sent to your Stripe account with each sale (before refunds)", c(s.connectTransferredCents)) : null}
      </tbody></table>
      <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">Collected from buyers (not organizer revenue)</h2>
      <table className="w-full text-sm"><tbody>
        {row("Service fees paid by buyers", c(s.buyerFeesCents))}
        {row("Processing fees paid by buyers", c(s.processingFeesCents))}
        {row("Tax collected", c(s.taxCents))}
      </tbody></table>
      <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">By ticket type</h2>
      <table className="w-full text-sm"><tbody>{s.byType.map((t) => <tr key={t.name}><td className="py-1.5 pr-8">{t.name}</td><td className="py-1.5 text-right tabular-nums">{t.sold}</td><td className="py-1.5 text-right font-mono">{c(t.grossCents)}</td></tr>)}</tbody></table>
      {s.byAddon.length ? (<>
        <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">Add-ons</h2>
        <table className="w-full text-sm"><tbody>{s.byAddon.map((a) => <tr key={a.name}><td className="py-1.5 pr-8">{a.name}</td><td className="py-1.5 text-right tabular-nums">{a.sold}</td><td className="py-1.5 text-right font-mono">{c(a.grossCents)}</td></tr>)}</tbody></table>
      </>) : null}
      <p className="mt-10 text-xs text-neutral-500">Fee mode: {event.fee_mode === "buyer_pays" ? "buyer pays fees" : "organizer absorbs fees"}. Figures reflect orders up to the generation time; disputes and chargebacks, if any, are adjusted separately.</p>
      <p className="mt-6 text-xs text-neutral-400 print:hidden">Use your browser’s Print command to save as PDF.</p>
    </main>
  );
}
