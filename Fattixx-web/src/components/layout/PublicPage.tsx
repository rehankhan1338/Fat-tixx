import type { ReactNode } from "react";
import { getSession } from "@/lib/auth/session";
import { listMemberships } from "@/lib/authz";
import { brandingForLayout } from "@/lib/branding";
import { env } from "@/lib/env";
import { publicEvents, siteFees } from "@/lib/home/data";
import { FeesProvider } from "@/lib/home/fees-context";
import type { EventItem, OrgBrand } from "@/lib/home/types";
import { requestCustomDomain } from "@/lib/pro/domains";
import { footerContent } from "@/lib/site-content";
import { listCategories } from "@/lib/site-content/categories";
import HomeState from "@/components/home/HomeState";
import RevealOnScroll from "@/components/home/RevealOnScroll";
import SiteNav, { type NavAccount } from "@/components/home/SiteNav";
import { BrandColors, BrandFooter, BrandHeader } from "./BrandChrome";
import SiteFooter from "./SiteFooter";

/** Where the nav's account link goes for the signed-in visitor. */
export async function navAccount(): Promise<NavAccount> {
  const session = await getSession();
  if (!session) return null;
  if (session.user.roles.length) return { href: `${env.ADMIN_URL}/admin`, label: "Admin", canCreateEvents: false };
  const memberships = await listMemberships(session.user.id);
  return { href: memberships.length ? "/dashboard" : "/account", label: "My account" };
}

/**
 * Chrome of every public page: the floating nav with its event search (transparent over the homepage hero when `overHero`), the shared filter / location state,
 * the live fee settings for fee previews, the event categories and the footer (both managed in Super Admin → Website). `events` feeds the nav's location menu and the listing
 * pages; pages that already loaded the list pass it in so it is fetched once.
 *
 * `brand` (a Fattixx Pro organizer's event and organizer pages): their colors, and with "own header" (always on their
 * custom domain, where Fattixx's own links would leave the site) their header and a short legal footer instead of Fattixx's.
 */
export async function PublicPage({ children, events, reveal = false, overHero = false, className = "", brand = null }: { children: ReactNode; events?: EventItem[]; reveal?: boolean; overHero?: boolean; className?: string; brand?: OrgBrand | null }) {
  const [account, footer, categories, fees, list, customHost, platform] = await Promise.all([navAccount(), footerContent(), listCategories(), siteFees(), events ?? publicEvents(), requestCustomDomain(), brandingForLayout()]);
  const ownChrome = !!brand && (brand.ownHeader || !!customHost);
  const homeHref = customHost ? "/" : brand ? `/o/${brand.slug}` : "/";
  return (
    <div className={`fx-home min-h-screen ${className}`}>
      {brand && <BrandColors brand={brand} />}
      <FeesProvider fees={fees}>
        <HomeState events={list} categories={categories}>
          {ownChrome && brand ? <BrandHeader brand={brand} homeHref={homeHref} /> : <SiteNav account={account} overHero={overHero} />}
          {children}
          {ownChrome && brand ? <BrandFooter brand={brand} appUrl={env.APP_URL} platformName={platform.name} homeHref={homeHref} /> : <SiteFooter content={footer} />}
          {reveal && <RevealOnScroll />}
        </HomeState>
      </FeesProvider>
    </div>
  );
}
