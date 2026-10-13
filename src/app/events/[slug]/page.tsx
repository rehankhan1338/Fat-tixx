import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  accessCodeMatches, addonAvailable, getPublicEventBySlug, listAddons, listEventDates, listQuestions, listSeriesSiblings, listTicketTypes, publicEventPath, questionOptions, ticketTypeAvailable, ticketTypeOnSale,
} from "@/lib/events/queries";
import { allInAddonCents, allInUnitCents, effectiveTaxBps, expireStaleHolds, feeConfigForEvent } from "@/lib/orders/checkout";
import { leaveWaitlist } from "@/lib/waitlist/actions";
import { getSession } from "@/lib/auth/session";
import { listMemberships } from "@/lib/authz";
import { brandingForLayout } from "@/lib/branding";
import { env } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { formatEventDate, formatTimeOnly, utcToWallClock } from "@/lib/tz";
import { uploadUrl } from "@/lib/uploads";
import { query, type Row } from "@/lib/db";
import { isAdmitted } from "@/lib/queue";
import { isSmsConfigured } from "@/lib/sms";
import { listVisibleSponsors } from "@/lib/sponsors";
import { organizerEventCount, organizerOf, publicEvents, relatedEvents, toEventItems } from "@/lib/home/data";
import { endOf, isoLocal } from "@/lib/home/event-page";
import type { EventPageData, TicketStatus, TicketType } from "@/lib/home/event-page";
import { AdSlot } from "@/components/ad-slot";
import { TrackingPixels } from "@/components/tracking-pixels";
import EventPage from "@/components/event/EventPage";
import TicketPanel from "@/components/event/TicketPanel";
import { PublicPage } from "@/components/layout/PublicPage";

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const e = await getPublicEventBySlug(slug);
  if (!e) return { title: "Event not found" };
  const img = e.image_path ? `${env.APP_URL}${uploadUrl(e.image_path)}` : e.org_logo ? `${env.APP_URL}${uploadUrl(e.org_logo)}` : undefined;
  const description = e.summary ?? `${e.title} — ${formatEventDate(new Date(e.starts_at), e.timezone)}${e.venue_name ? ` at ${e.venue_name}` : ""}.`;
  return {
    title: e.title, description,
    robots: e.visibility === "public" ? { index: true, follow: true } : { index: false, follow: false },
    alternates: { canonical: `/events/${e.slug}` },
    openGraph: { title: e.title, description, images: img ? [{ url: img, alt: e.title }] : undefined, type: "website", url: `/events/${e.slug}` },
    twitter: { card: img ? "summary_large_image" : "summary", title: e.title, description, images: img ? [img] : undefined },
  };
}

export default async function EventRoute({ params, searchParams }: PageProps<"/events/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const event = await getPublicEventBySlug(slug);
  if (!event) notFound();
  await expireStaleHolds();
  const session = await getSession();
  // Drafts and private events are visible to the organizer's team / platform staff (preview) without the link key.
  const isTeam = !!session && (session.user.roles.length > 0 || (await listMemberships(session.user.id)).some((m) => m.organization_id === event.organization_id));
  const isLive = ["published", "postponed"].includes(event.status);
  if (!isLive && !isTeam) notFound();
  const linkKey = typeof sp.key === "string" ? sp.key : null;
  if (event.visibility === "private" && !isTeam && (!event.private_key || linkKey !== event.private_key)) notFound();

  // Waitlist unsubscribe link from the email.
  const leftWaitlist = typeof sp.leave === "string" ? await leaveWaitlist(sp.leave) : false;

  const accessCode = typeof sp.code === "string" ? sp.code.trim() : "";
  const [types, fees, dates, addons, questions, siblings, sponsors, promos, admitted, brand, allEvents, orgCount] = await Promise.all([
    listTicketTypes(event.id), feeConfigForEvent(event), listEventDates(event.id), listAddons(event.id), listQuestions(event.id),
    event.series_id ? listSeriesSiblings(event.series_id, event.id) : Promise.resolve([]),
    listVisibleSponsors(event.id),
    query<Row & { n: number }>(`SELECT COUNT(*) AS n FROM promo_codes WHERE event_id = ? AND active = 1 AND (ends_at IS NULL OR ends_at > NOW())`, [event.id]),
    event.queue_enabled && !isTeam ? isAdmitted(event.id) : Promise.resolve(true),
    brandingForLayout(),
    publicEvents(),
    organizerEventCount(Number(event.organization_id)),
  ]);
  // Promoter / UTM attribution from the URL travels with the checkout form.
  const param = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 120) : undefined);
  const attribution = { ref: param("ref"), utm_source: param("utm_source"), utm_medium: param("utm_medium"), utm_campaign: param("utm_campaign") };
  const inQueue = isLive && !!event.queue_enabled && !admitted;
  const taxBps = effectiveTaxBps(event);
  const dayLabelFor = (id: number | null) => {
    if (!id) return null;
    const d = dates.find((x) => Number(x.id) === Number(id));
    return d ? d.label ?? formatEventDate(new Date(d.starts_at), event.timezone, { withTime: false }) : null;
  };
  const unlocked = types.filter((t) => accessCodeMatches(t, accessCode));
  const codeRejected = accessCode !== "" && unlocked.length === 0;
  const visible = types.filter((t) => !t.hidden || unlocked.includes(t));
  const statusOf = (reason?: string): TicketStatus => (reason === "sold_out" ? "sold_out" : reason === "not_yet" ? "scheduled" : reason === "ended" ? "closed" : "on_sale");
  const tickets: TicketType[] = visible.map((t) => {
    const sale = unlocked.includes(t) ? ticketTypeOnSale({ ...t, hidden: 0 }) : ticketTypeOnSale(t);
    const available = ticketTypeAvailable(t);
    return {
      id: Number(t.id), name: t.name, description: t.description, kind: t.kind, priceCents: Number(t.price_cents),
      allInCents: allInUnitCents(Number(t.price_cents), fees, taxBps, event.fee_mode),
      status: sale.onSale ? "on_sale" : statusOf(sale.reason), remaining: available, minPerOrder: Number(t.min_per_order), maxPerOrder: Number(t.max_per_order), seats: Number(t.seats_per_unit),
      salesStart: t.sales_start_at ? formatEventDate(new Date(t.sales_start_at), event.timezone) : null, presale: unlocked.includes(t), dayLabel: dayLabelFor(t.event_date_id),
    };
  });
  const addonOptions = addons.filter((a) => a.active).map((a) => ({
    id: Number(a.id), name: a.name, description: a.description, allInCents: allInAddonCents(Number(a.price_cents), fees, taxBps, event.fee_mode), available: addonAvailable(a), max: Number(a.max_per_order),
  }));
  const questionViews = questions.map((q) => ({ id: Number(q.id), label: q.label, kind: q.kind, required: !!q.required, options: questionOptions(q) }));
  const soldOut = tickets.length > 0 && tickets.every((t) => t.status === "sold_out");
  const soldOutTypes = tickets.filter((t) => t.status === "sold_out" && !t.presale);
  const showWaitlist = isLive && !!event.waitlist_enabled && soldOutTypes.length > 0;
  const hasPresale = types.some((t) => t.hidden && t.access_code);
  const onSale = tickets.filter((t) => t.status === "on_sale" && t.remaining > 0);
  const lowestCents = onSale.length ? Math.min(...onSale.map((t) => t.allInCents)) : null;
  const rsvp = tickets.length > 0 && tickets.every((t) => t.allInCents === 0);
  const feeText = rsvp
    ? "Free to attend, no fees."
    : event.fee_mode === "buyer_pays"
      ? `Prices include the ticket price, service fee${taxBps ? " and tax" : ""}. A card processing fee of ${(fees.processingFeeBps / 100).toFixed(1)}% + ${formatCents(fees.processingFeeFixedCents, event.currency)} per order is added at checkout.`
      : `Prices include all fees${taxBps ? " and tax" : ""}. No additional charges at checkout.`;
  const refundText = event.refund_policy === "no_refunds"
    ? "No refunds. Tickets can't be refunded unless the event is cancelled."
    : event.refund_policy === "until_event_start"
      ? "Refunds on request until the event starts."
      : `Refunds on request up to ${event.refund_days_before} ${Number(event.refund_days_before) === 1 ? "day" : "days"} before the event.`;

  // the event as the listings show it (same mapping, so prices and tags match), plus the page's own details
  const [item] = await toEventItems([event]);
  const wall = (d: Date) => utcToWallClock(d, event.timezone);
  const endWall = event.ends_at ? wall(new Date(event.ends_at)) : null;
  const data: EventPageData = {
    event: item,
    slug: event.slug,
    organizer: organizerOf(event, { eventCount: orgCount }),
    summary: event.summary ?? "",
    about: (event.description ?? "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean),
    endTime: endWall?.slice(11, 16),
    endDate: endWall?.slice(0, 10),
    days: dates.length > 1
      ? dates.map((d) => ({
          date: wall(new Date(d.starts_at)).slice(0, 10),
          label: d.label ?? formatEventDate(new Date(d.starts_at), event.timezone, { withTime: false }),
          time: `${formatTimeOnly(new Date(d.starts_at), event.timezone)}${d.ends_at ? ` – ${formatTimeOnly(new Date(d.ends_at), event.timezone)}` : ""}`,
        }))
      : undefined,
    doorsTime: event.doors_at && dates.length <= 1 ? wall(new Date(event.doors_at)).slice(11, 16) : undefined,
    timeZone: event.timezone,
    address: event.venue_address ?? "",
    feePayer: event.fee_mode === "buyer_pays" ? "buyer" : "organizer",
    rsvp,
    lowestCents,
    salesUpcoming: tickets.some((t) => t.status === "scheduled"),
    lineup: [],
    ageText: event.age_restriction ? `${event.age_restriction} and over, ID required` : "All ages",
    refundText,
    feeText,
    status: event.status,
    preview: !isLive,
    siblings: siblings.map((s) => ({ href: publicEventPath(s), label: formatEventDate(new Date(s.starts_at), s.timezone) })),
    sponsors,
    ...relatedEvents(item, allEvents),
    contactEmail: brand.supportEmail,
    offers: tickets.filter((t) => !t.presale).map((t) => ({ name: t.name, allInCents: t.allInCents, status: t.status })),
    siteUrl: env.APP_URL,
  };

  const mode = !isLive && event.status !== "postponed" ? "unpublished" : tickets.length === 0 && !hasPresale ? "none" : tickets.length === 0 ? "presale_only" : inQueue ? "queue" : "tickets";
  const notices = typeof sp.leave === "string" ? [{ title: leftWaitlist ? "You have been removed from the waitlist." : "That waitlist link is no longer valid." }] : [];

  return (
    <PublicPage events={allEvents}>
      <main className="bg-fx-ivory">
        <EventPage
          data={data}
          notices={notices}
          ad={<AdSlot placement="event_detail" eventId={event.id} />}
          panel={
            <TicketPanel
              eventId={event.id}
              eventSlug={event.slug}
              currency={event.currency}
              feePayer={data.feePayer}
              rsvp={rsvp}
              endIso={isoLocal(endOf(data).date, endOf(data).time, event.timezone)}
              refundText={refundText}
              mode={mode}
              tickets={tickets}
              addons={addonOptions}
              questions={questionViews}
              accessCode={unlocked.length ? accessCode : ""}
              ageRestriction={event.age_restriction}
              defaultEmail={session?.user.email}
              defaultName={session?.user.name}
              hasPromo={Number(promos[0]?.n) > 0}
              attribution={attribution}
              smsEnabled={isSmsConfigured()}
              presale={{ enabled: isLive && hasPresale && !inQueue, linkKey, codeRejected, unlocked: unlocked.map((t) => t.name) }}
              waitlist={{ show: showWaitlist, soldOutTypes: soldOutTypes.map((t) => ({ id: t.id, name: t.name })), allSoldOut: soldOut }}
            />
          }
        />
      </main>
      {isLive ? <TrackingPixels metaPixelId={event.org_meta_pixel} ga4Id={event.org_ga4} organizer={event.org_name} eventName={event.title} /> : null}
    </PublicPage>
  );
}
