/*
 * Site footer for public pages. Dark red block under a curved ivory edge that mirrors the hero's
 * white-over-red sheet. Links point at existing routes; add columns here as new pages launch.
 */

import Link from "next/link";
import { LogoMark } from "./icons";
import { container, cx } from "@/components/home/styles";
import FooterWordmark from "./FooterWordmark";

const columns = (supportEmail: string) => [
  {
    title: "Discover",
    links: [
      { label: "Browse events", href: "/#events" },
      { label: "This weekend", href: "/?when=weekend#events" },
      { label: "Free events", href: "/?free=1#events" },
    ],
  },
  {
    title: "Host",
    links: [
      { label: "Create an event", href: "/sell" },
      { label: "Pricing", href: "/#host" },
      { label: "How it works", href: "/#how" },
    ],
  },
  {
    title: "Help",
    links: [
      { label: "Find my tickets", href: "/tickets/find" },
      { label: "Contact us", href: `mailto:${supportEmail}` },
      { label: "Refund policy", href: "/refunds" },
    ],
  },
];

const LEGAL = [
  { label: "Terms of service", href: "/terms" },
  { label: "Privacy policy", href: "/privacy" },
  { label: "Ticketing terms", href: "/ticketing-terms" },
  { label: "Organizer agreement", href: "/organizer-agreement" },
];

const link = "rounded-sm text-fx-ivory/70 transition-colors duration-200 hover:text-fx-ivory";

export default function SiteFooter({ supportEmail }: { supportEmail: string }) {
  return (
    <footer className="relative isolate overflow-hidden bg-fx-red-night text-fx-ivory" aria-labelledby="footer-h">
      <h2 id="footer-h" className="sr-only">
        Site links
      </h2>

      {/* curved ivory edge: the page above sits over the red like the hero's top sheet */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 drop-shadow-[0_10px_12px_rgba(50,3,7,.45)]"
        aria-hidden="true"
      >
        <div className="absolute inset-x-0 top-0 h-[120px] translate-y-[6px] rounded-[0_0_50%_50%/0_0_64px_64px] bg-[#E2D6C3] max-[641px]:h-[76px] max-[641px]:rounded-[0_0_50%_50%/0_0_32px_32px]" />
        <div className="absolute inset-x-0 top-0 h-[120px] rounded-[0_0_50%_50%/0_0_64px_64px] bg-fx-ivory max-[641px]:h-[76px] max-[641px]:rounded-[0_0_50%_50%/0_0_32px_32px]" />
      </div>

      <div className={cx(container, "pt-[200px] max-[641px]:pt-[136px]")}>
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-8 gap-y-10 max-[901px]:grid-cols-3 max-[641px]:grid-cols-2">
          <div className="max-[901px]:col-span-full">
            <Link href="/" className="inline-flex items-center gap-[10px] font-display text-[22px] font-extrabold" aria-label="Fattixx home">
              <LogoMark />
              <span>FATTIXX</span>
            </Link>
            <p className="mt-3 max-w-[260px] text-[15px] leading-[1.55] text-fx-ivory/70">
              Tickets for everything. Find your next night out or throw one.
            </p>
          </div>

          {columns(supportEmail).map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="font-display text-[16px] font-semibold tracking-[-0.01em]">{col.title}</h3>
              <ul className="mt-4 flex flex-col gap-3 text-[14px]">
                {col.links.map((l) => (
                  <li key={l.href}>
                    {l.href.startsWith("mailto:") ? (
                      <a href={l.href} className={link}>{l.label}</a>
                    ) : (
                      <Link href={l.href} className={link}>{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-16 max-[641px]:mt-12">
          <FooterWordmark />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-7 gap-y-3 border-t border-fx-ivory/12 py-6 text-[13px] text-fx-ivory/60">
          <span suppressHydrationWarning>© {new Date().getFullYear()} Fattixx · All prices include mandatory fees</span>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
            {LEGAL.map((l) => (
              <Link key={l.href} href={l.href} className={link}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
