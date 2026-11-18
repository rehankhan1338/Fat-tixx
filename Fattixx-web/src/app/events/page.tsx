import type { Metadata } from "next";
import { publicEvents } from "@/lib/home/data";
import { listUpcoming } from "@/lib/home/events";
import { getSession } from "@/lib/auth/session";
import { forYou } from "@/lib/social/for-you";
import EventsGrid from "@/components/events/EventsGrid";
import EventTile from "@/components/events/EventTile";
import FeaturedEvents from "@/components/events/FeaturedEvents";
import { PublicPage } from "@/components/layout/PublicPage";
import { AdSlot } from "@/components/ad-slot";
import { FriendsGoingProvider } from "@/components/social/FriendsGoing";
import { container, cx, eyebrow, sectionTitle } from "@/components/ui/styles";

export const metadata: Metadata = {
  title: "Events",
  description: "Concerts, parties, workshops, fundraisers and more near you. Find your next night out on Fattixx.",
  robots: { index: true, follow: true },
};

/**
 * All upcoming public events: the featured carousel and the filterable grid. Accepts ?q=, ?when=, ?price= and ?cat= in the link.
 * Signed-in visitors also get "For you" (Social & Community 11.10) and "N friends going" on event cards (11.6).
 */
export default async function EventsPage() {
  const events = await publicEvents();
  const session = await getSession();
  const mine = session ? await forYou(session.user.id, events) : null;
  const picks = mine ? listUpcoming(mine.items, null) : [];
  return (
    <PublicPage events={events} reveal>
      <FriendsGoingProvider counts={mine?.friends ?? {}}>
        {/* The clearance for the fixed nav sits here so it holds whichever of the sections below render. */}
        <main className="pt-[128px] max-[901px]:pt-[104px]">
          <FeaturedEvents />
          {picks.length > 0 && (
            <section aria-labelledby="for-you-h" className={cx(container, "mt-12 text-fx-red")}>
              <p className={eyebrow}>Picked for you</p>
              <h2 id="for-you-h" className={cx(sectionTitle, "mt-2 text-[clamp(28px,3vw,40px)] leading-[1.05] tracking-[-0.03em]")}>For you</h2>
              <p className="mt-2 text-[15px] text-fx-red/75">From organizers you follow, events your friends are going to, and what you like.</p>
              <div className="mt-8 grid grid-cols-4 gap-x-6 gap-y-10 max-[1101px]:grid-cols-3 max-[721px]:grid-cols-2 max-[721px]:gap-x-4">
                {picks.map((e) => (
                  <div key={e.id}>
                    <EventTile e={e} />
                    {mine?.reasons[e.id] && !(mine.friends[e.id] > 0) && <p className="mt-1 text-[13px] text-fx-red/70">{mine.reasons[e.id]}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}
          {/* Plan 14.3 "Event listing pages": between the featured strip and the event grid; renders nothing when no campaign matches. */}
          <AdSlot placement="event_list" className="mx-auto w-[calc(100%-var(--pad)*2)] max-w-5xl" />
          <EventsGrid />
        </main>
      </FriendsGoingProvider>
    </PublicPage>
  );
}
