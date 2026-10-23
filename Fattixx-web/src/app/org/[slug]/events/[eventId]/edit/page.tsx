import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { canAccessEvent, requireOrg } from "@/lib/authz";
import { getEvent } from "@/lib/events/queries";
import { FeesProvider } from "@/lib/home/fees-context";
import { editorData, venuesByOrg } from "@/lib/home/create-context";
import { feeConfigForOrg, getSettings } from "@/lib/settings";
import { listCategories } from "@/lib/site-content/categories";
import CreateEvent from "@/components/create/CreateEvent";

export const metadata: Metadata = { title: "Edit event" };

/**
 * Events are edited on the same page they were created on (plan 5.6.12), drafts included. Ticket holders are emailed
 * when the date, time or location changes. Ticket types the page doesn't make (VIP, tables, comps, presale, day
 * tickets), the schedule of multi-day events, add-ons and questions stay on the event's dashboard tabs.
 */
export default async function EditEventPage({ params }: PageProps<"/org/[slug]/events/[eventId]/edit">) {
  const { slug, eventId } = await params;
  const ctx = await requireOrg(slug, "organizer");
  const event = await getEvent(ctx.org.id, Number(eventId));
  if (!event || !(await canAccessEvent(ctx, event))) notFound();
  if (event.status === "cancelled") redirect(`/org/${slug}/events/${event.id}`);
  const org = { id: Number(ctx.org.id), slug: ctx.org.slug, name: ctx.org.name, verified: !!ctx.org.verified_at };
  const [fees, settings, categories, venues, editor] = await Promise.all([feeConfigForOrg(ctx.org), getSettings(), listCategories(), venuesByOrg([org]), editorData(event)]);
  return (
    <FeesProvider fees={fees}>
      <CreateEvent
        signedIn
        embedded
        organizations={[org]}
        preselect={org.slug}
        categories={categories}
        venuesByOrg={venues}
        defaultFeePayer={settings.default_fee_mode === "organizer_absorbs" ? "organizer" : "buyer"}
        canFeature={ctx.isSuperAdmin}
        editor={editor}
      />
    </FeesProvider>
  );
}
