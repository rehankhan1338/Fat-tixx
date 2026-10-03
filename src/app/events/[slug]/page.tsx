import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarIcon, ClockIcon, KeyRoundIcon, MapPinIcon, RepeatIcon, ShieldCheckIcon } from "lucide-react";
import {
  accessCodeMatches, addonAvailable, getPublicEventBySlug, listAddons, listEventDates, listQuestions, listSeriesSiblings, listTicketTypes, publicEventPath, questionOptions, ticketTypeAvailable, ticketTypeOnSale,
} from "@/lib/events/queries";
import { allInAddonCents, allInUnitCents, effectiveTaxBps, expireStaleHolds, feeConfigForEvent } from "@/lib/orders/checkout";
import { leaveWaitlist } from "@/lib/waitlist/actions";
import { getSession } from "@/lib/auth/session";
import { listMemberships } from "@/lib/authz";
import { env } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { formatEventDate, formatTimeOnly } from "@/lib/tz";
import { uploadUrl } from "@/lib/uploads";
import { PublicShell } from "@/components/public-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TicketSelector } from "./ticket-selector";
import { WaitlistForm } from "./waitlist-form";
import { WaitingRoom } from "./waiting-room";
import { query, type Row } from "@/lib/db";
import { isAdmitted } from "@/lib/queue";
import { isSmsConfigured } from "@/lib/sms";
import { listVisibleSponsors } from "@/lib/sponsors";
import { AdSlot } from "@/components/ad-slot";
import { TrackingPixels } from "@/components/tracking-pixels";

export async function generateMetadata({ params }: PageProps<"/events/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const e = await getPublicEventBySlug(slug);
  if (!e) return { title: "Event not found" };
  const img = e.image_path ? `${env.APP_URL}${uploadUrl(e.image_path)}` : undefined;
  return {
    title: e.title, description: e.summary ?? `${e.title} — ${formatEventDate(new Date(e.starts_at), e.timezone)}`,
    robots: e.visibility === "public" ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: e.title, description: e.summary ?? undefined, images: img ? [img] : undefined, type: "website" },
    twitter: { card: img ? "summary_large_image" : "summary", title: e.title, description: e.summary ?? undefined, images: img ? [img] : undefined },
  };
}

export default async function EventPage({ params, searchParams }: PageProps<"/events/[slug]">) {
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
  const [types, fees, dates, addons, questions, siblings, sponsors, promos, admitted] = await Promise.all([
    listTicketTypes(event.id), feeConfigForEvent(event), listEventDates(event.id), listAddons(event.id), listQuestions(event.id),
    event.series_id ? listSeriesSiblings(event.series_id, event.id) : Promise.resolve([]),
    listVisibleSponsors(event.id),
    query<Row & { n: number }>(`SELECT COUNT(*) AS n FROM promo_codes WHERE event_id = ? AND active = 1 AND (ends_at IS NULL OR ends_at > NOW())`, [event.id]),
    event.queue_enabled && !isTeam ? isAdmitted(event.id) : Promise.resolve(true),
  ]);
  // Promoter / UTM attribution from the URL travels with the checkout form.
  const param = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).slice(0, 120) : undefined);
  const attribution = { ref: param("ref"), utm_source: param("utm_source"), utm_medium: param("utm_medium"), utm_campaign: param("utm_campaign") };
  const inQueue = isLive && !!event.queue_enabled && !admitted;
  const taxBps = effectiveTaxBps(event);
  const start = new Date(event.starts_at);
  const dayLabelFor = (id: number | null) => {
    if (!id) return null;
    const d = dates.find((x) => Number(x.id) === Number(id));
    return d ? d.label ?? formatEventDate(new Date(d.starts_at), event.timezone, { withTime: false }) : null;
  };
  const unlocked = types.filter((t) => accessCodeMatches(t, accessCode));
  const codeRejected = accessCode !== "" && unlocked.length === 0;
  const visible = types.filter((t) => !t.hidden || unlocked.includes(t));
  const options = visible.map((t) => {
    const sale = unlocked.includes(t) ? ticketTypeOnSale({ ...t, hidden: 0 }) : ticketTypeOnSale(t);
    return {
      id: Number(t.id), name: t.name, description: t.description, kind: t.kind, priceCents: Number(t.price_cents), allInCents: allInUnitCents(Number(t.price_cents), fees, taxBps, event.fee_mode),
      available: ticketTypeAvailable(t), min: Number(t.min_per_order), max: Number(t.max_per_order), seats: Number(t.seats_per_unit), onSale: sale.onSale, reason: sale.reason,
      salesStart: t.sales_start_at ? formatEventDate(new Date(t.sales_start_at), event.timezone) : null, presale: unlocked.includes(t), dayLabel: dayLabelFor(t.event_date_id),
    };
  });
  const addonOptions = addons.filter((a) => a.active).map((a) => ({
    id: Number(a.id), name: a.name, description: a.description, priceCents: Number(a.price_cents), allInCents: allInAddonCents(Number(a.price_cents), fees, taxBps, event.fee_mode),
    available: addonAvailable(a), max: Number(a.max_per_order),
  }));
  const questionViews = questions.map((q) => ({ id: Number(q.id), label: q.label, kind: q.kind, required: !!q.required, options: questionOptions(q) }));
  const soldOut = options.length > 0 && options.every((o) => !o.onSale && o.reason === "sold_out");
  const soldOutTypes = options.filter((o) => !o.onSale && o.reason === "sold_out" && !o.presale);
  const showWaitlist = isLive && !!event.waitlist_enabled && soldOutTypes.length > 0;
  const hasPresale = types.some((t) => t.hidden && t.access_code);
  const feeNote = event.fee_mode === "buyer_pays"
    ? `Prices include the ticket price, service fee${taxBps ? " and tax" : ""}. A card processing fee of ${(fees.processingFeeBps / 100).toFixed(1)}% + ${formatCents(fees.processingFeeFixedCents, event.currency)} per order is added at checkout.`
    : `Prices include all fees${taxBps ? " and tax" : ""}. No additional charges at checkout.`;

  const jsonLd = {
    "@context": "https://schema.org", "@type": "Event", name: event.title, startDate: start.toISOString(), endDate: event.ends_at ? new Date(event.ends_at).toISOString() : undefined,
    eventStatus: event.status === "postponed" ? "https://schema.org/EventPostponed" : "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    description: event.summary ?? undefined, image: event.image_path ? [`${env.APP_URL}${uploadUrl(event.image_path)}`] : undefined,
    location: event.venue_name ? { "@type": "Place", name: event.venue_name, address: [event.venue_address, event.venue_city, event.venue_region].filter(Boolean).join(", ") } : undefined,
    organizer: { "@type": "Organization", name: event.org_name },
    offers: options.filter((o) => o.onSale && !o.presale).map((o) => ({ "@type": "Offer", name: o.name, price: (o.allInCents / 100).toFixed(2), priceCurrency: event.currency, availability: "https://schema.org/InStock", url: `${env.APP_URL}/events/${event.slug}` })),
  };

  return (
    <PublicShell wide>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {!isLive ? <Alert className="mb-6"><AlertTitle>Preview</AlertTitle><AlertDescription>This event is {event.status}. Only your team can see this page.</AlertDescription></Alert> : null}
      {event.status === "postponed" ? <Alert className="mb-6 border-amber-500/40"><AlertTitle>This event has been postponed.</AlertTitle><AlertDescription>Existing tickets remain valid for the new date.</AlertDescription></Alert> : null}
      {typeof sp.leave === "string" ? <Alert className="mb-6"><AlertTitle>{leftWaitlist ? "You have been removed from the waitlist." : "That waitlist link is no longer valid."}</AlertTitle></Alert> : null}
      <div className="grid gap-8 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <div className="aspect-[16/9] overflow-hidden rounded-2xl bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {event.image_path ? <img src={uploadUrl(event.image_path)!} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-6xl font-black text-muted-foreground/30">FT</div>}
          </div>
          <div>
            <div className="mb-2 flex flex-wrap gap-2">{event.age_restriction ? <Badge variant="outline">{event.age_restriction}+ event · ID required</Badge> : null}{dates.length > 1 ? <Badge variant="outline">{dates.length}-day event</Badge> : null}<Badge variant="secondary">by {event.org_name}</Badge></div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{event.title}</h1>
            {event.summary ? <p className="mt-3 text-lg text-muted-foreground">{event.summary}</p> : null}
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="flex gap-3 rounded-xl border p-4"><CalendarIcon className="mt-0.5 size-5 text-primary" /><div><dt className="text-xs text-muted-foreground">{dates.length > 1 ? "Dates" : "Date & time"}</dt>
              {dates.length > 1 ? (
                <dd className="space-y-0.5">{dates.map((d) => <p key={d.id} className="text-sm"><span className="font-medium">{d.label ?? formatEventDate(new Date(d.starts_at), event.timezone, { withTime: false })}</span> · {formatEventDate(new Date(d.starts_at), event.timezone)}{d.ends_at ? ` – ${formatTimeOnly(new Date(d.ends_at), event.timezone)}` : ""}</p>)}</dd>
              ) : <><dd className="font-medium">{formatEventDate(start, event.timezone)}</dd>{event.ends_at ? <dd className="text-sm text-muted-foreground">until {formatEventDate(new Date(event.ends_at), event.timezone)}</dd> : null}</>}
            </div></div>
            {event.doors_at && dates.length <= 1 ? <div className="flex gap-3 rounded-xl border p-4"><ClockIcon className="mt-0.5 size-5 text-primary" /><div><dt className="text-xs text-muted-foreground">Doors open</dt><dd className="font-medium">{formatTimeOnly(new Date(event.doors_at), event.timezone)}</dd></div></div> : null}
            {event.venue_name ? <div className="flex gap-3 rounded-xl border p-4 sm:col-span-2"><MapPinIcon className="mt-0.5 size-5 text-primary" /><div><dt className="text-xs text-muted-foreground">Venue</dt><dd className="font-medium">{event.venue_name}</dd><dd className="text-sm text-muted-foreground">{[event.venue_address, event.venue_city, event.venue_region].filter(Boolean).join(", ")}</dd></div></div> : null}
          </dl>
          {siblings.length ? (
            <div className="rounded-xl border p-4">
              <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><RepeatIcon className="size-3.5" /> More dates for this event</p>
              <ul className="flex flex-wrap gap-2">{siblings.map((s) => <li key={s.id}><Button variant="outline" size="sm" render={<Link href={publicEventPath(s)} />}>{formatEventDate(new Date(s.starts_at), s.timezone)}</Button></li>)}</ul>
            </div>
          ) : null}
          {event.description ? <div className="prose prose-invert max-w-none whitespace-pre-line text-sm leading-relaxed text-foreground/90">{event.description}</div> : null}
          {sponsors.length ? (
            <section aria-labelledby="sponsors-h" className="rounded-xl border p-4">
              <h2 id="sponsors-h" className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Sponsored by</h2>
              <ul className="flex flex-wrap items-center gap-6">
                {sponsors.map((sponsor) => {
                  const inner = sponsor.logoUrl
                    // eslint-disable-next-line @next/next/no-img-element -- pre-optimized sponsor logo
                    ? <img src={sponsor.logoUrl} alt={sponsor.name} loading="lazy" className="h-12 max-w-40 object-contain" />
                    : <span className="font-semibold">{sponsor.name}</span>;
                  return <li key={sponsor.id} className="text-center">{sponsor.url ? <a href={sponsor.url} target="_blank" rel="sponsored noopener">{inner}</a> : inner}{sponsor.tier ? <span className="mt-1 block text-[11px] text-muted-foreground">{sponsor.tier}</span> : null}</li>;
                })}
              </ul>
            </section>
          ) : null}
          <AdSlot placement="event_detail" eventId={event.id} />
          <p className="text-xs text-muted-foreground">Refunds: {event.refund_policy === "no_refunds" ? "no refunds except if the event is cancelled." : event.refund_policy === "until_event_start" ? "available on request until the event starts." : `available on request up to ${event.refund_days_before} days before the event.`}</p>
        </div>

        <div className="lg:col-span-2">
          <Card className="sticky top-4">
            <CardHeader><CardTitle className="flex items-center justify-between">Tickets {soldOut ? <Badge variant="destructive">Sold out</Badge> : null}</CardTitle></CardHeader>
            <CardContent>
              {!isLive && event.status !== "postponed" ? <p className="text-sm text-muted-foreground">Tickets go on sale when this event is published.</p>
                : options.length === 0 && !hasPresale ? <p className="text-sm text-muted-foreground">No tickets available.</p>
                : options.length === 0 ? <p className="text-sm text-muted-foreground">Tickets are available with an access code.</p>
                : inQueue ? <WaitingRoom eventId={event.id} />
                : <TicketSelector eventSlug={event.slug} currency={event.currency} options={options} addons={addonOptions} questions={questionViews} accessCode={unlocked.length ? accessCode : ""} ageRestriction={event.age_restriction} defaultEmail={session?.user.email} defaultName={session?.user.name}
                    hasPromo={Number(promos[0]?.n) > 0} attribution={attribution} smsEnabled={isSmsConfigured()} />}
              {isLive && hasPresale && !inQueue ? (
                <form method="get" className="mt-4 space-y-2 rounded-xl border border-dashed p-3">
                  {linkKey ? <input type="hidden" name="key" value={linkKey} /> : null}
                  <label htmlFor="access-code" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><KeyRoundIcon className="size-3.5" /> Have an access or presale code?</label>
                  <div className="flex gap-2"><Input id="access-code" name="code" defaultValue={accessCode} placeholder="Enter code" className="font-mono uppercase" autoComplete="off" /><Button type="submit" variant="secondary">Unlock</Button></div>
                  {codeRejected ? <p className="text-xs text-destructive">That code is not valid for this event.</p> : unlocked.length ? <p className="text-xs text-emerald-700 dark:text-emerald-300">Code accepted — {unlocked.map((t) => t.name).join(", ")} unlocked.</p> : null}
                </form>
              ) : null}
              {showWaitlist ? <WaitlistForm eventSlug={event.slug} soldOutTypes={soldOutTypes.map((o) => ({ id: o.id, name: o.name }))} allSoldOut={soldOut} defaultEmail={session?.user.email} defaultName={session?.user.name} /> : null}
              <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" /> {feeNote} Card details are handled by Stripe and never stored by Fat Tixx.</p>
            </CardContent>
          </Card>
        </div>
      </div>
      {isLive ? <TrackingPixels metaPixelId={event.org_meta_pixel} ga4Id={event.org_ga4} organizer={event.org_name} eventName={event.title} /> : null}
    </PublicShell>
  );
}
