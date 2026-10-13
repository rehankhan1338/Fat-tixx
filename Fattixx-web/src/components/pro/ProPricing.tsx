"use client";

/*
 * Standard (free) next to Pro, with a monthly / yearly switch on the Pro price.
 * Pro is billed on top of the same per-ticket fee every organizer pays (lib/pricing.ts).
 */

import Link from "next/link";
import { useState } from "react";
import { button, cardShadow, container, cx, eyebrow, sectionTitle } from "@/components/ui/styles";
import { useFees } from "@/lib/home/fees-context";
import { feeLabel, formatCents, processingLabel } from "@/lib/home/pricing";
import { PRO_FEATURES, PRO_MONTHLY_CENTS, PRO_SIGNUP_HREF, PRO_YEARLY_CENTS, PRO_YEARLY_MONTHLY_CENTS, PRO_YEARLY_SAVINGS_CENTS, STANDARD_INCLUDES } from "@/lib/home/pro";
import type { Billing } from "@/lib/home/pro";
import { CheckIcon } from "./icons";

export default function ProPricing({ className, contactEmail }: { className?: string; contactEmail: string }) {
  const fees = useFees();
  const FEE_LABEL = feeLabel(fees);
  const processing = processingLabel(fees);
  const [billing, setBilling] = useState<Billing>("yearly");
  const perMonth = billing === "yearly" ? PRO_YEARLY_MONTHLY_CENTS : PRO_MONTHLY_CENTS;

  return (
    <section id="pricing" aria-labelledby="pro-pricing-h" className={cx(container, "scroll-mt-[104px]", className)}>
      <div className="text-center">
        <div className={eyebrow}>Pricing</div>
        <h2 id="pro-pricing-h" className={cx(sectionTitle, "mt-3 text-[clamp(32px,3.6vw,48px)] leading-none tracking-[-0.04em]")}>
          One plan. Cancel anytime.
        </h2>
        <p className="mx-auto mt-[14px] max-w-[560px] text-[16px] leading-[1.6] text-fx-red/78">
          Every organizer can create, sell and scan for free. Pro adds your brand and the tools to grow, for one monthly price.
        </p>

        <div role="group" aria-label="Billing" className="mt-7 inline-flex gap-1 rounded-full bg-fx-sand p-1">
          {(
            [
              ["monthly", "Monthly"],
              ["yearly", `Yearly · save ${formatCents(PRO_YEARLY_SAVINGS_CENTS).replace(".00", "")}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={billing === k}
              onClick={() => setBilling(k)}
              className={cx(
                "min-h-11 cursor-pointer rounded-full px-5 text-[14px] font-semibold transition-colors duration-200",
                billing === k ? "bg-fx-red text-fx-ivory" : "bg-transparent text-fx-red",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-10 grid max-w-[980px] grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] items-stretch gap-5 max-[901px]:grid-cols-1">
        {/* standard */}
        <div className={cx("flex flex-col rounded-[28px] border border-fx-red/12 bg-white p-[clamp(24px,3.4vw,40px)]", cardShadow)}>
          <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em]">Standard</h3>
          <p className="mt-4 flex items-baseline gap-2">
            <span className="font-display text-[52px] leading-none font-bold tracking-[-0.05em]">$0</span>
            <span className="text-[15px] text-fx-red/78">a month</span>
          </p>
          <p className="mt-2 text-[14px] text-fx-red/78">Plus {FEE_LABEL} per paid ticket.</p>
          <ul className="mt-7 grid gap-3 text-[15px]">
            {STANDARD_INCLUDES.map((f) => (
              <li key={f} className="flex gap-3">
                <span className="mt-[2px] shrink-0 text-fx-red/78">
                  <CheckIcon />
                </span>
                {f}
              </li>
            ))}
          </ul>
          <Link href="/create" className={cx(button("outline"), "mt-auto self-start max-[901px]:mt-8")}>
            Create an event
          </Link>
        </div>

        {/* pro */}
        <div className="relative flex flex-col overflow-hidden rounded-[28px] bg-fx-red p-[clamp(24px,3.4vw,40px)] text-fx-ivory shadow-[0_34px_60px_-30px_rgba(78,7,11,.6)]">
          <h3 className="font-display text-[22px] font-semibold tracking-[-0.02em]">Fattixx Pro</h3>
          <p className="mt-4 flex items-baseline gap-2" aria-live="polite">
            <span className="font-display text-[52px] leading-none font-bold tracking-[-0.05em] tabular-nums">{formatCents(perMonth)}</span>
            <span className="text-[15px] text-fx-ivory/85">a month</span>
          </p>
          <p className="mt-2 text-[14px] text-fx-ivory/85">
            {billing === "yearly" ? `Billed ${formatCents(PRO_YEARLY_CENTS)} once a year.` : `Billed monthly. ${formatCents(PRO_YEARLY_MONTHLY_CENTS)} a month if you pay yearly.`} Same per-ticket fee.
          </p>
          <p className="mt-7 text-[13px] font-semibold tracking-[.12em] text-fx-ivory/85 uppercase">Everything in Standard, plus</p>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[15px] max-[641px]:grid-cols-1">
            {PRO_FEATURES.map((f) => (
              <li key={f.key} className="flex gap-3">
                <span className="mt-[2px] shrink-0 text-fx-yellow">
                  <CheckIcon />
                </span>
                {f.title}
              </li>
            ))}
          </ul>
          <div className="mt-9 flex flex-wrap gap-[10px]">
            <Link href={PRO_SIGNUP_HREF} className={button("primary")}>
              Get Fattixx Pro
            </Link>
            <a href={`mailto:${contactEmail}?subject=Fattixx%20Pro`} className="inline-flex min-h-[46px] items-center justify-center rounded-full border border-fx-ivory/40 px-[22px] text-[15px] font-semibold whitespace-nowrap text-fx-ivory transition-colors duration-200 hover:border-fx-ivory">
              Talk to us
            </a>
          </div>
        </div>
      </div>

      <p className="mx-auto mt-6 max-w-[760px] text-center text-[13px] leading-[1.6] text-fx-red/78">
        The per-ticket fee is the same on every plan: {FEE_LABEL}{processing ? `, plus card processing of ${processing}` : ", card processing included"}. Seat maps from the Fattixx
        Venue Library are free to use; building a new map for your venue may have a one-time setup fee.
      </p>
    </section>
  );
}
