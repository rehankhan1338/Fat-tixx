import type { Metadata } from "next";
import { requireOrg } from "@/lib/authz";
import { listVenues } from "@/lib/events/queries";
import { getSettings } from "@/lib/settings";
import { PageHeader, Section } from "@/components/shared";
import { EventForm } from "../event-form";

export const metadata: Metadata = { title: "New event" };

export default async function NewEventPage({ params }: PageProps<"/org/[slug]/events/new">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "organizer");
  const [venues, settings] = await Promise.all([listVenues(ctx.org.id), getSettings()]);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="New event" description="Events start as drafts. Add ticket types, then publish when you are ready to sell." />
      <Section>
        <EventForm orgSlug={slug} venues={venues.map((v) => ({ id: v.id, name: v.name, timezone: v.timezone, tax_bps: Number(v.tax_bps) }))} defaultFeeMode={settings.default_fee_mode} canFeature={ctx.isSuperAdmin} />
      </Section>
    </div>
  );
}
