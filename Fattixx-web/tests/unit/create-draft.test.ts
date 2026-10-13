import { describe, expect, it } from "vitest";
import { checkDraft, dataUrlToFile, emptyDraft, migrateRefund, parseDraftForServer, type EventDraft } from "@/lib/home/create";

/** a draft that passes every check: next year, saved venue, one ticket */
function validDraft(): EventDraft {
  const year = new Date().getFullYear() + 1;
  return {
    ...emptyDraft(),
    name: "Spring Fling",
    category: "Music",
    startDate: `${year}-05-01`,
    startTime: "19:00",
    endDate: `${year}-05-01`,
    endTime: "22:00",
    location: { kind: "saved", venueId: "12", venueName: "The Warehouse" },
  };
}

describe("create-page draft", () => {
  it("migrates the old refund rules to the dashboard's", () => {
    expect(migrateRefund("7days", undefined)).toEqual({ refund: "days_before", refundDays: "7" });
    expect(migrateRefund("24hours", undefined)).toEqual({ refund: "days_before", refundDays: "1" });
    expect(migrateRefund("contact", undefined)).toEqual({ refund: "none", refundDays: "7" });
    expect(migrateRefund("days_before", "14")).toEqual({ refund: "days_before", refundDays: "14" });
    expect(migrateRefund("days_before", "x")).toEqual({ refund: "days_before", refundDays: "7" });
    expect(migrateRefund("until_start", undefined)).toEqual({ refund: "until_start", refundDays: "7" });
  });

  it("parses the dashboard fields posted from the page", () => {
    const d = parseDraftForServer(
      JSON.stringify({
        ...validDraft(),
        visibility: "private",
        refund: "days_before",
        refundDays: "3",
        taxPct: "7.5%",
        taxLabel: "SC Admissions Tax",
        featured: true,
        location: { kind: "saved", venueId: "12abc", venueName: "The Warehouse" },
      }),
    );
    expect(d.visibility).toBe("private");
    expect(d.refund).toBe("days_before");
    expect(d.refundDays).toBe("3");
    expect(d.taxPct).toBe("7.5");
    expect(d.taxLabel).toBe("SC Admissions Tax");
    expect(d.featured).toBe(true);
    expect(d.location).toEqual({ kind: "saved", venueId: "12", venueName: "The Warehouse" });
  });

  it("falls back to safe values for unknown input", () => {
    const d = parseDraftForServer(JSON.stringify({ visibility: "secret", refund: "whenever", location: { kind: "saved" } }));
    expect(d.visibility).toBe("public");
    expect(d.refund).toBe("none");
    expect(d.location).toEqual({ kind: "saved", venueId: "", venueName: "" });
  });

  it("turns the cover's data URL into a file without fetch (blocked by the CSP)", async () => {
    const f = dataUrlToFile("data:image/png;base64,aGVsbG8=");
    expect(f.name).toBe("cover.jpg");
    expect(f.type).toBe("image/png");
    expect(await f.text()).toBe("hello");
    const plain = dataUrlToFile("data:text/plain,hi%20there", "x.txt");
    expect(plain.type).toBe("text/plain");
    expect(await plain.text()).toBe("hi there");
  });

  it("checks the saved venue, refund days and tax", () => {
    expect(checkDraft(validDraft())).toEqual([]);
    expect(checkDraft({ ...validDraft(), location: { kind: "saved", venueId: "", venueName: "" } }).map((p) => p.field)).toEqual(["location"]);
    expect(checkDraft({ ...validDraft(), refund: "days_before", refundDays: "0" }).map((p) => p.field)).toEqual(["tickets"]);
    expect(checkDraft({ ...validDraft(), refund: "days_before", refundDays: "30" })).toEqual([]);
    expect(checkDraft({ ...validDraft(), taxPct: "31" }).map((p) => p.field)).toEqual(["tickets"]);
    expect(checkDraft({ ...validDraft(), taxPct: "7.5" })).toEqual([]);
  });
});
