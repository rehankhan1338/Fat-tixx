"use client";

/* Sample venue only. TODO(seating): load layouts and availability from the Venue Library. */

import { useState } from "react";
import { cx } from "@/components/ui/styles";
import { useFees } from "@/lib/home/fees-context";
import { feeBreakdown, formatCents } from "@/lib/home/pricing";
import type { FeeConfig } from "@/lib/home/pricing";

type Tier = { name: string; priceCents: number; rows: string[]; color: string; on: string };

const TIERS: Tier[] = [
  { name: "VIP", priceCents: 15000, rows: ["A", "B"], color: "#A8121A", on: "#F5F1EA" },
  { name: "Premium", priceCents: 9500, rows: ["C", "D"], color: "#E06A72", on: "#3B0508" },
  { name: "Standard", priceCents: 6500, rows: ["E", "F", "G"], color: "#FFD23F", on: "#6E0A10" },
  { name: "Balcony", priceCents: 4500, rows: ["H", "I"], color: "#D9B38C", on: "#4E070B" },
];

const PER_ROW = 12;
const ACCESSIBLE = new Set(["E1", "E12"]);
const SOLD = new Set(["A4", "A5", "A6", "A7", "B6", "B7", "C2", "C3", "C10", "D5", "D6", "D7", "D8", "E6", "E7", "F3", "F4", "F9", "G7", "H1", "H2", "H11", "H12", "I6", "I7"]);

const allInWith = (fees: FeeConfig) => (cents: number) => feeBreakdown(cents, "buyer", fees).buyerPaysCents;

function AccessibleIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="4" r="1.6" fill="currentColor" stroke="none" />
      <path d="M11 7.5V13h5l2.5 6" />
      <path d="M8 10.5a5.5 5.5 0 1 0 7.5 7" />
    </svg>
  );
}

export default function SeatMapDemo({ className }: { className?: string }) {
  const allIn = allInWith(useFees());
  const [picked, setPicked] = useState<string>("C7");
  const pickedRow = picked[0];
  const pickedTier = TIERS.find((t) => t.rows.includes(pickedRow))!;

  return (
    <div className={cx("rounded-[28px] border border-fx-red/12 bg-white p-[clamp(18px,3vw,32px)] shadow-[0_18px_40px_-30px_rgba(168,18,26,.45)]", className)}>
      <div className="mx-auto mb-6 w-[70%] rounded-full bg-fx-red/8 py-2 text-center text-[12px] font-semibold tracking-[.16em] text-fx-red/78 uppercase">Stage</div>

      <div role="group" aria-label="Seat map, sample venue" className="grid gap-[6px]">
        {TIERS.map((tier) => (
          <div key={tier.name} className={cx("grid gap-[6px]", tier.name === "Balcony" && "mt-4 border-t border-dashed border-fx-red/20 pt-4")}>
            {tier.rows.map((row) => (
              <div key={row} className="flex items-center justify-center gap-[clamp(3px,.6vw,6px)]">
                <span className="w-4 shrink-0 text-center text-[11px] font-semibold text-fx-red/78">{row}</span>
                {Array.from({ length: PER_ROW }, (_, i) => {
                  const n = i + 1;
                  const id = `${row}${n}`;
                  const sold = SOLD.has(id);
                  const acc = ACCESSIBLE.has(id);
                  const on = picked === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={sold}
                      aria-pressed={on}
                      aria-label={`Row ${row}, seat ${n}, ${tier.name}${acc ? ", accessible" : ""}${sold ? ", sold" : `, ${formatCents(allIn(tier.priceCents))}`}`}
                      onClick={() => setPicked(id)}
                      className={cx(
                        "grid aspect-square w-[clamp(14px,2.2vw,24px)] cursor-pointer place-items-center rounded-t-[7px] rounded-b-[4px] text-[9px] font-bold transition-[transform,box-shadow] duration-150 hover:-translate-y-px disabled:cursor-not-allowed disabled:hover:translate-y-0",
                        i === PER_ROW / 2 && "ml-[clamp(8px,1.6vw,18px)]",
                        on && "ring-2 ring-fx-ink ring-offset-2",
                      )}
                      style={sold ? { background: "rgba(168,18,26,.1)" } : { background: tier.color, color: tier.on }}
                    >
                      {acc && !sold && <AccessibleIcon size={11} />}
                    </button>
                  );
                })}
                <span className="w-4 shrink-0" />
              </div>
            ))}
          </div>
        ))}
      </div>

      <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[13px] text-fx-red/78">
        {TIERS.map((t) => (
          <li key={t.name} className="flex items-center gap-2">
            <span className="size-3 rounded-[3px]" style={{ background: t.color }} />
            {t.name} {formatCents(allIn(t.priceCents))}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="size-3 rounded-[3px] bg-fx-red/10" />
          Sold
        </li>
        <li className="flex items-center gap-[6px]">
          <AccessibleIcon size={14} />
          Accessible
        </li>
      </ul>

      <div aria-live="polite" className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[18px] bg-fx-ivory px-5 py-4">
        <div>
          <p className="text-[13px] text-fx-red/78">
            {pickedTier.name} · Row {pickedRow} · Seat {picked.slice(1)}
            {ACCESSIBLE.has(picked) ? " · Accessible" : ""}
          </p>
          <p className="font-display text-[24px] font-semibold tracking-[-0.02em] tabular-nums">{formatCents(allIn(pickedTier.priceCents))}</p>
        </div>
        <span className="text-[13px] text-fx-red/78">All-in price, fees included</span>
      </div>
    </div>
  );
}
