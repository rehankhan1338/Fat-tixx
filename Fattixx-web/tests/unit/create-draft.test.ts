import { describe, expect, it } from "vitest";
import { checkDraft, dataUrlToFile, emptyDraft, fromRefundChoice, migrateRefund, parseDraftForServer, refundChoice, refundPolicyOf, type EventDraft } from "@/lib/home/create";

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
  it("reads older refund rules and the database's names", () => {
    expect(migrateRefund("7days", undefined)).toEqual({ refund: "days_before", refundDays: "7" });
    expect(migrateRefund("24hours", undefined)).toEqual({ refund: "days_before", refundDays: "1" });
    expect(migrateRefund("contact", undefined)).toEqual({ refund: "contact", refundDays: "7" });
    expect(migrateRefund("contact_organizer", undefined)).toEqual({ refund: "contact", refundDays: "7" });
    expect(migrateRefund("days_before", "14")).toEqual({ refund: "days_before", refundDays: "14" });
    expect(migrateRefund("days_before", "x")).toEqual({ refund: "days_before", refundDays: "7" });
    expect(migrateRefund("until_start", undefined)).toEqual({ refund: "until_start", refundDays: "7" });
    expect(migrateRefund("until_event_start", undefined)).toEqual({ refund: "until_start", refundDays: "7" });
  });

  it("offers the plan's four refund choices and keeps an older one", () => {
    expect(fromRefundChoice("days:7")).toEqual({ refund: "days_before", refundDays: "7" });
    expect(fromRefundChoice("days:1")).toEqual({ refund: "days_before", refundDays: "1" });
    expect(fromRefundChoice("contact")).toEqual({ refund: "contact", refundDays: "7" });
    expect(fromRefundChoice("none")).toEqual({ refund: "none", refundDays: "7" });
    expect(refundChoice({ refund: "days_before", refundDays: "1" })).toBe("days:1");
    expect(refundChoice({ refund: "days_before", refundDays: "14" })).toBe("days:14");
    expect(refundChoice({ refund: "until_start", refundDays: "7" })).toBe("until_start");
    expect(refundPolicyOf("contact")).toBe("contact_organizer");
    expect(refundPolicyOf("until_start")).toBe("until_event_start");
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

  it("parses a new venue's map position, the gallery, video, password and other ages", () => {
    const d = parseDraftForServer(
      JSON.stringify({
        ...validDraft(),
        location: { kind: "venue", venueName: "Jazz Cellar", address: "1 Main St", city: "Greenville", region: "SC", postalCode: "29601", country: "us", lat: 34.85, lon: -82.39 },
        gallery: [{ keep: 12 }, { file: "photo_1" }, { file: "../etc/passwd" }, { keep: -1 }],
        videoUrl: " https://youtu.be/dQw4w9WgXcQ ",
        password: "letmein",
        age: "16",
        showEnd: false,
      }),
    );
    expect(d.location).toEqual({ kind: "venue", venueName: "Jazz Cellar", address: "1 Main St", city: "Greenville", region: "SC", postalCode: "29601", country: "US", lat: 34.85, lon: -82.39 });
    expect(d.galleryPost).toEqual([{ keep: 12 }, { file: "photo_1" }]);
    expect(d.videoUrl).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(d.password).toBe("letmein");
    expect(d.age).toBe("16");
    expect(d.showEnd).toBe(false);
    const bad = parseDraftForServer(JSON.stringify({ location: { kind: "venue", lat: 999, lon: 5 }, age: "abc" }));
    expect(bad.location).toMatchObject({ lat: null, lon: null, country: "US" });
    expect(bad.age).toBe("all");
  });

  it("checks the video link, password, web address and an edited event's start", () => {
    expect(checkDraft({ ...validDraft(), videoUrl: "https://vimeo.com/123" }).map((p) => p.field)).toEqual(["video"]);
    expect(checkDraft({ ...validDraft(), videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })).toEqual([]);
    expect(checkDraft({ ...validDraft(), password: "abc" }).map((p) => p.field)).toEqual(["settings"]);
    expect(checkDraft({ ...validDraft(), slug: "Bad Slug!" }).map((p) => p.field)).toEqual(["settings"]);
    const past = { ...validDraft(), startDate: "2020-05-01", endDate: "2020-05-01" };
    expect(checkDraft(past).map((p) => p.field)).toEqual(["start"]);
    // editing an event already under way: fine as long as the start isn't moved
    expect(checkDraft(past, new Date(), { startDate: "2020-05-01", startTime: "19:00" })).toEqual([]);
    // the dashboard's own ticket types count towards "at least one ticket"
    expect(checkDraft({ ...validDraft(), tickets: [] }).map((p) => p.field)).toEqual(["tickets"]);
    expect(checkDraft({ ...validDraft(), tickets: [] }, new Date(), { startDate: "", startTime: "", otherTickets: 2 })).toEqual([]);
  });

  it("needs a map position for a new venue (plan 5.6.5, 5.6.7)", () => {
    const venue = { kind: "venue" as const, venueName: "The Warehouse", address: "1 King St", city: "Charleston", region: "SC", postalCode: "29401", country: "US" };
    const typed = checkDraft({ ...validDraft(), location: { ...venue, lat: null, lon: null } });
    expect(typed.map((p) => p.field)).toEqual(["location"]);
    expect(typed[0].message).toMatch(/suggestions/);
    expect(checkDraft({ ...validDraft(), location: { ...venue, lat: 32.78, lon: -79.93 } })).toEqual([]);
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
