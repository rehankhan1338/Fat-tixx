import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLinkIcon, ScanLineIcon } from "lucide-react";
import { requireOrg, canAccessEvent } from "@/lib/authz";
import { addonAvailable, getEvent, listAddons, listEventAssignableMembers, listEventDates, listQuestions, listTicketTypes, listVenues, listWaitlist, publicEventPath, ticketTypeAvailable } from "@/lib/events/queries";
import { checkinCounts, eventSalesSummary, listEventAttendees } from "@/lib/orders/queries";
import { listEventTransfers } from "@/lib/orders/transfer";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { formatEventDate, utcToWallClock } from "@/lib/tz";
import { uploadUrl } from "@/lib/uploads";
import { PageHeader, Section, Stat, StatusBadge } from "@/components/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EventForm } from "../event-form";
import { EventStatusActions } from "./status-actions";
import { TicketTypesPanel } from "./ticket-types-panel";
import { EventTeamPanel } from "./team-panel";
import { AttendeesPanel } from "./attendees-panel";
import { SalesPanel } from "./sales-panel";
import { SchedulePanel } from "./schedule-panel";
import { AddonsPanel } from "./addons-panel";
import { QuestionsPanel } from "./questions-panel";
import { WaitlistPanel } from "./waitlist-panel";
import { ShareLink } from "./share-link";
import { LiveCheckinStat } from "./live-checkin-stat";
import { OfflineConflicts } from "./offline-conflicts";
import { listOfflineConflicts } from "@/lib/checkin/actions";
import { MarketingPanel } from "./marketing-panel";
import { AnalyticsPanel } from "./analytics-panel";
import { listPromoCodes, promoLabel, promoTicketTypeIds } from "@/lib/marketing/queries";
import { listSponsors } from "@/lib/sponsors";
import { campaignFormValues, ctr, listCampaigns, listCreatives } from "@/lib/ads/queries";
import { effectiveStatus } from "@/lib/ads/placements";
import { queueStats } from "@/lib/queue";

export const metadata: Metadata = { title: "Event" };

export default async function EventPage({ params, searchParams }: PageProps<"/org/[slug]/events/[eventId]">) {
  const { slug, eventId } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug);
  const event = await getEvent(ctx.org.id, Number(eventId));
  if (!event || !(await canAccessEvent(ctx, event))) notFound();
  const canEdit = ctx.role !== "staff";
  const [ticketTypes, venues, members, attendees, sales, settings, dates, addons, questions, waitlist, counts, transfers, conflicts] = await Promise.all([
    listTicketTypes(event.id), canEdit ? listVenues(ctx.org.id) : [], canEdit ? listEventAssignableMembers(ctx.org.id, event.id) : [],
    listEventAttendees(event.id), canEdit ? eventSalesSummary(event.id) : null, getSettings(), listEventDates(event.id), listAddons(event.id), listQuestions(event.id), canEdit ? listWaitlist(event.id) : [],
    checkinCounts(event.id), canEdit ? listEventTransfers(event.id) : [], listOfflineConflicts(slug, event.id),
  ]);
  const tab = typeof sp.tab === "string" ? sp.tab : "tickets";
  const [promos, sponsors, campaigns, qStats] = canEdit
    ? await Promise.all([listPromoCodes(event.id), listSponsors(event.id), listCampaigns({ organizationId: ctx.org.id, eventId: event.id }), queueStats(event.id)])
    : [[], [], [], { waiting: 0, admittedLastHour: 0 }] as const;
  const sponsorAds = await Promise.all(campaigns.map(async (c) => ({
    values: campaignFormValues(c), status: c.status === "draft" ? "awaiting_approval" : effectiveStatus(c), impressions: Number(c.impressions), clicks: Number(c.clicks), ctr: ctr(Number(c.impressions), Number(c.clicks)),
    creatives: (await listCreatives(Number(c.id))).map((x) => ({ id: Number(x.id), imageUrl: x.imageUrl ?? null, alt_text: x.alt_text, headline: x.headline, body: x.body })),
  })));
  const embedSnippet = `<script src="${env.APP_URL}/embed.js" data-event="${event.slug}"${event.visibility === "private" && event.private_key ? ` data-key="${event.private_key}"` : ""} async></script>`;
  const wall = (d: Date | string | null) => (d ? utcToWallClock(new Date(d), event.timezone) : "");
  const dayLabel = (d: { label: string | null; starts_at: Date }, i: number) => d.label ?? `Day ${i + 1}`;
  const days = dates.map((d, i) => ({ id: Number(d.id), label: dayLabel(d, i) }));
  const availableTickets = ticketTypes.reduce((n, t) => n + ticketTypeAvailable(t), 0);
  const waitingCount = waitlist.filter((w) => w.status === "waiting").length;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{event.title} <StatusBadge status={event.status} />{event.visibility !== "public" ? <StatusBadge status={event.visibility} /> : null}{event.series_id ? <Badge variant="outline">recurring</Badge> : null}{dates.length > 1 ? <Badge variant="outline">{dates.length} days</Badge> : null}</span>}
        description={<>{formatEventDate(new Date(event.starts_at), event.timezone)}{dates.length > 1 && event.ends_at ? ` → ${formatEventDate(new Date(event.ends_at), event.timezone)}` : ""}{event.venue_name ? ` · ${event.venue_name}` : ""}{event.age_restriction ? ` · ${event.age_restriction}+` : ""}</>}
        actions={
          <>
            <Button variant="outline" render={<Link href={publicEventPath(event)} target="_blank" />}><ExternalLinkIcon /> {event.status === "published" ? "View page" : "Preview"}</Button>
            <Button variant="outline" render={<Link href={`/org/${slug}/events/${event.id}/scan`} />}><ScanLineIcon /> Scan</Button>
            {canEdit ? <EventStatusActions orgSlug={slug} eventId={event.id} status={event.status} hasTicketTypes={ticketTypes.length > 0} canDelete={ctx.isOrgAdmin} paidOrders={sales?.paidOrders ?? 0} isSuperAdmin={ctx.isSuperAdmin} inSeries={!!event.series_id} /> : null}
          </>
        }
      />
      {sp.created ? <Alert><AlertTitle>Event created as a draft.</AlertTitle><AlertDescription>Add at least one ticket type, then publish it to start selling.</AlertDescription></Alert> : null}
      {event.status === "cancelled" ? <Alert variant="destructive"><AlertTitle>This event was cancelled.</AlertTitle><AlertDescription>{event.cancel_reason}</AlertDescription></Alert> : null}
      <OfflineConflicts orgSlug={slug} eventId={event.id} conflicts={conflicts} canResolve={canEdit} />
      {event.visibility !== "public" && canEdit ? <ShareLink orgSlug={slug} eventId={event.id} url={`${env.APP_URL}${publicEventPath(event)}`} visibility={event.visibility} canEdit={canEdit} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tickets sold" value={`${event.tickets_sold} / ${event.capacity_total}`} hint={`${availableTickets} still available${waitingCount ? ` · ${waitingCount} on waitlist` : ""}`} />
        <LiveCheckinStat orgSlug={slug} eventId={event.id} initial={counts} />
        {sales ? <Stat label="Net sales" value={formatCents(sales.netCents, event.currency)} hint={`${sales.paidOrders} orders · ${formatCents(sales.refundedCents, event.currency)} refunded${sales.addonGrossCents ? ` · ${formatCents(sales.addonGrossCents, event.currency)} add-ons` : ""}`} /> : <Stat label="Attendees" value={attendees.length} />}
        {sales ? <Stat label="Estimated payout" value={formatCents(sales.payoutCents, event.currency)} hint="After fees & tax" /> : <Stat label="Doors" value={event.doors_at ? formatEventDate(new Date(event.doors_at), event.timezone) : "—"} />}
      </div>

      <Tabs defaultValue={tab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="tickets">Ticket types</TabsTrigger>
          <TabsTrigger value="attendees">Attendees ({attendees.length})</TabsTrigger>
          {canEdit ? <TabsTrigger value="schedule">Schedule{dates.length > 1 ? ` (${dates.length} days)` : ""}</TabsTrigger> : null}
          {canEdit ? <TabsTrigger value="checkout">Checkout{addons.length + questions.length ? ` (${addons.length + questions.length})` : ""}</TabsTrigger> : null}
          {canEdit ? <TabsTrigger value="waitlist">Waitlist{waitingCount ? ` (${waitingCount})` : ""}</TabsTrigger> : null}
          {canEdit ? <TabsTrigger value="sales">Sales & settlement</TabsTrigger> : null}
          {canEdit ? <TabsTrigger value="analytics">Analytics</TabsTrigger> : null}
          {canEdit ? <TabsTrigger value="marketing">Marketing{promos.length + sponsors.length ? ` (${promos.length + sponsors.length})` : ""}</TabsTrigger> : null}
          {canEdit ? <TabsTrigger value="team">Team</TabsTrigger> : null}
          {canEdit ? <TabsTrigger value="details">Details</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="tickets" className="pt-4">
          <TicketTypesPanel orgSlug={slug} eventId={event.id} timezone={event.timezone} currency={event.currency} canEdit={canEdit} days={days}
            ticketTypes={ticketTypes.map((t) => ({ ...t, price_cents: Number(t.price_cents), quantity: Number(t.quantity), sold: Number(t.sold), held: Number(t.held), min_per_order: Number(t.min_per_order), max_per_order: Number(t.max_per_order), max_per_account: t.max_per_account == null ? null : Number(t.max_per_account), seats_per_unit: Number(t.seats_per_unit), event_date_id: t.event_date_id ? Number(t.event_date_id) : null, hidden: !!t.hidden, access_code: t.access_code, sort_order: Number(t.sort_order), sales_start_at: wall(t.sales_start_at), sales_end_at: wall(t.sales_end_at) }))} />
        </TabsContent>

        <TabsContent value="attendees" className="pt-4">
          <AttendeesPanel orgSlug={slug} event={{ id: event.id, title: event.title, timezone: event.timezone, status: event.status }} attendees={attendees} canEdit={canEdit} canRefund={ctx.perms.canRefund} ticketTypes={ticketTypes.map((t) => ({ id: t.id, name: t.name }))}
            transfers={transfers.map((x) => ({ id: Number(x.id), created_at: new Date(x.created_at).toISOString(), order_code: x.order_code, from_ticket_code: x.from_ticket_code, to_ticket_code: x.to_ticket_code, to_ticket_status: x.to_ticket_status, from_name: x.from_name, from_email: x.from_email, to_name: x.to_name, to_email: x.to_email, initiated_by: x.initiated_by, actor_name: x.actor_name, note: x.note }))} />
        </TabsContent>

        {canEdit ? (
          <TabsContent value="schedule" className="pt-4">
            <SchedulePanel orgSlug={slug} eventId={event.id} canEdit={canEdit}
              dates={dates.map((d, i) => ({ id: Number(d.id), label: dayLabel(d, i), starts_at: wall(d.starts_at), ends_at: wall(d.ends_at), doors_at: wall(d.doors_at), when: `${formatEventDate(new Date(d.starts_at), event.timezone)}${d.ends_at ? ` → ${formatEventDate(new Date(d.ends_at), event.timezone)}` : ""}`, ticketTypes: ticketTypes.filter((t) => Number(t.event_date_id) === Number(d.id)).length }))} />
          </TabsContent>
        ) : null}

        {canEdit ? (
          <TabsContent value="checkout" className="space-y-6 pt-4">
            <AddonsPanel orgSlug={slug} eventId={event.id} currency={event.currency} canEdit={canEdit}
              addons={addons.map((a) => ({ id: Number(a.id), name: a.name, description: a.description, price_cents: Number(a.price_cents), quantity: a.quantity == null ? null : Number(a.quantity), sold: Number(a.sold), held: Number(a.held), max_per_order: Number(a.max_per_order), active: !!a.active, sort_order: Number(a.sort_order) }))} />
            <QuestionsPanel orgSlug={slug} eventId={event.id} canEdit={canEdit} questions={questions.map((q) => ({ id: Number(q.id), label: q.label, kind: q.kind, required: !!q.required, options: q.options ?? "", sort_order: Number(q.sort_order) }))} />
          </TabsContent>
        ) : null}

        {canEdit ? (
          <TabsContent value="waitlist" className="pt-4">
            <WaitlistPanel orgSlug={slug} eventId={event.id} canEdit={canEdit} enabled={!!event.waitlist_enabled} ticketTypes={ticketTypes.filter((t) => !t.hidden).map((t) => ({ id: Number(t.id), name: t.name }))}
              availableNote={`${availableTickets} ticket${availableTickets === 1 ? "" : "s"} available right now${addons.some((a) => addonAvailable(a) === 0) ? ", some add-ons sold out" : ""}`}
              entries={waitlist.map((w) => ({ id: Number(w.id), email: w.email, name: w.name, quantity: Number(w.quantity), status: w.status, ticket_type_name: w.ticket_type_name, created_at: new Date(w.created_at).toISOString(), notified_at: w.notified_at ? new Date(w.notified_at).toISOString() : null }))} />
          </TabsContent>
        ) : null}

        {canEdit && sales ? (
          <TabsContent value="sales" className="pt-4">
            <SalesPanel orgSlug={slug} event={{ id: event.id, currency: event.currency, fee_mode: event.fee_mode }} sales={sales} />
          </TabsContent>
        ) : null}

        {canEdit ? (
          <TabsContent value="analytics" className="pt-4">
            <AnalyticsPanel orgId={ctx.org.id} orgSlug={slug} event={{ id: event.id, currency: event.currency, timezone: event.timezone }} />
          </TabsContent>
        ) : null}

        {canEdit ? (
          <TabsContent value="marketing" className="pt-4">
            <MarketingPanel ctx={{ orgSlug: slug, eventId: event.id }} currency={event.currency} ticketTypes={ticketTypes.filter((t) => Number(t.price_cents) > 0).map((t) => ({ id: Number(t.id), name: t.name }))}
              promos={promos.map((p) => ({
                id: Number(p.id), code: p.code, kind: p.kind, valueInput: p.kind === "percent" ? String(Number(p.value) / 100) : (Number(p.value) / 100).toFixed(2), label: promoLabel(p, event.currency),
                ticketTypeIds: promoTicketTypeIds(p) ?? [], maxUses: p.max_uses == null ? null : Number(p.max_uses), used: Number(p.used), discountTotal: formatCents(Number(p.discount_total), event.currency),
                startsAt: wall(p.starts_at), endsAt: wall(p.ends_at), active: !!p.active,
                window: p.starts_at || p.ends_at ? `${p.starts_at ? formatEventDate(new Date(p.starts_at), event.timezone) : "now"} → ${p.ends_at ? formatEventDate(new Date(p.ends_at), event.timezone) : "event"}` : "Always",
              }))}
              sponsors={sponsors.map((x) => ({ id: Number(x.id), name: x.name, logoUrl: uploadUrl(x.logo_path), url: x.url, tier: x.tier, visibleFrom: wall(x.visible_from), visibleUntil: wall(x.visible_until), sortOrder: Number(x.sort_order) }))}
              sponsorAds={sponsorAds} queue={{ enabled: !!event.queue_enabled, rate: Number(event.queue_rate_per_min), stats: qStats }}
              embedSnippet={embedSnippet} embedUrl={`/embed/${event.slug}${event.visibility === "private" && event.private_key ? `?key=${event.private_key}` : ""}`} />
          </TabsContent>
        ) : null}

        {canEdit ? (
          <TabsContent value="team" className="pt-4">
            <Section title="Who can work on this event" description="Organization Admins always have access. Assign Organizers and door staff here; assignments apply in the scanner immediately.">
              <EventTeamPanel orgSlug={slug} eventId={event.id} members={members.map((m) => ({ user_id: Number(m.user_id), name: m.name, email: m.email, role: m.role, assigned: !!m.assigned }))} />
            </Section>
          </TabsContent>
        ) : null}

        {canEdit ? (
          <TabsContent value="details" className="pt-4">
            <Section title="Event details">
              <EventForm orgSlug={slug} defaultFeeMode={settings.default_fee_mode} canFeature={ctx.isSuperAdmin} venues={venues.map((v) => ({ id: v.id, name: v.name, timezone: v.timezone, tax_bps: Number(v.tax_bps) }))}
                values={{
                  id: event.id, title: event.title, slug: event.slug, summary: event.summary ?? "", description: event.description ?? "", imageUrl: uploadUrl(event.image_path),
                  venue_id: event.venue_id ? String(event.venue_id) : "", timezone: event.timezone,
                  starts_at: wall(event.starts_at), ends_at: wall(event.ends_at), doors_at: wall(event.doors_at), capacity: event.capacity ? String(event.capacity) : "",
                  visibility: event.visibility, age_restriction: event.age_restriction ? String(event.age_restriction) : "", fee_mode: event.fee_mode,
                  tax_pct: event.tax_bps == null ? "" : (Number(event.tax_bps) / 100).toFixed(2), tax_label: event.tax_label ?? "", refund_policy: event.refund_policy,
                  refund_days_before: event.refund_days_before ? String(event.refund_days_before) : "", allow_transfers: !!event.allow_transfers, waitlist_enabled: !!event.waitlist_enabled, multiDay: dates.length > 0, category: event.category ?? "", featured: !!event.featured,
                }} />
            </Section>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
