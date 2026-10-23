/**
 * Fattixx Pro (plan 5.7.1–5.7.11): the pure rules behind billing status, brand colors, custom domains, audiences and
 * campaign emails. No database.
 */
import { describe, expect, it } from "vitest";
import { canSubscribe, isProActive, proState, proUntil, stateIsPro, type SubscriptionSnapshot } from "@/lib/pro/status";
import { brandCssVars, checkBrandColors, contrastRatio, normalizeHex } from "@/lib/pro/brand-colors";
import { customDomainServes, isPlatformHost, looksLikeApex, normalizeHostname, platformOrigin } from "@/lib/pro/domain-names";
import { cleanRules, describeRules, segmentWhere } from "@/lib/pro/segments";
import { applyMergeTags, bodyToHtml, campaignHtml, campaignLinks, campaignText } from "@/lib/pro/campaign-render";

const DAY = 86_400_000;
const now = new Date("2026-10-22T12:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY);
const sub = (s: Partial<SubscriptionSnapshot>): SubscriptionSnapshot => ({
  status: "active", billing_interval: "month", cancel_at_period_end: 0, current_period_end: at(20), past_due_since: null, ended_at: null, ...s,
});

describe("Pro status rules (5.7.11)", () => {
  it("active: Pro until the period end plus the grace period", () => {
    expect(proUntil(sub({}), null, 7, now)?.getTime()).toBe(at(27).getTime());
    expect(proState(sub({}), null, 7, now)).toMatchObject({ kind: "active", interval: "month" });
  });

  it("cancelled: Pro until the end of the paid period, no grace, then ended", () => {
    const s = sub({ cancel_at_period_end: 1 });
    expect(proUntil(s, null, 7, now)?.getTime()).toBe(at(20).getTime());
    expect(proState(s, null, 7, now).kind).toBe("canceling");
    expect(proState(s, null, 7, at(21)).kind).toBe("ended");
    expect(isProActive(proUntil(s, null, 7, at(21)), at(21))).toBe(false);
  });

  it("failed renewal: grace counted from the first failure, then lapsed", () => {
    const s = sub({ status: "past_due", past_due_since: at(-3) });
    expect(proState(s, null, 7, now)).toMatchObject({ kind: "grace" });
    expect(proUntil(s, null, 7, now)?.getTime()).toBe(at(4).getTime());
    expect(proState(s, null, 7, at(5)).kind).toBe("lapsed");
  });

  it("canceled / unpaid by Stripe: no Pro", () => {
    expect(proUntil(sub({ status: "canceled", ended_at: now }), null, 7, now)).toBeNull();
    expect(proState(sub({ status: "canceled", ended_at: now }), null, 7, now).kind).toBe("ended");
    expect(proState(sub({ status: "unpaid" }), null, 7, now).kind).toBe("lapsed");
  });

  it("complimentary Pro works without a subscription and extends a shorter one", () => {
    expect(proState(null, at(30), 7, now)).toMatchObject({ kind: "comp" });
    expect(proUntil(sub({ status: "canceled" }), at(30), 7, now)?.getTime()).toBe(at(30).getTime());
    expect(proState(null, at(-1), 7, now).kind).toBe("none");
  });

  it("who may subscribe, and which states are Pro", () => {
    expect(canSubscribe({ kind: "none" })).toBe(true);
    expect(canSubscribe({ kind: "active", renews: null, interval: "year" })).toBe(false);
    expect(stateIsPro({ kind: "grace", until: now, since: now })).toBe(true);
    expect(stateIsPro({ kind: "lapsed", since: null })).toBe(false);
  });
});

describe("brand colors", () => {
  it("normalizes hex codes", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("1d4ed8")).toBe("#1d4ed8");
    expect(normalizeHex("red")).toBeNull();
  });

  it("accepts readable pairs and rejects illegible ones", () => {
    expect(checkBrandColors("#1E3A8A", "#FACC15")).toEqual({ ok: true, primary: "#1e3a8a", accent: "#facc15" });
    expect(checkBrandColors("#1D4ED8", "#FACC15").ok).toBe(false); // 4.4:1, just under AA
    expect(checkBrandColors("#FFE066", "#000000").ok).toBe(false); // light main color on an ivory page
    expect(checkBrandColors("#1D4ED8", "#1E40AF").ok).toBe(false); // button text on a near-identical accent
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("produces the CSS tokens the public pages read", () => {
    const v = brandCssVars("#1d4ed8", "#facc15");
    expect(v["--color-fx-red"]).toBe("#1d4ed8");
    expect(v["--color-fx-yellow"]).toBe("#facc15");
    expect(v["--color-fx-red-night"]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("custom domain names", () => {
  const env = { APP_URL: "https://www.fattixx.com", ADMIN_URL: "https://admin.fattixx.com" };

  it("normalizes what organizers type", () => {
    expect(normalizeHostname("https://Tickets.Brand.com/", env)).toEqual({ ok: true, host: "tickets.brand.com" });
    expect(normalizeHostname("tickets.bränd.com", env)).toEqual({ ok: true, host: "tickets.xn--brnd-moa.com" });
  });

  it("refuses Fattixx's own domains, IPs, ports and junk", () => {
    for (const bad of ["fattixx.com", "shop.fattixx.com", "x.vercel.app", "10.0.0.1", "brand.com:8080", "localhost", "not a domain", "_fattixx.brand.com"]) {
      expect(normalizeHostname(bad, env).ok, bad).toBe(false);
    }
  });

  it("tells platform hosts from custom ones", () => {
    expect(isPlatformHost("www.fattixx.com", env)).toBe(true);
    expect(isPlatformHost("localhost:3000", env)).toBe(true);
    expect(isPlatformHost("abc.vercel.app", env)).toBe(true);
    expect(isPlatformHost("tickets.brand.com", env)).toBe(false);
    expect(platformOrigin(env)).toBe("https://www.fattixx.com");
  });

  it("serves events and checkout on a custom domain, sends the rest to Fattixx", () => {
    for (const p of ["/", "/events/x", "/checkout/ABC", "/orders/ABC", "/t/123", "/api/ads", "/_next/static/a.js", "/unsubscribe/t"]) expect(customDomainServes(p), p).toBe(true);
    for (const p of ["/org/x", "/login", "/pricing", "/o/other-org", "/custom-domain/x"]) expect(customDomainServes(p), p).toBe(false);
  });

  it("guesses apex domains for the DNS instructions", () => {
    expect(looksLikeApex("brand.com")).toBe(true);
    expect(looksLikeApex("brand.co.uk")).toBe(true);
    expect(looksLikeApex("tickets.brand.com")).toBe(false);
  });
});

describe("audiences", () => {
  it("drops malformed rules", () => {
    expect(cleanRules({ eventIds: [3, "4", -1, "x"], minOrders: "2", boughtWithinDays: 0, cities: [" Charleston ", ""], junk: 1 }))
      .toEqual({ eventIds: [3, 4], minOrders: 2, cities: ["Charleston"] });
  });

  it("builds parameterised SQL only", () => {
    const w = segmentWhere({ eventIds: [1, 2], minOrders: 2, cities: ["X'; DROP TABLE users; --"] });
    expect(w.sql).not.toContain("DROP");
    expect(w.params).toEqual([1, 2, 2, "X'; DROP TABLE users; --"]);
    expect(segmentWhere({}).sql).toBe("1=1");
  });

  it("describes rules in plain words", () => {
    expect(describeRules({ eventIds: [5], boughtWithinDays: 90 }, () => "Summer Fest")).toBe("Bought tickets to “Summer Fest” · Bought in the last 90 days");
    expect(describeRules({})).toBe("Everyone subscribed");
  });
});

describe("campaign emails", () => {
  it("fills merge tags without letting buyer names add formatting", () => {
    expect(applyMergeTags("Hi {{first_name}} from {{ORG_NAME}}{{nope}}", { first_name: "Jane", org_name: "Acme" })).toBe("Hi Jane from Acme");
    expect(applyMergeTags("Hi {{first_name}}", { first_name: "[x](https://evil.test)", org_name: "Acme" })).toBe("Hi xhttps://evil.test");
    expect(applyMergeTags("Hi {{first_name}}", { first_name: null, org_name: "Acme" })).toBe("Hi there");
  });

  it("lists http links (plus the event button) for click tracking", () => {
    expect(campaignLinks("See [lineup](https://a.test/l) and https://b.test, mail [us](mailto:x@y.test)", ["https://e.test/events/1", "https://a.test/l"]))
      .toEqual(["https://a.test/l", "https://b.test", "https://e.test/events/1"]);
  });

  it("renders escaped HTML with tracked links", () => {
    const html = bodyToHtml("**Big** <night>\n- [Tickets](https://a.test/t)", (h) => `https://track.test?u=${encodeURIComponent(h)}`, "#123456");
    expect(html).toContain("<strong>Big</strong> &lt;night&gt;");
    expect(html).toContain('href="https://track.test?u=https%3A%2F%2Fa.test%2Ft"');
    expect(html).toContain("<li");
  });

  it("always carries the unsubscribe link and the postal address", () => {
    const layout = { orgName: "Acme", logoUrl: null, primary: "#123456", accent: "#ffd23f", mailingAddress: "1 Main St, Town", platformName: "Fattixx", subject: "Hi", preheader: null, bodyHtml: "<p>x</p>", button: null, unsubscribeUrl: "https://u.test/1", openPixelUrl: null };
    const html = campaignHtml(layout);
    expect(html).toContain('href="https://u.test/1"');
    expect(html).toContain("1 Main St, Town");
    const text = campaignText("Hello", layout);
    expect(text).toContain("Unsubscribe: https://u.test/1");
    expect(text).toContain("1 Main St, Town");
  });
});
