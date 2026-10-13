import type { Metadata } from "next";
import { requireOrg } from "@/lib/authz";
import { listVenues } from "@/lib/events/queries";
import { getSettings } from "@/lib/settings";
import { listCategories } from "@/lib/site-content/categories";
import { NewEventForm } from "./new-event-form";

export const metadata: Metadata = { title: "New event" };

/** The dashboard's "New event": the event form's fields in the /create page's design. Events start as drafts. */
export default async function NewEventPage({ params }: PageProps<"/org/[slug]/events/new">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "organizer");
  const [venues, settings, categories] = await Promise.all([listVenues(ctx.org.id), getSettings(), listCategories()]);
  return (
    <NewEventForm
      orgSlug={slug}
      venues={venues.map((v) => ({ id: Number(v.id), name: v.name, city: v.city, region: v.region, timezone: v.timezone, taxBps: Number(v.tax_bps), taxLabel: v.tax_label }))}
      categories={categories}
      defaultFeeMode={settings.default_fee_mode}
      canFeature={ctx.isSuperAdmin}
    />
  );
}
