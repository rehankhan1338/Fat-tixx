/*
 * Fattixx Pro: the organizer plan described on /pro. Prices in integer cents; Pro is billed through Stripe (lib/pro/subscription.ts)
 * on top of the standard per-ticket fee, never instead of it. "Get Pro" goes to /pro/start: an organizer's Pro page
 * (subscribe there), or the organizer application for someone who has no organization yet.
 */

export const PRO_MONTHLY_CENTS = 5999; // billed every month
export const PRO_YEARLY_MONTHLY_CENTS = 4999; // per month when billed yearly
export const PRO_YEARLY_CENTS = PRO_YEARLY_MONTHLY_CENTS * 12; // one yearly charge
export const PRO_YEARLY_SAVINGS_CENTS = PRO_MONTHLY_CENTS * 12 - PRO_YEARLY_CENTS;

export type Billing = "monthly" | "yearly";

/** Where the "Get Pro" buttons go (src/app/pro/start/route.ts). */
export const PRO_SIGNUP_HREF = "/pro/start";

/** What every organizer gets for free, shown next to Pro so the difference is clear */
export const STANDARD_INCLUDES = [
  "Event pages and ticket sales",
  "General admission, VIP, table and free tickets",
  "The Fattixx Scanner app for the door",
  "Payouts to your bank through Stripe",
  "Sales, revenue and attendance basics",
];

export type ProFeatureKey = "brand" | "badge" | "header" | "domain" | "noads" | "seating" | "reports" | "email" | "promoters" | "tracking" | "support";

export type ProFeature = { key: ProFeatureKey; title: string; text: string };

export const PRO_FEATURES: ProFeature[] = [
  { key: "brand", title: "Your branding", text: "Your logo, colors and photos on every event page, applied the same way across all your events." },
  { key: "badge", title: "Pro check mark", text: "A check next to your name on every event listing, event page and your organizer page." },
  { key: "header", title: "Your own header", text: "Replace the Fattixx header with your own logo and name. A short footer with the terms and privacy links remains." },
  { key: "domain", title: "Your own web address", text: "Sell from tickets.yourbrand.com. You keep the domain, we set up the secure connection." },
  { key: "noads", title: "No ads", text: "We never show third-party ads on your pages. Your own sponsors and partners are still welcome." },
  { key: "seating", title: "Reserved seating", text: "Interactive seat maps so buyers pick their exact seat, table, box or section." },
  { key: "reports", title: "Advanced reports", text: "Sales over time, traffic sources, repeat customers, check-in rates and CSV exports." },
  { key: "email", title: "Email marketing", text: "Announce your next event to past buyers who opted in, with scheduling and open and click stats." },
  { key: "promoters", title: "Promoter links", text: "Give each promoter their own link and see the visits, tickets and revenue it brings in." },
  { key: "tracking", title: "Ad tracking", text: "Connect Meta Pixel, Google Analytics and Google Ads to see which ads sell tickets." },
  { key: "support", title: "Priority support", text: "Get to the front of the line, with help setting up seat maps, domains and big launches." },
];

/** The features grouped by what they do for the organizer, as the page lists them */
export const PRO_GROUPS: { title: string; keys: ProFeatureKey[] }[] = [
  { title: "Look like you", keys: ["brand", "badge", "header", "domain", "noads"] },
  { title: "Sell every seat", keys: ["seating", "promoters", "tracking"] },
  { title: "Know your crowd", keys: ["reports", "email"] },
  { title: "Get help first", keys: ["support"] },
];
