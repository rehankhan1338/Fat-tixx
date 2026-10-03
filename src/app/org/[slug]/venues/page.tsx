import type { Metadata } from "next";
import { requireOrg } from "@/lib/authz";
import { listVenues } from "@/lib/events/queries";
import { PageHeader, Section } from "@/components/shared";
import { VenuesTable, VenueDialog } from "./venues-ui";

export const metadata: Metadata = { title: "Venues" };

export default async function VenuesPage({ params }: PageProps<"/org/[slug]/venues">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "organizer");
  const venues = await listVenues(ctx.org.id);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Venues" description="Where your events happen. The venue sets the default time zone and the admissions tax rate." actions={<VenueDialog orgSlug={slug} />} />
      <Section>
        <VenuesTable orgSlug={slug} venues={venues.map((v) => ({ ...v, capacity: v.capacity == null ? null : Number(v.capacity), tax_bps: Number(v.tax_bps), event_count: Number(v.event_count), latitude: v.latitude == null ? null : Number(v.latitude), longitude: v.longitude == null ? null : Number(v.longitude) }))} canDelete={ctx.isOrgAdmin} />
      </Section>
    </div>
  );
}
