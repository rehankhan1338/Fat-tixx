import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEventBySlug, listAddons, listEventDates, listQuestions, listTicketTypes, publicEventPath, questionOptions, ticketTypeAvailable, ticketTypeOnSale, addonAvailable } from "@/lib/events/queries";
import { allInAddonCents, allInUnitCents, effectiveTaxBps, expireStaleHolds, feeConfigForEvent } from "@/lib/orders/checkout";
import { query, type Row } from "@/lib/db";
import { env } from "@/lib/env";
import { processingLabel } from "@/lib/home/pricing";
import { isSmsConfigured } from "@/lib/sms";
import { formatEventDate } from "@/lib/tz";
import { TicketSelector } from "@/app/events/[slug]/ticket-selector";
import { EmbedResizer } from "./embed-resizer";

export const metadata: Metadata = { title: "Tickets", robots: { index: false, follow: false } };

/**
 * Embeddable checkout widget (plan 5.2): organizers put Fattixx ticket selection on their own website
 * with <script src="/embed.js" data-event="slug">. Selection happens here, inside the iframe; payment
 * always continues on the Fattixx site in a new tab, so card fields are never inside someone else's page.
 */
export default async function EmbedPage({ params, searchParams }: PageProps<"/embed/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const event = await getPublicEventBySlug(slug);
  // Only public / unlisted published events can be embedded; private events need their link key.
  if (!event || !["published", "postponed"].includes(event.status) || event.org_status !== "active") notFound();
  if (event.visibility === "private" && (typeof sp.key !== "string" || sp.key !== event.private_key)) notFound();
  await expireStaleHolds();
  const [types, fees, dates, addons, questions, promos] = await Promise.all([
    listTicketTypes(event.id), feeConfigForEvent(event), listEventDates(event.id), listAddons(event.id), listQuestions(event.id),
    query<Row & { n: number }>(`SELECT COUNT(*) AS n FROM promo_codes WHERE event_id = ? AND active = 1`, [event.id]),
  ]);
  const taxBps = effectiveTaxBps(event);
  const dayLabel = (id: number | null) => { const d = dates.find((x) => Number(x.id) === Number(id)); return d ? d.label ?? formatEventDate(new Date(d.starts_at), event.timezone, { withTime: false }) : null; };
  // Reserved seats are picked on the event page's seat map (too small to use inside someone else's page).
  const seated = types.some((t) => t.seated && !t.hidden);
  const options = types.filter((t) => !t.hidden && !t.seated).map((t) => {
    const sale = ticketTypeOnSale(t);
    return {
      id: Number(t.id), name: t.name, description: t.description, kind: t.kind, priceCents: Number(t.price_cents), allInCents: allInUnitCents(Number(t.price_cents), fees, taxBps, event.fee_mode),
      available: ticketTypeAvailable(t), min: Number(t.min_per_order), max: Number(t.max_per_order), seats: Number(t.seats_per_unit), onSale: sale.onSale, reason: sale.reason,
      salesStart: t.sales_start_at ? formatEventDate(new Date(t.sales_start_at), event.timezone) : null, dayLabel: t.event_date_id ? dayLabel(t.event_date_id) : null,
    };
  });
  const addonOptions = addons.filter((a) => a.active).map((a) => ({ id: Number(a.id), name: a.name, description: a.description, priceCents: Number(a.price_cents), allInCents: allInAddonCents(Number(a.price_cents), fees, taxBps, event.fee_mode), available: addonAvailable(a), max: Number(a.max_per_order) }));
  const fullUrl = `${env.APP_URL}${publicEventPath(event)}`;
  const attribution = { ref: typeof sp.ref === "string" ? sp.ref : undefined, utm_source: typeof sp.utm_source === "string" ? sp.utm_source : "embed", utm_medium: typeof sp.utm_medium === "string" ? sp.utm_medium : "widget", utm_campaign: typeof sp.utm_campaign === "string" ? sp.utm_campaign : undefined };

  return (
    <main className="space-y-4 p-4">
      <EmbedResizer />
      <header>
        <h1 className="text-lg font-semibold leading-tight">{event.title}</h1>
        <p className="text-sm text-muted-foreground">{formatEventDate(new Date(event.starts_at), event.timezone)}{event.venue_name ? ` · ${event.venue_name}` : ""}</p>
      </header>
      {event.access_password ? (
        // a third-party iframe can't keep the unlock cookie; the password is typed on Fattixx itself
        <p className="rounded-lg border p-3 text-sm">This event is password protected. <Link href={fullUrl} target="_blank" rel="noopener" className="font-medium underline">Open the event page</Link> and enter the password from the organizer.</p>
      ) : event.queue_enabled ? (
        <p className="rounded-lg border p-3 text-sm">Tickets for this event are sold through a waiting room. <Link href={fullUrl} target="_blank" rel="noopener" className="font-medium underline">Open the event page to join the line</Link>.</p>
      ) : options.length === 0 && !seated ? <p className="text-sm text-muted-foreground">No tickets available.</p> : options.length === 0 ? null : (
        <TicketSelector eventSlug={event.slug} currency={event.currency} options={options} addons={addonOptions} channel="embed" attribution={attribution} hasPromo={Number(promos[0]?.n) > 0} smsEnabled={isSmsConfigured()}
          questions={questions.map((q) => ({ id: Number(q.id), label: q.label, kind: q.kind, required: !!q.required, options: questionOptions(q) }))} ageRestriction={event.age_restriction} />
      )}
      {seated && !event.access_password && !event.queue_enabled ? (
        <p className="rounded-lg border p-3 text-sm">This event has reserved seating. <Link href={fullUrl} target="_blank" rel="noopener" className="font-medium underline">Pick your seats on the seat map</Link>.</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {event.fee_mode === "buyer_pays" ? `Prices include the service fee${taxBps ? " and tax" : ""}${processingLabel(fees) ? `; a processing fee of ${processingLabel(fees)} is added at checkout.` : ". No additional charges at checkout."}` : "Prices include all fees."}
        {" "}Secure checkout by <Link href={fullUrl} target="_blank" rel="noopener" className="underline">Fattixx</Link>.
      </p>
    </main>
  );
}
