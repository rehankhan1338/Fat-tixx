/**
 * Integration tests (fattixx_test DB) for the plan-completion features: promo codes (including the
 * max-uses cap under concurrency), per-person purchase limits, attribution columns, event reminders,
 * ad selection / targeting / tracking tokens, and CSV export safety.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, execute, query, queryOne, type Row } from "@/lib/db";
import { createPendingOrder, finalizePaidOrder } from "@/lib/orders/checkout";
import { getOrderByCode, listOrderItems } from "@/lib/orders/queries";
import { unitDiscount } from "@/lib/marketing/queries";
import { sendEventReminders } from "@/lib/jobs";
import { adToken, parseAdToken, pickAd, recordAdStat } from "@/lib/ads/serve";
import { effectiveStatus } from "@/lib/ads/placements";
import { csvCell, toCsv } from "@/lib/csv";
import { normalizePhone } from "@/lib/sms";

const tag = randomUUID().slice(0, 8);
let orgId: number, eventId: number, gaId: number, vipId: number, limitedId: number, soonEventId: number, campaignId: number;
const slug = `it-plan-${tag}`;

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  orgId = (await execute(`INSERT INTO organizations (slug, name, contact_email) VALUES (?, 'IT Plan', 'plan@test.local')`, [`it-plan-org-${tag}`])).insertId;
  const venue = (await execute(`INSERT INTO venues (organization_id, name, city, region) VALUES (?, 'Hall', 'Charleston', 'SC')`, [orgId])).insertId;
  eventId = (await execute(
    `INSERT INTO events (organization_id, venue_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, ?, 'IT Plan', NOW() + INTERVAL 30 DAY, 'America/New_York', 'published', 'public', 'buyer_pays')`,
    [orgId, venue, slug],
  )).insertId;
  gaId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity, max_per_order) VALUES (?, 'GA', 2000, 100, 10)`, [eventId])).insertId;
  vipId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'VIP', 10000, 20)`, [eventId])).insertId;
  limitedId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity, max_per_order, max_per_account) VALUES (?, 'Limited', 5000, 50, 10, 4)`, [eventId])).insertId;
  await execute(`INSERT INTO promo_codes (event_id, code, kind, value) VALUES (?, 'TENOFF', 'percent', 1000)`, [eventId]);
  await execute(`INSERT INTO promo_codes (event_id, code, kind, value, ticket_type_ids) VALUES (?, 'VIP5', 'amount', 500, ?)`, [eventId, String(vipId)]);
  await execute(`INSERT INTO promo_codes (event_id, code, kind, value, max_uses) VALUES (?, 'THREE', 'percent', 5000, 3)`, [eventId]);
  await execute(`INSERT INTO promo_codes (event_id, code, kind, value, active) VALUES (?, 'OFF', 'percent', 5000, 0)`, [eventId]);
  soonEventId = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'Tomorrow Show', NOW() + INTERVAL 20 HOUR, 'America/New_York', 'published', 'public', 'buyer_pays')`,
    [orgId, `${slug}-soon`],
  )).insertId;
  await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'Free', 0, 10)`, [soonEventId]);
});

afterAll(async () => {
  if (campaignId) await execute(`DELETE FROM ad_campaigns WHERE id = ?`, [campaignId]);
  if (orgId) await execute(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  await db.end();
});

const buyer = (n: number | string) => ({ eventSlug: slug, email: `p${n}-${tag}@test.local`, name: `Buyer ${n}`, marketingOptIn: false, userId: null, ip: "test" });

describe("promo codes", () => {
  it("computes per-ticket discounts and never goes below zero", () => {
    expect(unitDiscount({ kind: "percent", value: 1000 }, 2000)).toBe(200);
    expect(unitDiscount({ kind: "amount", value: 500 }, 300)).toBe(300);
    expect(unitDiscount({ kind: "percent", value: 1000 }, 0)).toBe(0);
  });

  it("applies a percent code before fees and tax and records the discount", async () => {
    const r = await createPendingOrder({ ...buyer(1), lines: [{ ticketTypeId: gaId, quantity: 2 }], promoCode: " tenoff " });
    const order = (await getOrderByCode(r.code))!;
    expect(r.discountCents).toBe(400);
    expect(Number(order.discount_cents)).toBe(400);
    expect(Number(order.subtotal_cents)).toBe(3600);
    // 6.5 % platform fee on the discounted $18 = 117 + 129 fixed, per ticket.
    expect(Number(order.platform_fee_cents)).toBe(2 * (117 + 129));
    const [item] = await listOrderItems(order.id);
    expect(Number(item.unit_price_cents)).toBe(1800);
    expect(Number(item.unit_discount_cents)).toBe(200);
  });

  it("limits a code to its ticket types and rejects inactive or unknown codes", async () => {
    await expect(createPendingOrder({ ...buyer(2), lines: [{ ticketTypeId: gaId, quantity: 1 }], promoCode: "VIP5" })).rejects.toThrow(/does not apply/);
    const r = await createPendingOrder({ ...buyer(3), lines: [{ ticketTypeId: gaId, quantity: 1 }, { ticketTypeId: vipId, quantity: 1 }], promoCode: "VIP5" });
    expect(r.discountCents).toBe(500);
    await expect(createPendingOrder({ ...buyer(4), lines: [{ ticketTypeId: gaId, quantity: 1 }], promoCode: "OFF" })).rejects.toThrow(/not valid/);
    await expect(createPendingOrder({ ...buyer(5), lines: [{ ticketTypeId: gaId, quantity: 1 }], promoCode: "NOPE" })).rejects.toThrow(/not valid/);
  });

  it("never exceeds max uses, even with concurrent checkouts", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => createPendingOrder({ ...buyer(`c${i}`), lines: [{ ticketTypeId: gaId, quantity: 1 }], promoCode: "THREE" })));
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(3);
    const rejected = attempts.filter((a): a is PromiseRejectedResult => a.status === "rejected");
    expect(rejected.every((a) => /fully used|only \d+ use/.test(String(a.reason)))).toBe(true);
  });
});

describe("per-person purchase limits", () => {
  it("counts paid and held tickets across orders by the same email", async () => {
    const first = await createPendingOrder({ ...buyer("lim"), lines: [{ ticketTypeId: limitedId, quantity: 3 }] });
    await finalizePaidOrder(first.orderId, {});
    await expect(createPendingOrder({ ...buyer("lim"), lines: [{ ticketTypeId: limitedId, quantity: 2 }] })).rejects.toThrow(/add 1 more/);
    await createPendingOrder({ ...buyer("lim"), lines: [{ ticketTypeId: limitedId, quantity: 1 }] });
    await expect(createPendingOrder({ ...buyer("lim"), lines: [{ ticketTypeId: limitedId, quantity: 1 }] })).rejects.toThrow(/reached the limit/);
    // A different person is unaffected; staff box-office orders bypass the limit.
    await createPendingOrder({ ...buyer("other"), lines: [{ ticketTypeId: limitedId, quantity: 4 }] });
    await createPendingOrder({ ...buyer("lim"), lines: [{ ticketTypeId: limitedId, quantity: 5 }], source: "box_office" });
  });
});

describe("attribution", () => {
  it("stores UTM fields, channel and SMS opt-in (only with a phone number)", async () => {
    const r = await createPendingOrder({ ...buyer("utm"), lines: [{ ticketTypeId: gaId, quantity: 1 }], smsOptIn: true, attribution: { utmSource: "instagram", utmMedium: "social", utmCampaign: "drop", channel: "embed" } });
    const o = await queryOne<Row & { utm_source: string; utm_medium: string; channel: string; sms_opt_in: number }>(`SELECT utm_source, utm_medium, channel, sms_opt_in FROM orders WHERE id = ?`, [r.orderId]);
    expect(o).toMatchObject({ utm_source: "instagram", utm_medium: "social", channel: "embed", sms_opt_in: 0 });
    const r2 = await createPendingOrder({ ...buyer("sms"), phone: "(843) 555-0123", lines: [{ ticketTypeId: gaId, quantity: 1 }], smsOptIn: true });
    expect(Number((await queryOne<Row & { sms_opt_in: number }>(`SELECT sms_opt_in FROM orders WHERE id = ?`, [r2.orderId]))!.sms_opt_in)).toBe(1);
  });

  it("normalizes US phone numbers for SMS", () => {
    expect(normalizePhone("(843) 555-0123")).toBe("+18435550123");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("event reminders job", () => {
  it("emails each ticket holder of an event starting within ~24 h exactly once", async () => {
    const tt = await queryOne<Row & { id: number }>(`SELECT id FROM ticket_types WHERE event_id = ?`, [soonEventId]);
    const r = await createPendingOrder({ eventSlug: `${slug}-soon`, email: `rem-${tag}@test.local`, name: "Reminder Buyer", marketingOptIn: false, userId: null, ip: "test", lines: [{ ticketTypeId: Number(tt!.id), quantity: 2 }] });
    await finalizePaidOrder(r.orderId, {});
    await sendEventReminders();
    await sendEventReminders();
    const mails = await query<Row & { subject: string }>(`SELECT subject FROM email_outbox WHERE to_email = ? AND subject LIKE 'Reminder:%'`, [`rem-${tag}@test.local`]);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toContain("Tomorrow Show");
    const ev = await queryOne<Row & { reminder_sent_at: Date | null }>(`SELECT reminder_sent_at FROM events WHERE id = ?`, [soonEventId]);
    expect(ev!.reminder_sent_at).not.toBeNull();
  });
});

describe("ads", () => {
  it("signs tracking tokens and rejects tampering", () => {
    const t = adToken(12, 34, "event_detail", 56);
    expect(parseAdToken(t)).toEqual({ campaignId: 12, creativeId: 34, placement: "event_detail", eventId: 56 });
    expect(parseAdToken(t.replace("12.", "13."))).toBeNull();
    expect(parseAdToken("garbage")).toBeNull();
  });

  it("derives scheduled / expired from the dates", () => {
    const day = 86_400_000;
    expect(effectiveStatus({ status: "active", starts_at: new Date(Date.now() + day), ends_at: null })).toBe("scheduled");
    expect(effectiveStatus({ status: "active", starts_at: null, ends_at: new Date(Date.now() - day) })).toBe("expired");
    expect(effectiveStatus({ status: "paused", starts_at: null, ends_at: null })).toBe("paused");
  });

  it("serves only active, targeted campaigns for the placement and counts impressions and clicks", async () => {
    campaignId = (await execute(
      `INSERT INTO ad_campaigns (name, status, priority, destination_url, targeting, event_id) VALUES (?, 'draft', 100, 'https://example.com', ?, ?)`,
      [`IT ad ${tag}`, JSON.stringify({ regions: ["SC"] }), eventId],
    )).insertId;
    const creative = (await execute(`INSERT INTO ad_creatives (campaign_id, alt_text, headline) VALUES (?, 'Alt', 'Hello')`, [campaignId])).insertId;
    await execute(`INSERT INTO ad_campaign_placements (campaign_id, placement) VALUES (?, 'event_detail')`, [campaignId]);
    expect((await pickAd("event_detail", { eventId }))?.campaignId).not.toBe(campaignId); // draft
    await execute(`UPDATE ad_campaigns SET status = 'active' WHERE id = ?`, [campaignId]);
    const ad = await pickAd("event_detail", { eventId });
    expect(ad?.campaignId).toBe(campaignId);
    expect(ad?.headline).toBe("Hello");
    expect((await pickAd("event_list", { eventId }))?.campaignId).not.toBe(campaignId); // other placement
    await execute(`UPDATE ad_campaigns SET targeting = ? WHERE id = ?`, [JSON.stringify({ regions: ["NC"] }), campaignId]);
    expect((await pickAd("event_detail", { eventId }))?.campaignId).not.toBe(campaignId); // targeting excludes SC
    const t = parseAdToken(ad!.token)!;
    await recordAdStat(t, "impression"); await recordAdStat(t, "impression"); await recordAdStat(t, "click");
    const s = await queryOne<Row & { impressions: number; clicks: number }>(`SELECT SUM(impressions) AS impressions, SUM(clicks) AS clicks FROM ad_stats WHERE campaign_id = ? AND creative_id = ?`, [campaignId, creative]);
    expect(Number(s!.impressions)).toBe(2);
    expect(Number(s!.clicks)).toBe(1);
  });
});

describe("CSV exports", () => {
  it("quotes separators and neutralizes spreadsheet formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(toCsv(["x", "y"], [[1, null]])).toBe("x,y\r\n1,\r\n");
  });
});
