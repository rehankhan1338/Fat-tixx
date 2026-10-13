import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/authz";
import { listVisibleEvents } from "@/lib/events/queries";
import { listTrackingLinks } from "@/lib/marketing/queries";
import { env } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { PageHeader, Section } from "@/components/shared";
import { PixelsForm, TrackingLinks } from "./marketing-client";

export const metadata: Metadata = { title: "Marketing" };

export default async function OrgMarketingPage({ params }: PageProps<"/org/[slug]/marketing">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  if (ctx.role === "staff") notFound();
  const [links, events] = await Promise.all([listTrackingLinks(ctx.org.id), listVisibleEvents(ctx, "all")]);
  const currency = events[0]?.currency ?? "USD";
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="Marketing" description="Promoter and affiliate links with UTM reporting, and the tracking pixels for your event pages. Promo codes, sponsors and the embeddable widget are on each event's Marketing tab." />
      <Section title="Promoter / affiliate links" description="Share /r/<code> links. Each click is counted, and orders within 7 days are credited to the link.">
        <TrackingLinks orgSlug={slug} events={events.map((e) => ({ id: Number(e.id), title: e.title }))}
          links={links.map((l) => ({
            id: Number(l.id), code: l.code, name: l.name, eventId: l.event_id ? Number(l.event_id) : null, eventTitle: l.event_title, utmSource: l.utm_source ?? "", utmMedium: l.utm_medium ?? "", utmCampaign: l.utm_campaign ?? "",
            clicks: Number(l.clicks), orders: Number(l.orders), tickets: Number(l.tickets), revenue: formatCents(Number(l.revenue_cents), currency), active: !!l.active, url: `${env.APP_URL}/r/${l.code}`,
          }))} />
      </Section>
      <Section title="Tracking pixels" description="Measure your own ads (Meta, Google) on your event pages.">
        <PixelsForm orgSlug={slug} meta={ctx.org.meta_pixel_id ?? ""} ga4={ctx.org.ga4_id ?? ""} canEdit={ctx.isOrgAdmin} />
      </Section>
    </div>
  );
}
