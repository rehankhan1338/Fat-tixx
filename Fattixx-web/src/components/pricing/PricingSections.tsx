/* The fee rules, the FAQ and the closing call to action of /pricing. Copy comes from src/lib/site-content/schema.ts; fee figures are filled in from the live platform settings. */

import Link from "next/link";
import { button, cardShadow, container, cx, eyebrow, sectionTitle } from "@/components/ui/styles";
import type { PricingContent } from "@/lib/site-content/schema";
import { Lines, Rich } from "@/lib/site-content/inline";

const h2 = cx(sectionTitle, "mt-3 text-[clamp(32px,3.6vw,48px)] leading-none tracking-[-0.04em]");

/* the three rules */

export function FeeRules({ content: c }: { content: PricingContent["rules"] }) {
  return (
    <section aria-label="How the fee works" className={cx(container, "pt-10")}>
      <div className="grid grid-cols-3 gap-10 max-[901px]:grid-cols-1 max-[901px]:gap-8">
        {c.items.map((r, i) => (
          <div key={i} className="reveal border-t-2 border-fx-red pt-7">
            <div className="font-display text-[clamp(40px,4.4vw,64px)] leading-none font-bold tracking-[-0.05em]">{r.big}</div>
            <h3 className="mt-4 text-[16px] font-semibold">{r.title}</h3>
            <p className="mt-[6px] max-w-[320px] text-[15px] leading-[1.55] text-fx-red/78">{r.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* FAQ */

export function PricingFaq({ content: c }: { content: PricingContent["faq"] }) {
  return (
    <section aria-labelledby="faq-h" className={cx(container, "pt-[120px] max-[721px]:pt-[88px]")}>
      <div className="flex flex-wrap items-start gap-x-16 gap-y-8">
        <div className="flex-[1_1_300px]">
          <div className={eyebrow}>{c.eyebrow}</div>
          <h2 id="faq-h" className={h2}>
            <Lines text={c.title} />
          </h2>
          <p className="mt-[14px] max-w-[340px] text-[16px] leading-[1.6] text-fx-red/78">
            <Rich text={c.lead} />
          </p>
        </div>
        <div className="min-w-0 flex-[2_1_560px] border-b border-fx-red/14 max-[641px]:flex-[1_1_100%]">
          {c.items.map((f, i) => (
            <details key={i} open={i === 0} className="group border-t border-fx-red/14">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-[22px] font-display text-[20px] font-semibold tracking-[-0.02em] max-[641px]:text-[18px] [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fx-sand transition-transform duration-300 ease-fx group-open:rotate-45">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <p className="m-0 max-w-[720px] pr-[60px] pb-6 text-[16px] leading-[1.6] text-fx-red/78 max-[641px]:pr-0">
                <Rich text={f.a} />
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* closing call to action */

export function PricingCta({ content: c, contactEmail }: { content: PricingContent["cta"]; contactEmail: string }) {
  return (
    <section aria-labelledby="cta-h" className={cx(container, "pt-[120px] pb-[150px] max-[721px]:pt-[88px] max-[721px]:pb-[110px]")}>
      <div className={cx("reveal flex flex-wrap items-center justify-between gap-7 rounded-[28px] border border-fx-red/14 bg-white px-[clamp(28px,5vw,64px)] py-[clamp(32px,5vw,56px)]", cardShadow)}>
        <div>
          <h2 id="cta-h" className={cx(sectionTitle, "text-[clamp(30px,3.4vw,44px)] leading-[1.02] tracking-[-0.04em]")}>
            <Lines text={c.title} />
          </h2>
          <p className="mt-[10px] text-[16px] leading-[1.6] text-fx-red/78">{c.lead}</p>
        </div>
        <div className="flex flex-wrap gap-[10px]">
          <Link href={c.primary.href} className={button("primary")}>
            {c.primary.label}
          </Link>
          {c.secondaryLabel && (
            <a href={`mailto:${contactEmail}`} className={button("outline")}>
              {c.secondaryLabel}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
