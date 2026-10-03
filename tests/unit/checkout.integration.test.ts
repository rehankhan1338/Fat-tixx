/**
 * Integration tests against the `fattixx_test` database: inventory holds, oversell protection under
 * concurrency, hold expiry, ticket issuance and refunds bookkeeping.
 *   Create the DB once:  DB_NAME=fattixx_test node scripts/db-setup.mjs
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, execute, query, queryOne, type Row } from "@/lib/db";
import { CheckoutError, createPendingOrder, expireStaleHolds, finalizePaidOrder } from "@/lib/orders/checkout";
import { listTicketTypes, ticketTypeAvailable } from "@/lib/events/queries";
import { getOrderByCode, listOrderTickets } from "@/lib/orders/queries";
import { verifyTicketPayload, signTicket } from "@/lib/tickets";

const tag = randomUUID().slice(0, 8);
let orgId: number, eventId: number, scarceTypeId: number, tableTypeId: number, freeTypeId: number;
const eventSlug = `it-event-${tag}`;

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  const org = await execute(`INSERT INTO organizations (slug, name, contact_email) VALUES (?, ?, ?)`, [`it-org-${tag}`, "IT Org", "it@test.local"]);
  orgId = org.insertId;
  const venue = await execute(`INSERT INTO venues (organization_id, name, timezone, tax_bps) VALUES (?, 'IT Venue', 'America/New_York', 500)`, [orgId]);
  const ev = await execute(
    `INSERT INTO events (organization_id, venue_id, slug, title, starts_at, timezone, status, visibility, fee_mode, capacity) VALUES (?, ?, ?, 'IT Event', NOW() + INTERVAL 30 DAY, 'America/New_York', 'published', 'public', 'buyer_pays', 12)`,
    [orgId, venue.insertId, eventSlug],
  );
  eventId = ev.insertId;
  scarceTypeId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity, max_per_order) VALUES (?, 'Scarce', 2500, 5, 10)`, [eventId])).insertId;
  tableTypeId = (await execute(`INSERT INTO ticket_types (event_id, name, kind, price_cents, quantity, seats_per_unit) VALUES (?, 'Table', 'table', 40000, 2, 4)`, [eventId])).insertId;
  freeTypeId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'Free', 0, 100)`, [eventId])).insertId;
});

afterAll(async () => {
  if (orgId) await execute(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  await db.end();
});

const buyer = (n: number) => ({ eventSlug, email: `buyer${n}-${tag}@test.local`, name: `Buyer ${n}`, marketingOptIn: false, userId: null, ip: "test" });

describe("inventory holds & oversell protection", () => {
  it("20 concurrent buyers of 1 ticket each can hold at most the 5 available", async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => createPendingOrder({ ...buyer(i), lines: [{ ticketTypeId: scarceTypeId, quantity: 1 }] })));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok.length).toBe(5);
    expect(failed.length).toBe(15);
    for (const f of failed) expect(f.reason).toBeInstanceOf(CheckoutError);
    const [tt] = (await listTicketTypes(eventId)).filter((t) => Number(t.id) === scarceTypeId);
    expect(Number(tt.held)).toBe(5);
    expect(ticketTypeAvailable(tt)).toBe(0);
  });

  it("prices the pending order all-in with 5% tax and buyer-paid fees", async () => {
    const row = await queryOne<Row & { code: string }>(`SELECT code FROM orders WHERE event_id = ? AND status = 'pending' ORDER BY id LIMIT 1`, [eventId]);
    const order = (await getOrderByCode(row!.code))!;
    expect(Number(order.subtotal_cents)).toBe(2500);
    expect(Number(order.tax_cents)).toBe(125);
    expect(Number(order.platform_fee_cents)).toBe(125 + 99); // 5% + $0.99 defaults
    expect(Number(order.total_cents)).toBe(2500 + 224 + 125 + Number(order.processing_fee_cents));
    expect(order.hold_expires_at).not.toBeNull();
  });

  it("releases inventory when holds expire, and honours min/max per order", async () => {
    await execute(`UPDATE orders SET hold_expires_at = NOW() - INTERVAL 1 MINUTE WHERE event_id = ? AND status = 'pending'`, [eventId]);
    await expireStaleHolds();
    const [tt] = (await listTicketTypes(eventId)).filter((t) => Number(t.id) === scarceTypeId);
    expect(ticketTypeAvailable(tt)).toBe(5);
    await expect(createPendingOrder({ ...buyer(99), lines: [{ ticketTypeId: scarceTypeId, quantity: 11 }] })).rejects.toThrow(/between 1 and 10/);
    await expect(createPendingOrder({ ...buyer(98), lines: [{ ticketTypeId: scarceTypeId, quantity: 6 }] })).rejects.toThrow(/Only 5/);
    await expect(createPendingOrder({ ...buyer(97), lines: [] })).rejects.toThrow(/at least one/);
    await expect(createPendingOrder({ ...buyer(96), lines: [{ ticketTypeId: 999999, quantity: 1 }] })).rejects.toThrow(/no longer exists/);
  });

  it("enforces overall event capacity in seats (tables count as seats)", async () => {
    // capacity 12: two tables of 4 = 8 seats OK, then 5 scarce singles would exceed 12.
    const tables = await createPendingOrder({ ...buyer(50), lines: [{ ticketTypeId: tableTypeId, quantity: 2 }] });
    expect(tables.totalCents).toBeGreaterThan(80000);
    await expect(createPendingOrder({ ...buyer(51), lines: [{ ticketTypeId: scarceTypeId, quantity: 5 }] })).rejects.toThrow(/capacity/);
    const four = await createPendingOrder({ ...buyer(52), lines: [{ ticketTypeId: scarceTypeId, quantity: 4 }] });
    expect(four.code).toMatch(/^FTX-/);
  });
});

describe("paying and issuing tickets", () => {
  beforeAll(async () => {
    // The capacity tests above filled the 12-seat cap on purpose; lift it for the issuance tests.
    await execute(`UPDATE events SET capacity = 100 WHERE id = ?`, [eventId]);
  });

  it("finalizes a free order exactly once and issues one signed ticket per seat", async () => {
    const r = await createPendingOrder({ ...buyer(70), lines: [{ ticketTypeId: freeTypeId, quantity: 3 }] });
    expect(r.totalCents).toBe(0);
    expect(await finalizePaidOrder(r.orderId, {})).toBe(true);
    expect(await finalizePaidOrder(r.orderId, {})).toBe(false); // idempotent
    const order = (await getOrderByCode(r.code))!;
    expect(order.status).toBe("paid");
    const tickets = await listOrderTickets(order.id);
    expect(tickets).toHaveLength(3);
    for (const t of tickets) {
      expect(t.status).toBe("valid");
      expect(verifyTicketPayload(signTicket(t.code, t.secret))).toEqual({ code: t.code, secret: t.secret });
    }
    const tt = await queryOne<Row & { sold: number }>(`SELECT sold FROM ticket_types WHERE id = ?`, [freeTypeId]);
    expect(Number(tt!.sold)).toBe(3);
    const mail = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM email_outbox WHERE related_type = 'order' AND related_id = ?`, [String(order.id)]);
    expect(Number(mail!.n)).toBe(1);
  });

  it("table orders produce one ticket per seat with seat labels", async () => {
    const row = await queryOne<Row & { id: number }>(`SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id WHERE i.ticket_type_id = ? AND o.status = 'pending' LIMIT 1`, [tableTypeId]);
    await finalizePaidOrder(row!.id, { paymentIntentId: `pi_test_${tag}`, chargeId: `ch_test_${tag}` });
    const tickets = await listOrderTickets(row!.id);
    expect(tickets).toHaveLength(8);
    expect(tickets.map((t) => t.seat_label)).toContain("Table 2 · Seat 4");
    const sold = await queryOne<Row & { sold: number }>(`SELECT sold FROM ticket_types WHERE id = ?`, [tableTypeId]);
    expect(Number(sold!.sold)).toBe(2);
  });

  it("refuses to finalize when inventory is gone (OVERSOLD guard)", async () => {
    // Two pending holds for the last 5 scarce tickets cannot both be finalized if sold is bumped behind their back.
    const pending = await query<Row & { id: number }>(`SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id WHERE i.ticket_type_id = ? AND o.status = 'pending'`, [scarceTypeId]);
    expect(pending.length).toBeGreaterThan(0);
    await execute(`UPDATE ticket_types SET sold = quantity WHERE id = ?`, [scarceTypeId]);
    await expect(finalizePaidOrder(pending[0].id, {})).rejects.toThrow("OVERSOLD");
    const order = await queryOne<Row & { status: string }>(`SELECT status FROM orders WHERE id = ?`, [pending[0].id]);
    expect(order!.status).toBe("pending"); // transaction rolled back
  });
});
