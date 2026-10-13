/**
 * Integration tests (fattixx_test DB) for the event extras: presale access codes, add-on inventory,
 * checkout answers, waitlist conversion, add-on inventory return.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, execute, query, queryOne, type Row } from "@/lib/db";
import { createPendingOrder, finalizePaidOrder, returnAddonInventory } from "@/lib/orders/checkout";
import { listAddons, addonAvailable } from "@/lib/events/queries";
import { getOrderByCode, listOrderAddons, listOrderAnswers, listOrderTickets } from "@/lib/orders/queries";

const tag = randomUUID().slice(0, 8);
let orgId: number, eventId: number, gaId: number, presaleId: number, parkingId: number, dayId: number, dayOnlyId: number;
const eventSlug = `it-extras-${tag}`;

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  orgId = (await execute(`INSERT INTO organizations (slug, name, contact_email) VALUES (?, ?, ?)`, [`it-org-x-${tag}`, "IT Org X", "itx@test.local"])).insertId;
  eventId = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'IT Extras', NOW() + INTERVAL 30 DAY, 'America/New_York', 'published', 'public', 'buyer_pays')`,
    [orgId, eventSlug],
  )).insertId;
  gaId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'GA', 2000, 10)`, [eventId])).insertId;
  presaleId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity, hidden, access_code) VALUES (?, 'Presale', 1500, 5, 1, 'EARLY')`, [eventId])).insertId;
  parkingId = (await execute(`INSERT INTO event_addons (event_id, name, price_cents, quantity, max_per_order) VALUES (?, 'Parking', 1000, 2, 5)`, [eventId])).insertId;
  dayId = (await execute(`INSERT INTO event_dates (event_id, label, starts_at) VALUES (?, 'Day 2', NOW() + INTERVAL 31 DAY)`, [eventId])).insertId;
  dayOnlyId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity, event_date_id) VALUES (?, 'Day 2 only', 500, 10, ?)`, [eventId, dayId])).insertId;
});

afterAll(async () => {
  if (orgId) await execute(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  await db.end();
});

const buyer = (n: number) => ({ eventSlug, email: `x${n}-${tag}@test.local`, name: `Buyer ${n}`, marketingOptIn: false, userId: null, ip: "test" });

describe("presale access codes", () => {
  it("rejects a hidden presale type without the code and accepts it with the code (any case)", async () => {
    await expect(createPendingOrder({ ...buyer(1), lines: [{ ticketTypeId: presaleId, quantity: 1 }] })).rejects.toThrow(/access code/);
    await expect(createPendingOrder({ ...buyer(2), lines: [{ ticketTypeId: presaleId, quantity: 1 }], accessCode: "nope" })).rejects.toThrow(/access code/);
    const r = await createPendingOrder({ ...buyer(3), lines: [{ ticketTypeId: presaleId, quantity: 1 }], accessCode: " early " });
    expect(r.totalCents).toBeGreaterThan(1500);
  });
});

describe("add-ons", () => {
  it("holds add-on inventory with the order, enforces limits, and increments sold on payment", async () => {
    await expect(createPendingOrder({ ...buyer(10), lines: [{ ticketTypeId: gaId, quantity: 1 }], addons: [{ addonId: parkingId, quantity: 3 }] })).rejects.toThrow(/Only 2/);
    await expect(createPendingOrder({ ...buyer(11), lines: [{ ticketTypeId: gaId, quantity: 1 }], addons: [{ addonId: 999999, quantity: 1 }] })).rejects.toThrow(/no longer exists/);
    const r = await createPendingOrder({ ...buyer(12), lines: [{ ticketTypeId: gaId, quantity: 1 }], addons: [{ addonId: parkingId, quantity: 2 }] });
    const [held] = (await listAddons(eventId)).filter((a) => Number(a.id) === parkingId);
    expect(Number(held.held)).toBe(2);
    expect(addonAvailable(held)).toBe(0);
    await expect(createPendingOrder({ ...buyer(13), lines: [{ ticketTypeId: gaId, quantity: 1 }], addons: [{ addonId: parkingId, quantity: 1 }] })).rejects.toThrow(/sold out/);
    const order = (await getOrderByCode(r.code))!;
    // 2 × $10 add-on: 5 % fee but no $0.99 fixed fee; GA: 5 % + $0.99.
    expect(Number(order.subtotal_cents)).toBe(2000 + 2000);
    expect(Number(order.platform_fee_cents)).toBe(100 + 99 + 100);
    expect(await finalizePaidOrder(r.orderId, {})).toBe(true);
    const addons = await listOrderAddons(order.id);
    expect(addons).toHaveLength(1);
    expect(Number(addons[0].quantity)).toBe(2);
    expect(await listOrderTickets(order.id)).toHaveLength(1); // add-ons never produce tickets
    const sold = await queryOne<Row & { sold: number }>(`SELECT sold FROM event_addons WHERE id = ?`, [parkingId]);
    expect(Number(sold!.sold)).toBe(2);
    await returnAddonInventory(order.id);
    const after = await queryOne<Row & { sold: number }>(`SELECT sold FROM event_addons WHERE id = ?`, [parkingId]);
    expect(Number(after!.sold)).toBe(0);
  });

  it("add-ons cannot be bought without a ticket", async () => {
    await expect(createPendingOrder({ ...buyer(14), lines: [], addons: [{ addonId: parkingId, quantity: 1 }] })).rejects.toThrow(/at least one ticket/);
  });
});

describe("checkout answers and day-specific tickets", () => {
  it("stores answers with a label snapshot and issues day-only tickets with the day label", async () => {
    const r = await createPendingOrder({ ...buyer(20), lines: [{ ticketTypeId: dayOnlyId, quantity: 1 }], answers: [{ questionId: 0, label: "Dietary needs", answer: "Vegan" }, { questionId: 0, label: "Empty", answer: "" }] });
    const order = (await getOrderByCode(r.code))!;
    const answers = await listOrderAnswers(order.id);
    expect(answers.map((a) => [a.question_label, a.answer])).toEqual([["Dietary needs", "Vegan"]]);
    await finalizePaidOrder(order.id, {});
    const [t] = await listOrderTickets(order.id);
    expect(t.day_label).toBe("Day 2");
  });
});

describe("waitlist", () => {
  it("marks a waiting entry converted when that email completes an order", async () => {
    const email = `wl-${tag}@test.local`;
    await execute(`INSERT INTO waitlist_entries (event_id, ticket_type_id, email, quantity, token) VALUES (?, ?, ?, 1, ?)`, [eventId, gaId, email, `tok${tag}`]);
    const r = await createPendingOrder({ ...buyer(30), email, lines: [{ ticketTypeId: gaId, quantity: 1 }] });
    await finalizePaidOrder(r.orderId, {});
    const rows = await query<Row & { status: string }>(`SELECT status FROM waitlist_entries WHERE event_id = ? AND email = ?`, [eventId, email]);
    expect(rows.map((w) => w.status)).toEqual(["converted"]);
  });
});
