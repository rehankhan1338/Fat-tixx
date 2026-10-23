import { describe, expect, it } from "vitest";
import { parseRichText, richTextPlain, safeHref } from "@/lib/rich-text";
import { youtubeId } from "@/lib/video";
import { guessTimeZone } from "@/lib/home/timezone-guess";
import { COUNTRIES, toE164 } from "@/lib/home/countries";
import { refundPolicyText } from "@/lib/events/refund-policy";

describe("description formatting", () => {
  it("keeps plain paragraphs as they were", () => {
    expect(parseRichText("First line\nsecond line\n\nNext paragraph")).toEqual([
      { t: "p", lines: [[{ t: "text", v: "First line" }], [{ t: "text", v: "second line" }]] },
      { t: "p", lines: [[{ t: "text", v: "Next paragraph" }]] },
    ]);
  });

  it("reads bold, italics, links and bullet lists", () => {
    const [p, ul] = parseRichText("**Doors** at *seven*, see [the map](https://example.com/map)\n- Parking\n- Coat check");
    expect(p).toEqual({
      t: "p",
      lines: [[
        { t: "b", c: [{ t: "text", v: "Doors" }] },
        { t: "text", v: " at " },
        { t: "i", c: [{ t: "text", v: "seven" }] },
        { t: "text", v: ", see " },
        { t: "a", href: "https://example.com/map", c: [{ t: "text", v: "the map" }] },
      ]],
    });
    expect(ul).toEqual({ t: "ul", items: [[{ t: "text", v: "Parking" }], [{ t: "text", v: "Coat check" }]] });
  });

  it("never links to anything but http(s) and mailto", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    const [p] = parseRichText("[click](javascript:alert(1))");
    expect(p.t === "p" && p.lines[0].every((x) => x.t === "text")).toBe(true);
    expect(richTextPlain("**Bold** and [a link](https://x.com)\n- one")).toBe("Bold and a link\n\n• one");
  });

  it("leaves snake_case and lone asterisks alone, and links bare addresses", () => {
    expect(parseRichText("file_name_here and 5 * 3 = 15")[0]).toEqual({ t: "p", lines: [[{ t: "text", v: "file_name_here and 5 * 3 = 15" }]] });
    const [p] = parseRichText("Tickets: https://fattixx.com/events/x.");
    expect(p.t === "p" && p.lines[0]).toEqual([{ t: "text", v: "Tickets: " }, { t: "a", href: "https://fattixx.com/events/x", c: [{ t: "text", v: "https://fattixx.com/events/x" }] }, { t: "text", v: "." }]);
  });
});

describe("YouTube links", () => {
  it("finds the video id in any YouTube link", () => {
    for (const url of ["https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s", "youtube.com/shorts/dQw4w9WgXcQ", "https://m.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"]) {
      expect(youtubeId(url), url).toBe("dQw4w9WgXcQ");
    }
    expect(youtubeId("https://vimeo.com/123456")).toBeNull();
    expect(youtubeId("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeId("")).toBeNull();
  });
});

describe("time zone from the venue", () => {
  it("knows each state's zone and the usual splits", () => {
    expect(guessTimeZone({ country: "US", region: "SC", lat: 34.85, lon: -82.39 })).toBe("America/New_York");
    expect(guessTimeZone({ country: "US", region: "TX", lat: 29.76, lon: -95.37 })).toBe("America/Chicago");
    expect(guessTimeZone({ country: "US", region: "TX", lat: 31.76, lon: -106.49 })).toBe("America/Denver"); // El Paso
    expect(guessTimeZone({ country: "US", region: "FL", lat: 30.44, lon: -84.28 })).toBe("America/New_York"); // Tallahassee
    expect(guessTimeZone({ country: "US", region: "FL", lat: 30.42, lon: -87.22 })).toBe("America/Chicago"); // Pensacola
    expect(guessTimeZone({ country: "US", region: "TN", lat: 36.16, lon: -86.78 })).toBe("America/Chicago"); // Nashville
    expect(guessTimeZone({ country: "US", region: "TN", lat: 35.96, lon: -83.92 })).toBe("America/New_York"); // Knoxville
    expect(guessTimeZone({ country: "US", region: "AZ", lat: 33.45, lon: -112.07 })).toBe("America/Phoenix");
    expect(guessTimeZone({ country: "CA", region: "BC", lat: 49.28, lon: -123.12 })).toBe("America/Vancouver");
    expect(guessTimeZone({ country: "GB", region: "England", lat: 51.5, lon: -0.12 })).toBe("Europe/London");
    expect(guessTimeZone({ country: "US", region: "", lat: null, lon: null })).toBeNull();
    expect(guessTimeZone({ country: "BR", region: "SP", lat: -23.5, lon: -46.6 })).toBeNull();
  });
});

describe("phone numbers", () => {
  const us = COUNTRIES.find((c) => c.code === "US")!;
  const gb = COUNTRIES.find((c) => c.code === "GB")!;
  it("turns what people type into E.164", () => {
    expect(toE164(us, "(843) 555-0123")).toBe("+18435550123");
    expect(toE164(us, "1 843 555 0123")).toBe("+18435550123");
    expect(toE164(gb, "07700 900123")).toBe("+447700900123");
    expect(toE164(gb, "+33 6 12 34 56 78")).toBe("+33612345678");
    expect(COUNTRIES[0].code).toBe("US");
  });
});

describe("refund policy wording", () => {
  it("says 24 hours for one day and covers 'Contact the organizer'", () => {
    expect(refundPolicyText({ refund_policy: "days_before", refund_days_before: 1 })).toBe("Refunds on request up to 24 hours before the event.");
    expect(refundPolicyText({ refund_policy: "days_before", refund_days_before: 7 })).toBe("Refunds on request up to 7 days before the event.");
    expect(refundPolicyText({ refund_policy: "contact_organizer", refund_days_before: null })).toMatch(/Contact the organizer/);
    expect(refundPolicyText({ refund_policy: "no_refunds", refund_days_before: null })).toMatch(/^No refunds/);
  });
});
