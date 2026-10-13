/* Organizer band on the homepage. Copy and fee points come from Super Admin → Website (tokens such as {fee} are filled from the live fee settings). */

import { button, cardShadow, container, cx, eyebrow, sectionTitle } from "@/components/ui/styles";
import type { HomeContent } from "@/lib/site-content/schema";
import { Lines } from "@/lib/site-content/inline";

export default function HostBand({ content: c, createHref }: { content: HomeContent["host"]; createHref?: string }) {
  return (
    <section className="relative bg-fx-ivory pt-[110px] max-[721px]:pt-[88px]" id="host" aria-labelledby="host-h">
      <div className={container}>
        <div
          className={cx(
            "reveal relative grid grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] items-center gap-12 overflow-hidden rounded-[28px] border border-fx-red/14 bg-white p-[clamp(32px,5vw,64px)] max-[901px]:grid-cols-1",
            cardShadow,
          )}
        >
          <div>
            <div className={eyebrow}>{c.eyebrow}</div>
            <h2 className={cx(sectionTitle, "mt-3 text-[clamp(34px,4.2vw,56px)] leading-none tracking-[-0.04em]")} id="host-h">
              <Lines text={c.title} />
            </h2>
            <p className="mt-4 max-w-[480px] text-[16px] leading-[1.6] text-fx-red/78">{c.lead}</p>
            <div className="mt-7 flex flex-wrap gap-[10px]">
              <a href={createHref ?? c.cta.href} className={button("primary")}>
                {c.cta.label}
              </a>
            </div>
          </div>
          <div className="relative grid">
            {c.stats.map((s, i) => (
              <div
                key={i}
                className={cx(
                  "flex items-baseline gap-[18px] border-t border-fx-red/14 py-[18px] max-[721px]:flex-col max-[721px]:gap-1",
                  i === c.stats.length - 1 && "border-b",
                )}
              >
                <b className="min-w-[150px] shrink-0 font-display text-[26px] font-semibold tracking-[-0.02em] text-fx-red-second">{s.big}</b>
                <span className="text-[14px] leading-[1.5] text-fx-red/78">{s.text}</span>
              </div>
            ))}
            {c.pricingLink.label && (
              <a
                href={c.pricingLink.href}
                className="mt-4 justify-self-start rounded-sm text-[15px] font-semibold text-fx-red underline decoration-fx-red/30 underline-offset-4 transition-colors hover:decoration-fx-red"
              >
                {c.pricingLink.label}
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
