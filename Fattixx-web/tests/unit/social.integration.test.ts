/**
 * Social & Community (plan section 11) against the `fattixx_test` database, following the acceptance checklist (11.15):
 *  - a ticket holder who allows it appears on Who's Going; one who doesn't never does; "off" hides the list
 *  - following an organizer sends one notice when they publish their next public event
 *  - a referral sale credits the right referrer, a refund reverses the reward, nothing is payable before the event ends
 *  - no reward for buying through your own link
 *  - social queries never return ticket types, prices, order numbers or QR codes
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, execute, query, queryOne, type Row } from "@/lib/db";
import { createPendingOrder, finalizePaidOrder } from "@/lib/orders/checkout";
import { friendsGoingCounts, goingLine, profileView, searchPeople, whosGoing } from "@/lib/social/queries";
import { notifyFollowersOfNewEvent } from "@/lib/social/notify";
import { computeReward, ensureReferrerLink, recomputeReferralReward, runReferralJobs } from "@/lib/social/referrals";
import { filterPost, listFeed, getFeedEvent } from "@/lib/social/feed";
import { holdsTicket, usernameProblem, normalizeHandle } from "@/lib/social/core";
import { listAudience, parseAudienceFilters, audienceUnsubToken, parseAudienceUnsubToken } from "@/lib/social/audience";

const tag = randomUUID().slice(0, 8);
let orgId: number, eventId: number, typeId: number, laterEventId: number;
const users: Record<string, number> = {};

async function makeUser(key: string, opts: { profile?: boolean; guestList?: boolean } = {}) {
  const email = `${key}-${tag}@test.local`;
  const id = (await execute(
    `INSERT INTO users (public_id, email, email_normalized, name, email_verified_at, username, age_confirmed_at, show_on_guest_lists, show_events_on_profile)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, 1)`,
    [randomUUID(), email, email, `${key[0].toUpperCase()}${key.slice(1)} Tester`, opts.profile === false ? null : `${key}_${tag}`, opts.profile === false ? null : new Date(), opts.guestList ? 1 : 0],
  )).insertId;
  users[key] = id;
  return { id, email };
}

async function buy(key: string, qty = 1, attribution?: { trackingLinkId: number }) {
  const email = `${key}-${tag}@test.local`;
  const o = await createPendingOrder({ eventSlug: `soc-event-${tag}`, email, name: key, marketingOptIn: key === "maya", userId: users[key], ip: `10.0.0.${Object.keys(users).indexOf(key) + 1}`, lines: [{ ticketTypeId: typeId, quantity: qty }], attribution });
  await finalizePaidOrder(o.orderId, {});
  return o;
}

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  orgId = (await execute(`INSERT INTO organizations (slug, name, contact_email, verified_at) VALUES (?, ?, ?, NOW())`, [`soc-org-${tag}`, "Social Org", "soc@test.local"])).insertId;
  eventId = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode, guest_list_mode, feed_enabled)
     VALUES (?, ?, 'Social Event', NOW() + INTERVAL 30 DAY, 'America/New_York', 'published', 'public', 'organizer_absorbs', 'faces_total', 1)`,
    [orgId, `soc-event-${tag}`],
  )).insertId;
  typeId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'GA', 2000, 100)`, [eventId])).insertId;
  await makeUser("maya", { guestList: true });
  await makeUser("jordan", { guestList: true });
  await makeUser("hidden", { guestList: false });
  await makeUser("noprofile", { profile: false, guestList: true });
  await makeUser("viewer", { guestList: true });
  await makeUser("promo", { guestList: false });
  await buy("maya");
  await buy("jordan", 2);
  await buy("hidden");
  await buy("noprofile");
});

afterAll(async () => {
  const ids = Object.values(users);
  if (orgId) await execute(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  if (ids.length) {
    await execute(`DELETE FROM orders WHERE user_id IN (${ids.map(() => "?").join(",")})`, ids);
    await execute(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  }
  await db.end();
});

describe("Who's Going (11.4)", () => {
  it("lists only signed-in ticket holders who allow it", async () => {
    const ev = { id: eventId, guest_list_mode: "faces_total" as const, access_password: null };
    const g = await whosGoing(ev, null, 50);
    const ids = g.people.map((p) => p.id);
    expect(ids).toContain(users.maya);
    expect(ids).toContain(users.jordan);
    expect(ids).not.toContain(users.hidden);      // didn't allow it
    expect(ids).not.toContain(users.noprofile);   // no profile
    expect(ids).not.toContain(users.viewer);      // no ticket
    expect(g.total).toBe(5);                       // tickets out: 1 + 2 + 1 + 1
    expect(goingLine(g)).toMatch(/and 3 others are going$/);
  });

  it("a per-event choice overrides the account setting", async () => {
    await execute(`INSERT INTO event_guest_prefs (event_id, user_id, visible) VALUES (?, ?, 0)`, [eventId, users.maya]);
    await execute(`INSERT INTO event_guest_prefs (event_id, user_id, visible) VALUES (?, ?, 1)`, [eventId, users.hidden]);
    const g = await whosGoing({ id: eventId, guest_list_mode: "faces", access_password: null }, null, 50);
    const ids = g.people.map((p) => p.id);
    expect(ids).not.toContain(users.maya);
    expect(ids).toContain(users.hidden);
    expect(g.total).toBeNull(); // faces only: no total
    await execute(`DELETE FROM event_guest_prefs WHERE event_id = ?`, [eventId]);
  });

  it("turning it off hides the list for everyone", async () => {
    const g = await whosGoing({ id: eventId, guest_list_mode: "off", access_password: null }, users.maya, 50);
    expect(g.hidden).toBe(true);
    expect(g.people).toHaveLength(0);
  });

  it("password-protected events show the list to ticket holders only", async () => {
    const ev = { id: eventId, guest_list_mode: "faces" as const, access_password: "x" };
    expect((await whosGoing(ev, users.viewer, 50)).hidden).toBe(true);
    expect((await whosGoing(ev, users.maya, 50)).hidden).toBe(false);
  });

  it("puts people the viewer follows first and hides blocked people both ways", async () => {
    await execute(`INSERT INTO user_follows (follower_id, followee_id) VALUES (?, ?)`, [users.viewer, users.jordan]);
    let g = await whosGoing({ id: eventId, guest_list_mode: "faces", access_password: null }, users.viewer, 50);
    expect(g.people[0].id).toBe(users.jordan);
    expect(g.people[0].followed).toBe(true);
    await execute(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)`, [users.jordan, users.viewer]);
    g = await whosGoing({ id: eventId, guest_list_mode: "faces", access_password: null }, users.viewer, 50);
    expect(g.people.map((p) => p.id)).not.toContain(users.jordan);
    await execute(`DELETE FROM user_blocks WHERE blocker_id = ?`, [users.jordan]);
  });

  it("counts friends going for event cards (mutual follows only)", async () => {
    expect((await friendsGoingCounts(users.viewer, [eventId]))[eventId]).toBeUndefined();
    await execute(`INSERT INTO user_follows (follower_id, followee_id) VALUES (?, ?)`, [users.jordan, users.viewer]);
    expect((await friendsGoingCounts(users.viewer, [eventId]))[eventId]).toBe(1);
  });

  it("never returns ticket types, prices, order numbers or QR codes", async () => {
    const g = await whosGoing({ id: eventId, guest_list_mode: "faces_total", access_password: null }, null, 50);
    const json = JSON.stringify(g);
    expect(json).not.toMatch(/GA|2000|price|code|secret|order/i);
    const p = await profileView(`maya_${tag}`, null);
    expect(p).not.toBeNull();
    const pj = JSON.stringify(p);
    expect(pj).not.toMatch(/price|secret|order_|ticket_type|qr/i);
    expect(p!.eventIds?.upcoming).toContain(eventId);
  });
});

describe("Following organizers (11.5)", () => {
  it("sends one notice when the organizer publishes their next public event, skipping muted followers", async () => {
    await execute(`INSERT INTO org_follows (user_id, organization_id) VALUES (?, ?), (?, ?)`, [users.viewer, orgId, users.promo, orgId]);
    await execute(`UPDATE org_follows SET muted = 1 WHERE user_id = ? AND organization_id = ?`, [users.promo, orgId]);
    laterEventId = (await execute(
      `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'Next One', NOW() + INTERVAL 60 DAY, 'America/New_York', 'published', 'public', 'buyer_pays')`,
      [orgId, `soc-next-${tag}`],
    )).insertId;
    expect(await notifyFollowersOfNewEvent(laterEventId)).toBe(1);
    expect(await notifyFollowersOfNewEvent(laterEventId)).toBe(0); // once only
    const mails = await query<Row & { to_email: string }>(`SELECT to_email FROM email_outbox WHERE related_type = 'event' AND related_id = ? AND subject LIKE 'New from%'`, [String(laterEventId)]);
    expect(mails.map((m) => m.to_email)).toEqual([`viewer-${tag}@test.local`]);
  });

  it("does not announce private events", async () => {
    const id = (await execute(
      `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'Private', NOW() + INTERVAL 60 DAY, 'America/New_York', 'published', 'private', 'buyer_pays')`,
      [orgId, `soc-priv-${tag}`],
    )).insertId;
    expect(await notifyFollowersOfNewEvent(id)).toBe(0);
  });
});

describe("Referral rewards (11.9)", () => {
  let linkId: number;
  let referrerId: number;
  beforeAll(async () => {
    const offerId = (await execute(
      `INSERT INTO referral_offers (event_id, organization_id, kind, reward_type, reward_basis, reward_value) VALUES (?, ?, 'public', 'fixed', 'ticket', 300)`, [eventId, orgId],
    )).insertId;
    referrerId = (await execute(`INSERT INTO referrers (offer_id, user_id, status) VALUES (?, ?, 'active')`, [offerId, users.promo])).insertId;
    await ensureReferrerLink(referrerId);
    linkId = Number((await queryOne<Row & { tracking_link_id: number }>(`SELECT tracking_link_id FROM referrers WHERE id = ?`, [referrerId]))!.tracking_link_id);
  });

  it("computes rewards per ticket, per order and as a percentage, never above the organizer's share", () => {
    const order = { subtotal_cents: 4000, absorbed_fee_cents: 500, total_cents: 4000, refunded_cents: 0 };
    expect(computeReward({ reward_type: "fixed", reward_basis: "ticket", reward_value: 300 }, order, 2)).toBe(600);
    expect(computeReward({ reward_type: "fixed", reward_basis: "order", reward_value: 300 }, order, 2)).toBe(300);
    expect(computeReward({ reward_type: "percent", reward_basis: "order", reward_value: 1000 }, order, 2)).toBe(350); // 10% of 3500
    expect(computeReward({ reward_type: "fixed", reward_basis: "ticket", reward_value: 9999 }, order, 2)).toBe(3500);
    expect(computeReward({ reward_type: "fixed", reward_basis: "ticket", reward_value: 300 }, { ...order, refunded_cents: 4000 }, 0)).toBe(0);
  });

  it("credits the right referrer for a paid order through their link", async () => {
    await makeUser("friend", { guestList: false });
    const o = await buy("friend", 2, { trackingLinkId: linkId });
    const rr = await queryOne<Row & { referrer_id: number; user_id: number; amount_cents: number; status: string }>(`SELECT * FROM referral_rewards WHERE order_id = ?`, [o.orderId]);
    expect(Number(rr?.referrer_id)).toBe(referrerId);
    expect(Number(rr?.user_id)).toBe(users.promo);
    expect(Number(rr?.amount_cents)).toBe(600);
    expect(rr?.status).toBe("pending");
  });

  it("gives no reward for buying through your own link", async () => {
    const o = await buy("promo", 1, { trackingLinkId: linkId });
    expect(await queryOne(`SELECT 1 FROM referral_rewards WHERE order_id = ?`, [o.orderId])).toBeNull();
  });

  it("is not payable before the event ends", async () => {
    await runReferralJobs();
    const open = await query<Row & { status: string }>(`SELECT status FROM referral_rewards WHERE event_id = ?`, [eventId]);
    expect(open.every((r) => r.status === "pending")).toBe(true);
  });

  it("a refund reverses the reward", async () => {
    await makeUser("refunder", { guestList: false });
    const o = await buy("refunder", 1, { trackingLinkId: linkId });
    expect(Number((await queryOne<Row & { amount_cents: number }>(`SELECT amount_cents FROM referral_rewards WHERE order_id = ?`, [o.orderId]))?.amount_cents)).toBe(300);
    await execute(`UPDATE orders SET status = 'refunded', refunded_cents = total_cents WHERE id = ?`, [o.orderId]);
    await execute(`UPDATE tickets SET status = 'refunded' WHERE order_id = ?`, [o.orderId]);
    await recomputeReferralReward(o.orderId);
    const rr = await queryOne<Row & { amount_cents: number; status: string }>(`SELECT amount_cents, status FROM referral_rewards WHERE order_id = ?`, [o.orderId]);
    expect(rr?.status).toBe("reversed");
    expect(Number(rr?.amount_cents)).toBe(0);
  });

  it("becomes payable after the event ends and comes off the organizer's payout", async () => {
    await execute(`UPDATE events SET starts_at = NOW() - INTERVAL 40 DAY, ends_at = NOW() - INTERVAL 39 DAY WHERE id = ?`, [eventId]);
    await runReferralJobs();
    const rows = await query<Row & { status: string }>(`SELECT status FROM referral_rewards WHERE event_id = ? AND status <> 'reversed'`, [eventId]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "payable")).toBe(true);
    const { eventSalesSummary } = await import("@/lib/orders/queries");
    const s = await eventSalesSummary(eventId);
    expect(s.referralRewardsCents).toBe(600);
    await execute(`UPDATE events SET starts_at = NOW() + INTERVAL 30 DAY, ends_at = NULL WHERE id = ?`, [eventId]);
  });
});

describe("Event feed (11.7)", () => {
  it("only ticket holders hold tickets; filters links and slurs; masks swearing", async () => {
    expect(await holdsTicket(users.maya, eventId)).toBe(true);
    expect(await holdsTicket(users.viewer, eventId)).toBe(false);
    expect(filterPost("check out www.spam.com", { organizer: false }).ok).toBe(false);
    expect(filterPost("see https://x.y", { organizer: true }).ok).toBe(true);
    const f = filterPost("this is fucking great", { organizer: false });
    expect(f.ok && f.body).toBe("this is f****** great");
  });

  it("lists pinned alerts first and hides deleted posts and blocked authors", async () => {
    await execute(`INSERT INTO event_posts (event_id, user_id, body) VALUES (?, ?, 'hello from maya')`, [eventId, users.maya]);
    await execute(`INSERT INTO event_posts (event_id, user_id, body) VALUES (?, ?, 'hello from jordan')`, [eventId, users.jordan]);
    await execute(`INSERT INTO event_posts (event_id, user_id, kind, as_organizer, body, pinned) VALUES (?, ?, 'alert', 1, 'Doors at 7', 1)`, [eventId, users.maya]);
    await execute(`INSERT INTO event_posts (event_id, user_id, body, deleted_at) VALUES (?, ?, 'gone', NOW())`, [eventId, users.maya]);
    const fe = (await getFeedEvent(eventId))!;
    let posts = await listFeed(fe, users.viewer);
    expect(posts[0].kind).toBe("alert");
    expect(posts[0].author.organizer).toBe(true);
    expect(posts.map((p) => p.body)).not.toContain("gone");
    await execute(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)`, [users.viewer, users.jordan]);
    posts = await listFeed(fe, users.viewer);
    expect(posts.map((p) => p.body)).not.toContain("hello from jordan");
  });
});

describe("helpers", () => {
  it("validates usernames and handles", () => {
    expect(usernameProblem("ab")).toMatch(/3 to 30/);
    expect(usernameProblem("admin")).toMatch(/reserved/);
    expect(usernameProblem("maya.j")).toBeNull();
    expect(usernameProblem("maya..j")).toMatch(/next to each other/);
    expect(normalizeHandle("https://instagram.com/maya_j/")).toBe("maya_j");
    expect(normalizeHandle("@maya")).toBe("maya");
    expect(normalizeHandle("not a handle!")).toBeNull();
  });

  it("finds people by name or username, leaving out blocked people", async () => {
    const found = await searchPeople(`maya_${tag}`, users.viewer);
    expect(found[0]?.id).toBe(users.maya);
    expect((await searchPeople(`jordan_${tag}`, users.viewer)).map((p) => p.id)).not.toContain(users.jordan); // viewer blocked jordan above
  });

  it("signs audience unsubscribe links", () => {
    const t = audienceUnsubToken(orgId, "A@B.com");
    expect(parseAudienceUnsubToken(t)).toEqual({ orgId, email: "a@b.com" });
    expect(parseAudienceUnsubToken(t.slice(0, -2) + "00")).toBeNull();
  });

  it("lists followers and past attendees; followers who never bought show no email", async () => {
    const { rows } = await listAudience(orgId, parseAudienceFilters({}), 500);
    const viewer = rows.find((r) => r.name.startsWith("Viewer"));
    expect(viewer?.follower).toBe(true);
    expect(viewer?.email).toBeNull();
    const maya = rows.find((r) => r.email === `maya-${tag}@test.local`);
    expect(maya?.events).toBe(1);
  });
});
