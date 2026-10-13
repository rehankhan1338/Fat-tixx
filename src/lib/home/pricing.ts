/*
 * Fee previews for the public pages, computed from the platform's live fee settings (Admin → Settings) with the
 * same rounding as checkout (src/lib/money.ts). Pass the FeeConfig from the server (siteFees() in data.ts).
 */

import { priceOrder, type FeeConfig } from "../money";

export type { FeeConfig };
export type FeePayer = "buyer" | "organizer";

export type FeeBreakdown = {
  priceCents: number;
  /** platform fee on one ticket */
  feeCents: number;
  /** card processing on a one-ticket order */
  processingCents: number;
  /** what the buyer is charged for one ticket, fees included (tax, if any, is added at the venue's rate) */
  buyerPaysCents: number;
  /** what the organizer receives per ticket, before any refunds */
  organizerGetsCents: number;
};

/** Platform and processing fee on a single-ticket order at this price. */
export function ticketFee(priceCents: number, fees: FeeConfig): { feeCents: number; processingCents: number } {
  if (priceCents <= 0) return { feeCents: 0, processingCents: 0 };
  const p = priceOrder([{ unitPriceCents: priceCents, quantity: 1 }], fees, 0, "buyer_pays");
  return { feeCents: p.platformFeeCents, processingCents: p.processingFeeCents };
}

export function feeBreakdown(priceCents: number, payer: FeePayer, fees: FeeConfig): FeeBreakdown {
  if (priceCents <= 0) return { priceCents: 0, feeCents: 0, processingCents: 0, buyerPaysCents: 0, organizerGetsCents: 0 };
  const p = priceOrder([{ unitPriceCents: priceCents, quantity: 1 }], fees, 0, payer === "buyer" ? "buyer_pays" : "organizer_absorbs");
  const { feeCents, processingCents } = ticketFee(priceCents, fees);
  return {
    priceCents,
    feeCents,
    processingCents,
    buyerPaysCents: p.totalCents,
    organizerGetsCents: Math.max(0, priceCents - p.absorbedFeeCents),
  };
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** 2500 -> "$25.00" */
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** 650 bps -> "6.5%" */
export function percent(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(pct * 10 === Math.round(pct * 10) ? 1 : 2)}%`;
}

/** "5% + $0.99" (per paid ticket) */
export function feeLabel(fees: FeeConfig): string {
  const parts = [];
  if (fees.platformFeeBps) parts.push(percent(fees.platformFeeBps));
  if (fees.platformFeeFixedCents) parts.push(formatCents(fees.platformFeeFixedCents));
  return parts.join(" + ") || "$0";
}

/** "2.9% + $0.30 per order", or null when card processing is included */
export function processingLabel(fees: FeeConfig): string | null {
  const parts = [];
  if (fees.processingFeeBps) parts.push(percent(fees.processingFeeBps));
  if (fees.processingFeeFixedCents) parts.push(formatCents(fees.processingFeeFixedCents));
  return parts.length ? `${parts.join(" + ")} per order` : null;
}

/** "25", "$25.50", "1,200" -> cents (0 for empty or invalid), limited to $10,000 */
export function parseDollars(text: string): number {
  const n = parseFloat(text.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(n, 10000) * 100);
}

/* Comparison assumes processing on ticket price only. The other platform's rates are set in Super Admin → Website → Pricing. */
export type Competitor = { label: string; servicePercent: number; serviceFixedCents: number; processingPercent: number; checked: string };

/** The other platform's fee on one ticket at this price. */
export function otherPlatformFee(priceCents: number, c: Competitor): number {
  if (priceCents <= 0) return 0;
  return Math.round((priceCents * (c.servicePercent + c.processingPercent)) / 100) + c.serviceFixedCents;
}

/** How much less the Fattixx fees (platform + processing) are than the other platform's on one ticket. */
export function savingsPerTicket(priceCents: number, fees: FeeConfig, c: Competitor): number {
  const ours = ticketFee(priceCents, fees);
  return Math.max(0, otherPlatformFee(priceCents, c) - ours.feeCents - ours.processingCents);
}
