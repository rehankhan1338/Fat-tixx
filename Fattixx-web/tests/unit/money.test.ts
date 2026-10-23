import { describe, expect, it } from "vitest";
import { bpsOf, centsToDollarsInput, formatCents, parseDollarsToCents, priceOrder, type FeeConfig } from "@/lib/money";

const fees: FeeConfig = { platformFeeBps: 500, platformFeeFixedCents: 99, processingFeeBps: 290, processingFeeFixedCents: 30 };

describe("money helpers", () => {
  it("formats cents as currency", () => {
    expect(formatCents(2849)).toBe("$28.49");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(123456, "EUR")).toBe("€1,234.56");
  });

  it("computes basis points with half-up rounding", () => {
    expect(bpsOf(2500, 500)).toBe(125);
    expect(bpsOf(1, 500)).toBe(0);
    expect(bpsOf(999, 290)).toBe(29);
  });

  it("parses dollar input strictly", () => {
    expect(parseDollarsToCents("25")).toBe(2500);
    expect(parseDollarsToCents("25.5")).toBe(2550);
    expect(parseDollarsToCents("$1,200.00")).toBe(120000);
    expect(parseDollarsToCents("0")).toBe(0);
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("1.234")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(centsToDollarsInput(2550)).toBe("25.50");
  });
});

describe("priceOrder", () => {
  it("buyer pays: adds platform fee per ticket, tax on price, processing on the charged amount", () => {
    const p = priceOrder([{ unitPriceCents: 2500, quantity: 2 }], fees, 500, "buyer_pays");
    expect(p.subtotalCents).toBe(5000);
    expect(p.perUnitPlatformFee).toEqual([125 + 99]);
    expect(p.platformFeeCents).toBe(448);
    expect(p.perUnitTax).toEqual([125]);
    expect(p.taxCents).toBe(250);
    // processing on subtotal + tax + platform fee = 5698 → 2.9% = 165.24 → 165 + 30
    expect(p.processingFeeCents).toBe(195);
    expect(p.totalCents).toBe(5000 + 448 + 250 + 195);
    expect(p.absorbedFeeCents).toBe(0);
  });

  it("organizer absorbs: buyer pays price + tax only, fees recorded as absorbed", () => {
    const p = priceOrder([{ unitPriceCents: 2500, quantity: 1 }], fees, 500, "organizer_absorbs");
    expect(p.totalCents).toBe(2500 + 125);
    expect(p.platformFeeCents).toBe(0);
    expect(p.processingFeeCents).toBe(0);
    // absorbed = platform (125+99) + processing on (2500+125) = 76.125 → 76 + 30
    expect(p.absorbedFeeCents).toBe(224 + 106);
  });

  it("free tickets carry no fees, tax or processing", () => {
    const p = priceOrder([{ unitPriceCents: 0, quantity: 3 }], fees, 500, "buyer_pays");
    expect(p.totalCents).toBe(0);
    expect(p.platformFeeCents).toBe(0);
    expect(p.processingFeeCents).toBe(0);
    expect(p.taxCents).toBe(0);
  });

  it("mixed free and paid lines only charge processing once per order", () => {
    const p = priceOrder([{ unitPriceCents: 0, quantity: 2 }, { unitPriceCents: 1000, quantity: 1 }], fees, 0, "buyer_pays");
    expect(p.perUnitPlatformFee).toEqual([0, 50 + 99]);
    expect(p.processingFeeCents).toBe(Math.round((1000 + 149) * 0.029) + 30);
    expect(p.totalCents).toBe(1000 + 149 + p.processingFeeCents);
  });

  it("caps the platform fee per ticket (the plan's 6.5% + $1.29, at most $19.95, processing included)", () => {
    const plan: FeeConfig = { platformFeeBps: 650, platformFeeFixedCents: 129, processingFeeBps: 0, processingFeeFixedCents: 0, platformFeeCapCents: 1995 };
    // $50: 3.25 + 1.29 = 4.54, under the cap
    expect(priceOrder([{ unitPriceCents: 5000, quantity: 1 }], plan, 0, "buyer_pays").perUnitPlatformFee).toEqual([454]);
    // $500: 32.50 + 1.29 = 33.79, capped at 19.95 per ticket
    const p = priceOrder([{ unitPriceCents: 50000, quantity: 2 }], plan, 0, "buyer_pays");
    expect(p.perUnitPlatformFee).toEqual([1995]);
    expect(p.platformFeeCents).toBe(3990);
    expect(p.processingFeeCents).toBe(0);
    expect(p.totalCents).toBe(100000 + 3990);
    // organizer absorbs: the capped fee comes off the payout
    expect(priceOrder([{ unitPriceCents: 50000, quantity: 1 }], plan, 0, "organizer_absorbs").absorbedFeeCents).toBe(1995);
    // no cap configured: unchanged
    expect(priceOrder([{ unitPriceCents: 50000, quantity: 1 }], { ...plan, platformFeeCapCents: 0 }, 0, "buyer_pays").perUnitPlatformFee).toEqual([3379]);
  });

  it("never produces negative or fractional cents", () => {
    for (const price of [1, 7, 33, 999, 12345]) {
      const p = priceOrder([{ unitPriceCents: price, quantity: 3 }], fees, 725, "buyer_pays");
      for (const v of [p.subtotalCents, p.platformFeeCents, p.processingFeeCents, p.taxCents, p.totalCents]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
