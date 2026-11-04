import type { Metadata } from "next";
import { requireOrg } from "@/lib/authz";
import { FeesProvider } from "@/lib/home/fees-context";
import { seatMapsByOrg, venuesByOrg } from "@/lib/home/create-context";
import { feeConfigForOrg, getSettings } from "@/lib/settings";
import { listCategories } from "@/lib/site-content/categories";
import CreateEvent from "@/components/create/CreateEvent";

export const metadata: Metadata = { title: "New event" };

/**
 * The dashboard's "New event": the /create page itself (plan 5.6), inside the dashboard with the organization chosen.
 * Verified organizations get Publish / Save as draft; others save a draft and publish from the event page.
 * `?seating=1` starts a Pro organization's event on a seat map (`&map=<id>` with that map chosen).
 */
export default async function NewEventPage({ params, searchParams }: PageProps<"/org/[slug]/events/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug, "organizer");
  const org = { id: Number(ctx.org.id), slug: ctx.org.slug, name: ctx.org.name, verified: !!ctx.org.verified_at };
  const [fees, settings, categories, venues, seatMaps] = await Promise.all([feeConfigForOrg(ctx.org), getSettings(), listCategories(), venuesByOrg([org]), seatMapsByOrg([org])]);
  const startOnMap = sp.seating === "1" ? (typeof sp.map === "string" ? sp.map.replace(/\D/g, "") : "") : undefined;
  return (
    <FeesProvider fees={fees}>
      <CreateEvent
        signedIn
        embedded
        organizations={[org]}
        preselect={org.slug}
        categories={categories}
        venuesByOrg={venues}
        seatMapsByOrg={seatMaps}
        startOnMap={startOnMap}
        defaultFeePayer={settings.default_fee_mode === "organizer_absorbs" ? "organizer" : "buyer"}
        canFeature={ctx.isSuperAdmin}
      />
    </FeesProvider>
  );
}
