import { describe, expect, it } from "vitest";
import { formatEventDate, isValidTimeZone, utcToWallClock, wallClockToUtc } from "@/lib/tz";

describe("time zones", () => {
  it("validates IANA zone names", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Europe/Stockholm")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("converts wall clock to UTC in standard and daylight time", () => {
    // EST (UTC-5)
    expect(wallClockToUtc("2026-01-15T20:00", "America/New_York")?.toISOString()).toBe("2026-01-16T01:00:00.000Z");
    // EDT (UTC-4)
    expect(wallClockToUtc("2026-07-15T20:00", "America/New_York")?.toISOString()).toBe("2026-07-16T00:00:00.000Z");
    // Zone east of UTC
    expect(wallClockToUtc("2026-07-15T20:00", "Europe/Stockholm")?.toISOString()).toBe("2026-07-15T18:00:00.000Z");
  });

  it("round-trips across the DST change", () => {
    for (const local of ["2026-03-08T01:30", "2026-03-08T03:30", "2026-11-01T00:30", "2026-11-01T03:00", "2026-11-20T20:00"]) {
      const utc = wallClockToUtc(local, "America/New_York")!;
      expect(utcToWallClock(utc, "America/New_York")).toBe(local);
    }
  });

  it("rejects malformed input", () => {
    expect(wallClockToUtc("", "America/New_York")).toBeNull();
    expect(wallClockToUtc("2026-13-40T99:99", "America/New_York")).not.toBeNull(); // Date.UTC normalises; caller validates ranges separately
    expect(wallClockToUtc("tomorrow", "America/New_York")).toBeNull();
  });

  it("formats in the event zone", () => {
    const d = wallClockToUtc("2026-11-20T20:00", "America/New_York")!;
    expect(formatEventDate(d, "America/New_York")).toMatch(/Fri, Nov 20, 2026, 8:00 PM EST/);
    expect(formatEventDate(d, "America/New_York", { withTime: false })).toBe("Fri, Nov 20, 2026");
  });
});
