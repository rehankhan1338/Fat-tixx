import type { ReactNode } from "react";
import { getSession } from "@/lib/auth/session";
import { listMemberships } from "@/lib/authz";
import { publicEvents, siteFees } from "@/lib/home/data";
import { FeesProvider } from "@/lib/home/fees-context";
import type { EventItem } from "@/lib/home/types";
import { footerContent } from "@/lib/site-content";
import { listCategories } from "@/lib/site-content/categories";
import HomeState from "@/components/home/HomeState";
import RevealOnScroll from "@/components/home/RevealOnScroll";
import SiteNav, { type NavAccount } from "@/components/home/SiteNav";
import SiteFooter from "./SiteFooter";

/** Where the nav's account link goes for the signed-in visitor. */
export async function navAccount(): Promise<NavAccount> {
  const session = await getSession();
  if (!session) return null;
  if (session.user.roles.length) return { href: "/admin", label: "Admin", canCreateEvents: false };
  const memberships = await listMemberships(session.user.id);
  return { href: memberships.length ? "/dashboard" : "/account", label: "My account" };
}

/**
 * Chrome of every public page: the floating nav with its event search (transparent over the homepage hero when `overHero`), the shared filter / location state,
 * the live fee settings for fee previews, the event categories and the footer (both managed in Super Admin → Website). `events` feeds the nav's location menu and the listing
 * pages; pages that already loaded the list pass it in so it is fetched once.
 */
export async function PublicPage({ children, events, reveal = false, overHero = false, className = "" }: { children: ReactNode; events?: EventItem[]; reveal?: boolean; overHero?: boolean; className?: string }) {
  const [account, footer, categories, fees, list] = await Promise.all([navAccount(), footerContent(), listCategories(), siteFees(), events ?? publicEvents()]);
  return (
    <div className={`fx-home min-h-screen ${className}`}>
      <FeesProvider fees={fees}>
        <HomeState events={list} categories={categories}>
          <SiteNav account={account} overHero={overHero} />
          {children}
          <SiteFooter content={footer} />
          {reveal && <RevealOnScroll />}
        </HomeState>
      </FeesProvider>
    </div>
  );
}
