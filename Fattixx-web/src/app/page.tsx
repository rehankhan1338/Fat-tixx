import type { Metadata, Viewport } from "next";
import { publicEvents } from "@/lib/home/data";
import { homeContent } from "@/lib/site-content";
import EventBrowser from "@/components/home/EventBrowser";
import FeaturedStrip from "@/components/home/FeaturedStrip";
import Hero from "@/components/home/Hero";
import HostBand from "@/components/home/HostBand";
import HowItWorks from "@/components/home/HowItWorks";
import { PublicPage } from "@/components/layout/PublicPage";

export async function generateMetadata(): Promise<Metadata> {
  const c = await homeContent();
  return {
    title: { absolute: c.meta.title },
    description: c.meta.description,
    robots: { index: true, follow: true },
    openGraph: { title: c.meta.title, description: c.meta.description, type: "website", siteName: "Fattixx" },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = { themeColor: "#A8121A" };

/*
 * Public homepage. Section order: nav, photo hero, how it works, featured strip, event browser, organizer band, footer.
 * Every heading, paragraph, button, photo and fee point comes from src/lib/site-content/schema.ts; sections can be switched off there.
 * Events come from the database only; when nothing is published the event grid says so.
 */
export default async function HomePage() {
  const [events, c] = await Promise.all([publicEvents(), homeContent()]);
  return (
    <PublicPage events={events} reveal overHero>
      <main>
        <Hero content={c.hero} />
        {c.how.show && <HowItWorks content={c.how} />}
        {c.featured.show && <FeaturedStrip />}
        {c.browse.show && <EventBrowser content={c.browse} />}
        {c.host.show && <HostBand content={c.host} />}
      </main>
    </PublicPage>
  );
}
