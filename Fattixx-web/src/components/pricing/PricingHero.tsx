"use client";

/* Fee calculator: pick a ticket price and see what the buyer pays and the organizer receives, from the live fee settings. */

import { useState } from "react";
import { LogoMark } from "@/components/home/icons";
import { cx, eyebrow, sectionTitle } from "@/components/ui/styles";
import { useFees } from "@/lib/home/fees-context";
import { feeBreakdown, formatCents, parseDollars, processingLabel } from "@/lib/home/pricing";
import type { FeePayer } from "@/lib/home/pricing";
import type { PricingContent } from "@/lib/site-content/schema";
import { Lines } from "@/lib/site-content/inline";

const PRESETS = [0, 1000, 2500, 5000, 10000, 35000];

const pill = "min-h-11 cursor-pointer rounded-full border px-[18px] text-[14px] font-semibold transition-[background-color,color,border-color] duration-200";

/** Copy comes from Super Admin → Website → Pricing; the figures from the live fee settings. */
export default function PricingHero({ content: c }: { content: PricingContent["hero"] }) {
  const fees = useFees();
  const [text, setText] = useState("25");
  const [payer, setPayer] = useState<FeePayer>("buyer");

  const cents = parseDollars(text);
  const b = feeBreakdown(cents, payer, fees);
  const processing = processingLabel(fees);

  return (
    <section aria-labelledby="pricing-h" className="relative bg-fx-white px-(--pad) pt-[168px] max-[901px]:pt-[128px]">
      <div className="text-center">
        <div className={eyebrow}>{c.eyebrow}</div>
        <h1 id="pricing-h" className={cx(sectionTitle, "mx-auto mt-4 max-w-[960px] text-[clamp(44px,6vw,88px)] leading-[.94] tracking-[-0.05em]")}>
          <Lines text={c.title} />
        </h1>
        <p className="mx-auto mt-5 max-w-[520px] text-[18px] leading-[1.6] text-fx-red/78 max-[641px]:text-[16px]">{c.lead}</p>
      </div>

      <div className="mx-auto mt-11 flex max-w-[1040px] flex-wrap items-end justify-center gap-x-7 gap-y-4">
        <div className="w-[260px] max-w-full">
          <label htmlFor="ticket-price" className="block text-[14px] font-semibold">
            Ticket price
          </label>
          <div className="mt-[10px] flex h-[60px] items-center gap-1 rounded-full border border-fx-red/30 bg-white px-5 focus-within:border-fx-red">
            <span aria-hidden="true" className="font-display text-[26px] font-semibold text-fx-ink">
              $
            </span>
            <input
              id="ticket-price"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setText(cents ? String(cents / 100) : "0")}
              className="w-full min-w-0 border-0 bg-transparent p-0 font-display text-[26px] font-semibold text-fx-ink outline-none focus-visible:outline-none"
            />
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-2" role="group" aria-label="Example prices">
          {PRESETS.map((v) => {
            const on = v === cents;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => setText(String(v / 100))}
                className={cx(pill, on ? "border-fx-red bg-fx-red text-fx-ivory" : "border-fx-red/30 bg-transparent text-fx-red hover:border-fx-red")}
              >
                {v === 0 ? "Free" : formatCents(v).replace(".00", "")}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mx-auto mt-12 flex max-w-[1040px] drop-shadow-[0_34px_34px_rgba(78,7,11,.35)] max-[901px]:max-w-[560px] max-[901px]:flex-col">
        <div className="relative flex min-h-[320px] flex-[1.75_1_0] flex-col justify-between gap-8 overflow-hidden rounded-l-[28px] bg-fx-red px-12 py-10 text-fx-ivory max-[901px]:min-h-0 max-[901px]:flex-none max-[901px]:rounded-tr-[28px] max-[901px]:rounded-bl-none max-[641px]:px-7 max-[641px]:py-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-10 -bottom-[70px] font-display text-[280px] leading-none font-extrabold tracking-[-0.06em] text-fx-red-dark max-[641px]:text-[200px]">
            TIX
          </div>
          <div className="relative flex items-center gap-[10px] text-[13px] font-semibold tracking-[.14em] text-fx-ivory/85 uppercase">
            <LogoMark />
            {c.ticketLabel}
          </div>
          <div className="relative">
            <div className="text-[15px] text-fx-ivory/85">{c.ticketType}</div>
            <div className="mt-[6px] font-display text-[clamp(56px,8vw,112px)] leading-[.9] font-bold tracking-[-0.05em] tabular-nums">{cents === 0 ? "Free" : formatCents(b.priceCents)}</div>
          </div>
          <div className="relative text-[14px] text-fx-ivory/85">{c.ticketTagline}</div>
        </div>

        <div
          className="flex-[1_1_0] rounded-r-[28px] border-l-[3px] border-dashed border-fx-red/25 bg-white px-9 pt-9 pb-8 text-fx-red max-[901px]:flex-none max-[901px]:rounded-tr-none max-[901px]:rounded-bl-[28px] max-[901px]:border-t-[3px] max-[901px]:border-l-0 max-[641px]:px-7"
          aria-live="polite"
        >
          <div className="text-[12px] font-bold tracking-[.14em] uppercase">Receipt</div>
          <dl className="mt-[14px] tabular-nums">
            <Line label="Ticket" value={formatCents(b.priceCents)} />
            <Line label={c.feeLabel} value={formatCents(b.feeCents)} />
            <Line label="Card processing" value={processing ? formatCents(b.processingCents) : "Included"} />
          </dl>
          <div className="mt-[18px] flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-bold">Buyer pays</span>
            <b className="font-display text-[40px] font-bold tracking-[-0.03em] tabular-nums max-[641px]:text-[34px]">{formatCents(b.buyerPaysCents)}</b>
          </div>
          <div className="mt-[6px] flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-bold">You receive</span>
            <b className="font-display text-[26px] font-bold tracking-[-0.02em] tabular-nums">{formatCents(b.organizerGetsCents)}</b>
          </div>
        </div>
      </div>

      <div className="relative z-[1] mx-auto flex max-w-[1040px] flex-wrap items-center justify-center gap-x-5 gap-y-3 pt-9 pb-[150px] max-[641px]:pb-[120px]">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <span id="payer-l" className="text-[14px] font-semibold">
            {c.payerQuestion}
          </span>
          <div role="group" aria-labelledby="payer-l" className="inline-flex gap-1 rounded-full bg-fx-sand p-1">
            {(
              [
                ["buyer", c.payerBuyer],
                ["organizer", c.payerOrganizer],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={payer === k}
                onClick={() => setPayer(k)}
                className={cx("min-h-11 cursor-pointer rounded-full px-5 text-[14px] font-semibold transition-colors duration-200", payer === k ? "bg-fx-red text-fx-ivory" : "bg-transparent text-fx-red")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="m-0 max-w-[360px] text-center text-[14px] leading-[1.55] text-fx-red/78">
          {payer === "buyer" ? c.buyerNote : c.organizerNote} {c.taxNote}
        </p>
      </div>

      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -bottom-px h-[90px] rounded-[50%_50%_0_0/90px_90px_0_0] bg-fx-ivory max-[641px]:h-[48px] max-[641px]:rounded-[50%_50%_0_0/48px_48px_0_0]" />
    </section>
  );
}

function Line({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-fx-red/20 py-[10px]">
      <dt className="text-[15px]">{label}</dt>
      <dd className="m-0 text-[17px] font-bold">{value}</dd>
    </div>
  );
}
