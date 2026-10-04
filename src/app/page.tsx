import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Sans } from "next/font/google";
import { getSession } from "@/lib/auth/session";
import { listMemberships } from "@/lib/authz";
import { getBranding } from "@/lib/settings";
import { homepageEvents, hostFeeStats } from "@/lib/home/data";
import Categories from "@/components/home/Categories";
import EventBrowser from "@/components/home/EventBrowser";
import FeaturedStrip from "@/components/home/FeaturedStrip";
import Hero from "@/components/home/Hero";
import HomeState from "@/components/home/HomeState";
import HostBand from "@/components/home/HostBand";
import HowItWorks from "@/components/home/HowItWorks";
import RevealOnScroll from "@/components/home/RevealOnScroll";
import SiteNav from "@/components/home/SiteNav";
import SiteFooter from "@/components/home/SiteFooter";

// Brand fonts, self-hosted by next/font (the strict CSP does not allow the Google Fonts stylesheet).
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-fx-display", axes: ["opsz"] });
const sans = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-fx-sans", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { absolute: "FATTIXX | Do it all." },
  description: "Find concerts, parties, workshops, fundraisers and more near you, and get your tickets on Fattixx.",
  robots: { index: true, follow: true },
  openGraph: {
    title: "FATTIXX | Find events. Host events. Do it all.",
    description: "Concerts, parties, workshops, fundraisers and more. Get your tickets on Fattixx.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#A8121A" };

/*
 * Public homepage (approved Fattixx design). Section order: nav, hero, how it works, categories,
 * featured strip, upcoming events, organizer band, footer. Events come from the database only;
 * when nothing is published the event grid says so (no sample data).
 */
export default async function HomePage() {
  const [session, events, stats, brand] = await Promise.all([getSession(), homepageEvents(), hostFeeStats(), getBranding()]);
  const memberships = session ? await listMemberships(session.user.id) : [];
  const account = session
    ? { href: session.user.roles.length ? "/admin" : memberships.length ? "/dashboard" : "/account", label: session.user.roles.length ? "Admin" : "My account" }
    : null;
  const createHref = session && (memberships.length || session.user.roles.includes("super_admin")) ? "/dashboard" : "/sell";

  return (
    <div className={`fx-home ${display.variable} ${sans.variable} min-h-screen`}>
      <HomeState events={events}>
        <SiteNav account={account} createHref={createHref} />
        <main>
          <Hero />
          <HowItWorks />
          <Categories />
          <FeaturedStrip />
          <EventBrowser />
          <HostBand stats={stats} createHref={createHref} />
        </main>
        <SiteFooter supportEmail={brand.supportEmail} />
        <RevealOnScroll />
      </HomeState>
    </div>
  );
}
