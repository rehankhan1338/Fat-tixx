/* Shared public footer. Blurb, link columns, social profiles and the legal line come from src/lib/site-content/schema.ts. */

import Link from "next/link";
import Logo from "@/components/home/Logo";
import SocialIcon, { SOCIAL_NETWORKS } from "@/components/ui/SocialIcon";
import { container, cx } from "@/components/ui/styles";
import type { FooterContent } from "@/lib/site-content/schema";
import FooterLink from "./FooterLink";

const link = "rounded-sm text-fx-ivory/70 transition-colors duration-200 hover:text-fx-ivory";

export default function SiteFooter({ content: c }: { content: FooterContent }) {
  const social = c.social.filter((s) => s.href && SOCIAL_NETWORKS[s.network]);
  return (
    <footer className="relative isolate overflow-hidden bg-fx-red-night text-fx-ivory" aria-labelledby="footer-h">
      <h2 id="footer-h" className="sr-only">
        Site links
      </h2>

      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 drop-shadow-[0_10px_12px_rgba(50,3,7,.45)]" aria-hidden="true">
        <div className="absolute inset-x-0 top-0 h-[120px] translate-y-[6px] rounded-[0_0_50%_50%/0_0_64px_64px] bg-fx-footer-edge max-[641px]:h-[76px] max-[641px]:rounded-[0_0_50%_50%/0_0_32px_32px]" />
        <div className="absolute inset-x-0 top-0 h-[120px] rounded-[0_0_50%_50%/0_0_64px_64px] bg-fx-ivory max-[641px]:h-[76px] max-[641px]:rounded-[0_0_50%_50%/0_0_32px_32px]" />
      </div>

      <div className={cx(container, "pt-[200px] max-[641px]:pt-[136px]")}>
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-8 gap-y-10 max-[901px]:grid-cols-3 max-[641px]:grid-cols-2">
          <div className="max-[901px]:col-span-full">
            <Link href="/" className="inline-flex items-center" aria-label="Fattixx home">
              <Logo height={48} />
            </Link>
            <p className="mt-3 max-w-[260px] text-[15px] leading-[1.55] text-fx-ivory/70">{c.blurb}</p>
            {social.length > 0 && (
              <ul className="mt-6 flex gap-[10px]" aria-label="Fattixx on social media">
                {social.map((n) => (
                  <li key={n.network}>
                    <a
                      href={n.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Fattixx on ${SOCIAL_NETWORKS[n.network].label}`}
                      className="grid size-11 place-items-center rounded-full border border-fx-ivory/18 text-fx-ivory/80 transition-colors duration-200 hover:border-fx-yellow hover:bg-fx-yellow hover:text-fx-red"
                    >
                      <SocialIcon network={n.network} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {c.columns.map((col, i) => (
            <nav key={i} aria-label={col.title}>
              <h3 className="font-display text-[16px] font-semibold tracking-[-0.01em]">{col.title}</h3>
              <ul className="mt-4 flex flex-col gap-3 text-[14px]">
                {col.links.map((l, k) => (
                  <li key={k}>
                    {l.href.startsWith("/") ? (
                      <FooterLink href={l.href} className={link}>
                        {l.label}
                      </FooterLink>
                    ) : (
                      <a href={l.href} className={link} {...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-x-7 gap-y-3 border-t border-fx-ivory/12 py-6 text-[13px] text-fx-ivory/60 max-[641px]:mt-12">
          <span>{c.copyright}</span>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
            {c.legal.map((l, k) => (
              <FooterLink key={k} href={l.href} className={link}>
                {l.label}
              </FooterLink>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
