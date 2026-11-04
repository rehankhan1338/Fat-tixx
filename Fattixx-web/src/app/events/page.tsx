import type { Metadata } from "next";
import { publicEvents } from "@/lib/home/data";
import EventsGrid from "@/components/events/EventsGrid";
import FeaturedEvents from "@/components/events/FeaturedEvents";
import { PublicPage } from "@/components/layout/PublicPage";
import { AdSlot } from "@/components/ad-slot";

export const metadata: Metadata = {
  title: "Events",
  description: "Concerts, parties, workshops, fundraisers and more near you. Find your next night out on Fattixx.",
  robots: { index: true, follow: true },
};

/** All upcoming public events: the featured carousel and the filterable grid. Accepts ?q=, ?when=, ?price= and ?cat= in the link. */
export default async function EventsPage() {
  const events = await publicEvents();
  return (
    <PublicPage events={events} reveal>
      {/* The clearance for the fixed nav sits here so it holds whichever of the sections below render. */}
      <main className="pt-[128px] max-[901px]:pt-[104px]">
        <FeaturedEvents />
        {/* Plan 14.3 "Event listing pages": between the featured strip and the event grid; renders nothing when no campaign matches. */}
        <AdSlot placement="event_list" className="mx-auto w-[calc(100%-var(--pad)*2)] max-w-5xl" />
        <EventsGrid />
      </main>
    </PublicPage>
  );
}
