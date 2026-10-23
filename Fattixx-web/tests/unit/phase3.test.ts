/**
 * Phase 3 rules without a database: Stripe Connect shares and account states, advertiser impression pricing,
 * sponsorship fees, white-label activation and site page addresses, and the custom-domain paths for site pages.
 */
import { describe, expect, it } from "vitest";
import { connectState, organizerShareCents, parseDue } from "@/lib/payments/connect";
import { impressionPriceCents } from "@/lib/ads/placements";
import { advertiserCampaignState } from "@/lib/ads/advertisers";
import { organizerDealCents, sponsorshipFeeCents } from "@/lib/sponsorships/deals";
import { pageSlug, whiteLabelActive } from "@/lib/pro/white-label";
import { customDomainServes } from "@/lib/pro/domain-names";

const future = new Date(Date.now() + 30 * 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe("Stripe Connect", () => {
  it("organizer share = subtotal − absorbed fees, within 0…total", () => {
    // buyer pays fees: $50 tickets + $4.55 fees + $3 tax → organizer gets $50
    expect(organizerShareCents({ subtotal_cents: 5000, absorbed_fee_cents: 0, total_cents: 6155 })).toBe(5000);
    // organizer absorbs $4.55 of fees on a $50 + $3 tax order
    expect(organizerShareCents({ subtotal_cents: 5000, absorbed_fee_cents: 455, total_cents: 5300 })).toBe(4545);
    expect(organizerShareCents({ subtotal_cents: 100, absorbed_fee_cents: 300, total_cents: 100 })).toBe(0);
  });

  it("account state from Stripe's flags", () => {
    const base = { details_submitted: 1, transfers_active: 1, payouts_enabled: 1, requirements_due: "[]", disabled_reason: null };
    expect(connectState(null)).toBe("not_started");
    expect(connectState({ ...base, details_submitted: 0, transfers_active: 0, payouts_enabled: 0 })).toBe("incomplete");
    expect(connectState({ ...base, transfers_active: 0, payouts_enabled: 0 })).toBe("pending");
    expect(connectState({ ...base, requirements_due: JSON.stringify(["individual.verification.document"]) })).toBe("restricted");
    expect(connectState(base)).toBe("active");
    expect(parseDue("not json")).toEqual([]);
  });
});

describe("advertiser portal", () => {
  it("price = impressions × CPM / 1000, rounded up to the cent", () => {
    expect(impressionPriceCents(10_000, 1000)).toBe(10_000);
    expect(impressionPriceCents(5_001, 1000)).toBe(5_001);
    expect(impressionPriceCents(1_234, 777)).toBe(959);
  });

  it("campaign state as the advertiser sees it", () => {
    const c = { status: "draft", payment_status: "unpaid", review_status: "none", impressions_cap: null, impressions_served: 0, ends_at: null };
    expect(advertiserCampaignState(c)).toBe("unpaid");
    expect(advertiserCampaignState({ ...c, payment_status: "paid", review_status: "submitted" })).toBe("in_review");
    expect(advertiserCampaignState({ ...c, payment_status: "paid", review_status: "approved", status: "active", impressions_cap: 5000, impressions_served: 10 })).toBe("active");
    expect(advertiserCampaignState({ ...c, payment_status: "paid", review_status: "approved", status: "active", impressions_cap: 5000, impressions_served: 5000 })).toBe("completed");
    expect(advertiserCampaignState({ ...c, payment_status: "paid", review_status: "approved", status: "active", ends_at: past })).toBe("expired");
    expect(advertiserCampaignState({ ...c, payment_status: "refunded", review_status: "rejected" })).toBe("refunded");
  });
});

describe("sponsorship marketplace", () => {
  it("Fattixx fee in basis points, organizer gets the rest", () => {
    expect(sponsorshipFeeCents(50_000, 1000)).toBe(5_000);
    expect(sponsorshipFeeCents(12_345, 750)).toBe(926);
    expect(sponsorshipFeeCents(10_000, 0)).toBe(0);
    expect(organizerDealCents({ amount_cents: 50_000, fee_cents: 5_000 })).toBe(45_000);
  });
});

describe("white-label sites", () => {
  it("on only with the add-on and active Pro", () => {
    expect(whiteLabelActive({ white_label: 1, pro_until: future })).toBe(true);
    expect(whiteLabelActive({ white_label: 1, pro_until: past })).toBe(false);
    expect(whiteLabelActive({ white_label: 0, pro_until: future })).toBe(false);
    expect(whiteLabelActive(null)).toBe(false);
  });

  it("page addresses from titles", () => {
    expect(pageSlug("Frequently Asked Questions")).toBe("frequently-asked-questions");
    expect(pageSlug("Café & Bar — Info!")).toBe("cafe-bar-info");
    expect(pageSlug("!!!")).toBe("page");
  });

  it("custom domains serve /p/<page> themselves", () => {
    expect(customDomainServes("/p/about")).toBe(true);
    expect(customDomainServes("/pricing")).toBe(false);
    expect(customDomainServes("/pro")).toBe(false);
  });
});
