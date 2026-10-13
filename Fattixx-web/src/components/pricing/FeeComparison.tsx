"use client";

/* Fattixx fees (platform + card processing) next to another platform's published rates, from the live fee settings. */

import { useState } from "react";
import { cardShadow, container, cx, eyebrow, sectionTitle } from "@/components/ui/styles";
import { useFees } from "@/lib/home/fees-context";
import { formatCents, otherPlatformFee, savingsPerTicket, ticketFee } from "@/lib/home/pricing";
import type { PricingContent } from "@/lib/site-content/schema";
import { Lines } from "@/lib/site-content/inline";

const PRICES = [1000, 2500, 5000, 10000, 35000];
const COUNTS = [100, 250, 500, 1000];
const TABLE = [1000, 2500, 5000, 10000, 25000, 35000];

const chip = "min-h-11 cursor-pointer rounded-full border px-4 text-[14px] font-semibold tabular-nums transition-[background-color,color,border-color] duration-200";
const chipOn = "border-fx-red bg-fx-red text-fx-ivory";
const chipOff = "border-fx-red/30 bg-transparent text-fx-red hover:border-fx-red";

const short = (c: number) => formatCents(c).replace(".00", "");

/** Copy and the other platform's rates come from Super Admin → Website → Pricing; Fattixx fees from the live fee settings. */
export default function FeeComparison({ content: c }: { content: PricingContent["compare"] }) {
  const fees = useFees();
  const [price, setPrice] = useState(2500);
  const [count, setCount] = useState(250);
  const competitor = c.competitor;
  const OTHER = competitor.label;

  const total = (p: number) => {
    const f = ticketFee(p, fees);
    return f.feeCents + f.processingCents;
  };
  const ours = total(price);
  const theirs = otherPlatformFee(price, competitor);
  const save = savingsPerTicket(price, fees, competitor);
  const oursPct = Math.min(100, Math.max(4, Math.round((ours / Math.max(1, theirs)) * 100)));

  return (
    <section aria-labelledby="compare-h" className={cx(container, "pt-[120px] max-[721px]:pt-[88px]")}>
      <div className={eyebrow}>{c.eyebrow}</div>
      <h2 id="compare-h" className={cx(sectionTitle, "mt-3 text-[clamp(32px,3.6vw,48px)] leading-none tracking-[-0.04em]")}>
        <Lines text={c.title} />
      </h2>
      <p className="mt-[14px] mb-8 max-w-[600px] text-[16px] leading-[1.6] text-fx-red/78">{c.lead}</p>

      <div className="reveal grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-4 max-[901px]:grid-cols-1">
        <div className={cx("rounded-[28px] border border-fx-red/14 bg-white p-[clamp(24px,3.5vw,40px)]", cardShadow)}>
          <div className="flex flex-wrap gap-x-10 gap-y-5">
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="p-0 text-[14px] font-semibold">Ticket price</legend>
              <div className="mt-[10px] flex flex-wrap gap-2">
                {PRICES.map((p) => (
                  <button key={p} type="button" aria-pressed={p === price} onClick={() => setPrice(p)} className={cx(chip, p === price ? chipOn : chipOff)}>
                    {short(p)}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="m-0 min-w-0 border-0 p-0">
              <legend className="p-0 text-[14px] font-semibold">Tickets sold</legend>
              <div className="mt-[10px] flex flex-wrap gap-2">
                {COUNTS.map((n) => (
                  <button key={n} type="button" aria-pressed={n === count} onClick={() => setCount(n)} className={cx(chip, n === count ? chipOn : chipOff)}>
                    {n.toLocaleString("en-US")}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="mt-9 flex flex-col gap-6" aria-live="polite">
            <Bar label="Fattixx" fee={formatCents(ours)} width={oursPct} strong />
            <Bar label={OTHER} fee={formatCents(theirs)} width={100} />
          </div>
          <p className="mt-6 text-[13px] leading-[1.55] text-fx-red/78">Fees per ticket on a {short(price)} ticket, card processing included on both sides.</p>
        </div>

        <div className="relative flex flex-col justify-between gap-8 overflow-hidden rounded-[28px] bg-fx-red p-[clamp(24px,3.5vw,40px)] text-fx-ivory">
          <div aria-hidden="true" className="pointer-events-none absolute -right-6 -bottom-12 font-display text-[200px] leading-none font-extrabold tracking-[-0.06em] text-fx-red-dark">
            $
          </div>
          <div className="relative">
            <div className="text-[12px] font-semibold tracking-[.14em] text-fx-ivory/85 uppercase">You save</div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-[32px] font-bold tracking-[-0.03em] tabular-nums">{formatCents(save)}</span>
              <span className="text-[15px] text-fx-ivory/85">per ticket</span>
            </div>
          </div>
          <div className="relative" aria-live="polite">
            <div className="text-[15px] text-fx-ivory/85">On {count.toLocaleString("en-US")} tickets</div>
            <div className="mt-1 font-display text-[clamp(56px,6vw,84px)] leading-[.9] font-bold tracking-[-0.05em] text-fx-yellow tabular-nums">{formatCents(save * count)}</div>
            <p className="mt-4 max-w-[340px] text-[15px] leading-[1.55] text-fx-ivory/85">{c.saveNote}</p>
          </div>
        </div>
      </div>

      <ul className="m-0 mt-4 hidden list-none flex-col gap-3 p-0 max-[641px]:flex">
        {TABLE.map((p) => (
          <li key={p} className={cx("rounded-[20px] border border-fx-red/14 bg-white px-5 py-4", cardShadow)}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-[22px] font-semibold tracking-[-0.02em]">{formatCents(p)}</span>
              <span className="text-[15px] font-bold text-fx-red-second tabular-nums">Save {formatCents(savingsPerTicket(p, fees, competitor))}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-fx-red/10 pt-3 text-[14px] tabular-nums">
              <div>
                <dt className="text-fx-red/78">Fattixx</dt>
                <dd className="m-0 mt-[2px] font-semibold">{formatCents(total(p))}</dd>
              </div>
              <div>
                <dt className="text-fx-red/78">{OTHER}</dt>
                <dd className="m-0 mt-[2px] font-semibold">{formatCents(otherPlatformFee(p, competitor))}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <div className={cx("mt-4 overflow-x-auto rounded-3xl border border-fx-red/14 bg-white max-[641px]:hidden", cardShadow)}>
        <table className="w-full min-w-[600px] border-collapse text-[15px]">
          <caption className="sr-only">Fee per ticket, Fattixx compared with {OTHER.toLowerCase()}</caption>
          <thead>
            <tr>
              <th scope="col" className={cx(th, "text-left")}>
                Ticket price
              </th>
              <th scope="col" className={cx(th, "text-right")}>
                Fattixx fees
              </th>
              <th scope="col" className={cx(th, "text-right")}>
                {OTHER} fees
              </th>
              <th scope="col" className={cx(th, "text-right")}>
                You save per ticket
              </th>
            </tr>
          </thead>
          <tbody>
            {TABLE.map((p) => (
              <tr key={p} className="[&:last-child>*]:border-b-0">
                <th scope="row" className={cx(td, "text-left font-display text-[18px] font-semibold")}>
                  {formatCents(p)}
                </th>
                <td className={cx(td, "text-right font-semibold")}>{formatCents(total(p))}</td>
                <td className={cx(td, "text-right text-fx-red/78")}>{formatCents(otherPlatformFee(p, competitor))}</td>
                <td className={cx(td, "text-right")}>
                  <span className="inline-block rounded-full bg-fx-yellow px-3 py-1 font-bold text-fx-red">{formatCents(savingsPerTicket(p, fees, competitor))}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {c.footnote && <p className="mt-5 max-w-[860px] text-[13px] leading-[1.6] text-fx-red/78">{c.footnote}</p>}
    </section>
  );
}

const th = "px-5 py-4 text-[12px] font-semibold tracking-[.12em] text-fx-red/78 uppercase border-b border-fx-red/14 align-bottom";
const td = "px-5 py-[16px] border-b border-fx-red/10 tabular-nums";

function Bar({ label, fee, width, strong }: { label: string; fee: string; width: number; strong?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cx("text-[15px]", strong ? "font-bold" : "text-fx-red/78")}>{label}</span>
        <b className={cx("font-display tracking-[-0.02em] tabular-nums", strong ? "text-[28px]" : "text-[22px] text-fx-red/78")}>{fee}</b>
      </div>
      <div className="mt-2 h-4 overflow-hidden rounded-full bg-fx-sand">
        <div className={cx("h-full rounded-full transition-[width] duration-500 ease-fx", strong ? "bg-fx-red" : "bg-fx-red/30")} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
