/*
 * Header and footer of a Fattixx Pro organizer's pages when they use their own header (plan 5.7.2): the organizer's
 * logo and name instead of the Fattixx nav, and a one-line footer that keeps only what must stay (who sells the
 * tickets, the terms and the privacy policy). Same height as SiteNav, so page offsets do not change.
 */

import Link from "next/link";
import { container, cx } from "@/components/ui/styles";
import type { OrgBrand } from "@/lib/home/types";
import { brandCssVars } from "@/lib/pro/brand-colors";

function initials(name: string): string {
  const w = name.split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}

export function BrandHeader({ brand, homeHref }: { brand: OrgBrand; homeHref: string }) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-[84px] items-center justify-between gap-4 border-b-2 border-fx-yellow bg-fx-ivory px-[max(var(--pad),calc(50%-960px+var(--pad)))] text-fx-red">
      <Link href={homeHref} className="flex min-w-0 items-center gap-3" aria-label={`${brand.name} home`}>
        {brand.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- uploaded logo, already resized
          <img src={brand.logo} alt="" className="h-12 w-auto max-w-[160px] rounded-[10px] object-contain" />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-fx-red font-display text-[16px] font-bold text-fx-ivory" aria-hidden="true">
            {initials(brand.name)}
          </span>
        )}
        <span className="truncate font-display text-[20px] font-semibold tracking-[-0.02em]">{brand.name}</span>
      </Link>
      <nav aria-label="Main" className="flex items-center gap-5 text-[15px] font-semibold whitespace-nowrap">
        <Link href={homeHref} className="hover:underline max-[641px]:hidden">Events</Link>
        {/* white-label site pages (About, FAQ, …) */}
        {brand.pages?.slice(0, 4).map((p) => (
          <Link key={p.slug} href={`${homeHref === "/" ? "" : homeHref}/p/${p.slug}`} className="hover:underline max-[901px]:hidden">{p.title}</Link>
        ))}
        <Link href="/tickets/find" className="inline-flex min-h-10 items-center rounded-full bg-fx-red px-4 text-fx-ivory">My tickets</Link>
      </nav>
    </header>
  );
}

export function BrandFooter({ brand, appUrl, platformName, homeHref = "/" }: { brand: OrgBrand; appUrl: string; platformName: string; homeHref?: string }) {
  const link = "underline-offset-[3px] hover:underline";
  return (
    <footer className="border-t border-fx-red/12 bg-fx-ivory py-10 text-[13px] text-fx-red/78">
      <div className={cx(container, "flex flex-wrap items-center justify-between gap-4")}>
        <p>
          © {new Date().getFullYear()} {brand.name}. Tickets are sold by {platformName}.
        </p>
        {brand.pages?.length ? (
          <nav aria-label={`${brand.name} pages`} className="flex w-full flex-wrap gap-5 font-semibold text-fx-red">
            {brand.pages.map((p) => <Link key={p.slug} href={`${homeHref === "/" ? "" : homeHref}/p/${p.slug}`} className={link}>{p.title}</Link>)}
          </nav>
        ) : null}
        <nav aria-label="Legal" className="flex flex-wrap gap-5">
          <a href={`${appUrl}/terms`} className={link}>Terms</a>
          <a href={`${appUrl}/privacy`} className={link}>Privacy</a>
          <a href={`${appUrl}/refunds`} className={link}>Refunds</a>
        </nav>
      </div>
    </footer>
  );
}

/**
 * The organizer's colors for the whole document. Set on :root (not the page wrapper) so dialogs and menus rendered
 * in portals, like the ticket pop-up, take them too. The values are validated hex codes (lib/pro/brand-colors.ts).
 */
export function BrandColors({ brand }: { brand: OrgBrand }) {
  if (!brand.primary || !brand.accent) return null;
  const vars = Object.entries(brandCssVars(brand.primary, brand.accent)).map(([k, v]) => `${k}:${v}`).join(";");
  return <style>{`html:root{${vars}}`}</style>;
}
