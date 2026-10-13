import { describe, expect, it } from "vitest";
import { priceOrder } from "@/lib/money";
import { shiftWallClock, utcToWallClock, wallClockToUtc } from "@/lib/tz";
import { accessCodeMatches, activeEventDate, questionOptions, publicEventPath, type EventDateRow } from "@/lib/events/queries";

const fees = { platformFeeBps: 500, platformFeeFixedCents: 99, processingFeeBps: 290, processingFeeFixedCents: 30 };

describe("add-on pricing", () => {
  it("charges the percentage fee and tax on add-ons but not the fixed per-ticket fee", () => {
    const p = priceOrder([{ unitPriceCents: 2500, quantity: 1 }, { unitPriceCents: 1000, quantity: 2, fixedFee: false }], fees, 500, "buyer_pays");
    expect(p.subtotalCents).toBe(4500);
    expect(p.perUnitPlatformFee).toEqual([125 + 99, 50]);
    expect(p.perUnitTax).toEqual([125, 50]);
    expect(p.platformFeeCents).toBe(224 + 100);
    expect(p.taxCents).toBe(225);
  });
});

describe("recurring date shifting", () => {
  it("keeps the wall-clock time across DST when shifting by weeks", () => {
    const start = wallClockToUtc("2026-03-01T20:00", "America/New_York")!; // EST
    const next = shiftWallClock(start, "America/New_York", { days: 14 });   // after the March 8 change → EDT
    expect(utcToWallClock(next, "America/New_York")).toBe("2026-03-15T20:00");
    expect(next.getTime() - start.getTime()).toBe(14 * 86_400_000 - 3_600_000);
  });
  it("shifts by months and clamps to the last day", () => {
    const jan31 = wallClockToUtc("2026-01-31T19:30", "Europe/Stockholm")!;
    expect(utcToWallClock(shiftWallClock(jan31, "Europe/Stockholm", { months: 1 }), "Europe/Stockholm")).toBe("2026-02-28T19:30");
    expect(utcToWallClock(shiftWallClock(jan31, "Europe/Stockholm", { months: 2 }), "Europe/Stockholm")).toBe("2026-03-31T19:30");
  });
});

describe("multi-day active date", () => {
  const day = (id: number, starts: string, ends: string | null = null, doors: string | null = null): EventDateRow =>
    ({ id, event_id: 1, label: `Day ${id}`, starts_at: new Date(starts), ends_at: ends ? new Date(ends) : null, doors_at: doors ? new Date(doors) : null, sort_order: 0 } as EventDateRow);
  const dates = [day(1, "2026-06-05T20:00:00Z", "2026-06-06T02:00:00Z", "2026-06-05T18:00:00Z"), day(2, "2026-06-06T20:00:00Z", "2026-06-07T02:00:00Z"), day(3, "2026-06-07T20:00:00Z")];

  it("picks the day whose doors-to-end window contains now", () => {
    expect(activeEventDate(dates, new Date("2026-06-05T18:30:00Z"))?.id).toBe(1);   // doors open
    expect(activeEventDate(dates, new Date("2026-06-06T01:00:00Z"))?.id).toBe(1);   // still day 1 after midnight
    expect(activeEventDate(dates, new Date("2026-06-06T15:00:00Z"))?.id).toBe(2);   // 6 h before day-2 start
    expect(activeEventDate(dates, new Date("2026-06-08T05:00:00Z"))?.id).toBe(3);   // within 12 h after day-3 start (no end)
  });
  it("falls back to the next upcoming day, then the last one", () => {
    expect(activeEventDate(dates, new Date("2026-06-01T00:00:00Z"))?.id).toBe(1);
    expect(activeEventDate(dates, new Date("2026-06-06T05:00:00Z"))?.id).toBe(2);
    expect(activeEventDate(dates, new Date("2026-07-01T00:00:00Z"))?.id).toBe(3);
    expect(activeEventDate([], new Date())).toBeNull();
  });
});

describe("access codes, private links, question options", () => {
  it("matches presale codes case-insensitively and only on hidden types", () => {
    expect(accessCodeMatches({ hidden: 1, access_code: "EarlyBird" }, " earlybird ")).toBe(true);
    expect(accessCodeMatches({ hidden: 1, access_code: "EarlyBird" }, "other")).toBe(false);
    expect(accessCodeMatches({ hidden: 0, access_code: "EarlyBird" }, "earlybird")).toBe(false);
    expect(accessCodeMatches({ hidden: 1, access_code: null }, "anything")).toBe(false);
  });
  it("builds private links with the key and plain links otherwise", () => {
    expect(publicEventPath({ slug: "x", visibility: "private", private_key: "abc123" })).toBe("/events/x?key=abc123");
    expect(publicEventPath({ slug: "x", visibility: "unlisted", private_key: null })).toBe("/events/x");
  });
  it("parses select options one per line", () => {
    expect(questionOptions({ options: "Vegan\r\n  Vegetarian \n\nNone" })).toEqual(["Vegan", "Vegetarian", "None"]);
  });
});
