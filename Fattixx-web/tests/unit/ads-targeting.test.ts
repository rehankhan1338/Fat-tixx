/**
 * Ad targeting (plan 14.2): venue state / city, age-restricted events, signed-in status, days before the event, and
 * the Phase 3 additions: event category, ticket type and visitor role. No database.
 */
import { describe, expect, it } from "vitest";
import { matchesTargeting, type AdEventFacts, type AdViewerFacts } from "@/lib/ads/placements";

const now = new Date("2026-10-22T12:00:00Z").getTime();
const ev = (e: Partial<AdEventFacts> = {}): AdEventFacts => ({
  region: "SC", city: "Charleston", age: null, startsAt: new Date(now + 10 * 86_400_000), category: "Music", ticketKinds: ["general", "vip"], ...e,
});
const guest: AdViewerFacts = { signedIn: false, roles: ["guest"] };
const organizer: AdViewerFacts = { signedIn: true, roles: ["attendee", "organizer"] };

describe("ad targeting", () => {
  it("no rules: shown everywhere, also off event pages", () => {
    expect(matchesTargeting({}, ev(), guest, now)).toBe(true);
    expect(matchesTargeting({}, null, guest, now)).toBe(true);
  });

  it("existing rules still apply", () => {
    expect(matchesTargeting({ regions: ["sc"] }, ev(), guest, now)).toBe(true);
    expect(matchesTargeting({ regions: ["NC"] }, ev(), guest, now)).toBe(false);
    expect(matchesTargeting({ cities: ["Columbia"] }, ev(), guest, now)).toBe(false);
    expect(matchesTargeting({ ageRestricted: true }, ev({ age: 21 }), guest, now)).toBe(true);
    expect(matchesTargeting({ ageRestricted: true }, ev(), guest, now)).toBe(false);
    expect(matchesTargeting({ signedIn: true }, ev(), guest, now)).toBe(false);
    expect(matchesTargeting({ daysBeforeEvent: 7 }, ev(), guest, now)).toBe(false);
    expect(matchesTargeting({ daysBeforeEvent: 14 }, ev(), guest, now)).toBe(true);
  });

  it("event category: any listed category, case-insensitive; never off event pages", () => {
    expect(matchesTargeting({ categories: ["comedy", "music"] }, ev(), guest, now)).toBe(true);
    expect(matchesTargeting({ categories: ["Comedy"] }, ev(), guest, now)).toBe(false);
    expect(matchesTargeting({ categories: ["Music"] }, ev({ category: null }), guest, now)).toBe(false);
    expect(matchesTargeting({ categories: ["Music"] }, null, guest, now)).toBe(false);
  });

  it("ticket type: the visitor's own tickets win over the event's ticket types", () => {
    expect(matchesTargeting({ ticketKinds: ["vip"] }, ev(), guest, now)).toBe(true);
    expect(matchesTargeting({ ticketKinds: ["table"] }, ev(), guest, now)).toBe(false);
    // On an order page the buyer holds general admission only, although the event also sells VIP.
    expect(matchesTargeting({ ticketKinds: ["vip"] }, ev(), { ...guest, ticketKinds: ["general"] }, now)).toBe(false);
    // Ticket dashboard (no event): only the visitor's tickets count.
    expect(matchesTargeting({ ticketKinds: ["vip"] }, null, { ...organizer, ticketKinds: ["vip"] }, now)).toBe(true);
    expect(matchesTargeting({ ticketKinds: ["vip"] }, null, organizer, now)).toBe(false);
  });

  it("visitor role: any one of the visitor's roles", () => {
    expect(matchesTargeting({ roles: ["organizer"] }, ev(), organizer, now)).toBe(true);
    expect(matchesTargeting({ roles: ["attendee"] }, ev(), organizer, now)).toBe(true);
    expect(matchesTargeting({ roles: ["organizer", "staff"] }, ev(), guest, now)).toBe(false);
    expect(matchesTargeting({ roles: ["guest"] }, ev(), guest, now)).toBe(true);
  });

  it("all rules must hold together", () => {
    const t = { categories: ["Music"], ticketKinds: ["vip" as const], roles: ["guest" as const], regions: ["SC"] };
    expect(matchesTargeting(t, ev(), guest, now)).toBe(true);
    expect(matchesTargeting(t, ev(), organizer, now)).toBe(false);
    expect(matchesTargeting(t, ev({ region: "GA" }), guest, now)).toBe(false);
  });
});
