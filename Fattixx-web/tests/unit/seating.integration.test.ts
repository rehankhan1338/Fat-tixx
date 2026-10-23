/**
 * Integration tests against the `fattixx_test` database: reserved seat holds, no double-selling of a seat under
 * concurrency, hold expiry, seat tickets, best-available seats for the box office, and the seat-change rules.
 *   Create the DB once:  DB_NAME=fattixx_test node scripts/db-setup.mjs
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, execute, query, type Row } from "@/lib/db";
import { CheckoutError, createPendingOrder, expireStaleHolds, finalizePaidOrder } from "@/lib/orders/checkout";
import { listEventSeats } from "@/lib/seating/queries";
import { seatingInUse, syncSeatedQuantities } from "@/lib/seating/inventory";
import { expandLayout, newRowsSection, type SeatMapLayout } from "@/lib/seating/layout";

const tag = randomUUID().slice(0, 8);
const eventSlug = `it-seats-${tag}`;
let orgId: number, eventId: number, goldId: number, silverId: number;
let seatIds: number[] = [];

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  orgId = (await execute(`INSERT INTO organizations (slug, name, contact_email, pro_until) VALUES (?, 'IT Seats', 'it@test.local', NOW() + INTERVAL 30 DAY)`, [`it-seats-${tag}`])).insertId;
  eventId = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'Seated', NOW() + INTERVAL 30 DAY, 'America/New_York', 'published', 'public', 'buyer_pays')`,
    [orgId, eventSlug],
  )).insertId;
  goldId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity, max_per_order, seated, seat_color) VALUES (?, 'Gold', 5000, 0, 10, 1, '#A8121A')`, [eventId])).insertId;
  silverId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity, max_per_order, seated, seat_color) VALUES (?, 'Silver', 2500, 0, 10, 1, '#1D4ED8')`, [eventId])).insertId;
  // 2 rows × 4 seats: row A gold, row B silver.
  const layout: SeatMapLayout = { version: 1, width: 600, height: 400, shapes: [], sections: [newRowsSection({ id: "s", name: "Floor", rows: 2, seatsPerRow: 4 })] };
  await execute(`INSERT INTO event_seating (event_id, layout) VALUES (?, ?)`, [eventId, JSON.stringify(layout)]);
  for (const s of expandLayout(layout)) {
    await execute(
      `INSERT INTO event_seats (event_id, seat_key, section, row_label, seat_number, label, x, y, ticket_type_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventId, s.key, s.section, s.row, s.number, s.label, s.x, s.y, s.row === "A" ? goldId : silverId, s.sort],
    );
  }
  await syncSeatedQuantities(eventId);
  seatIds = (await query<Row & { id: number }>(`SELECT id FROM event_seats WHERE event_id = ? ORDER BY sort_order`, [eventId])).map((r) => Number(r.id));
});

afterAll(async () => {
  if (orgId) await execute(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  await db.end();
});

const buyer = (n: number) => ({ eventSlug, email: `seat${n}-${tag}@test.local`, name: `Seat Buyer ${n}`, marketingOptIn: false, userId: null, ip: "test", lines: [] });

describe("reserved seating holds", () => {
  it("tier inventory equals the seats assigned to it", async () => {
    const tiers = await query<Row & { id: number; quantity: number }>(`SELECT id, quantity FROM ticket_types WHERE event_id = ? ORDER BY id`, [eventId]);
    expect(tiers.map((t) => Number(t.quantity))).toEqual([4, 4]);
  });

  it("10 concurrent buyers of the same seat: exactly one holds it", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => createPendingOrder({ ...buyer(i), seatIds: [seatIds[0]] })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(CheckoutError);
    const seat = (await listEventSeats(eventId)).find((s) => s.id === seatIds[0])!;
    expect(seat.status).toBe("held");
  });

  it("prices seats by their tier and requires seats for seated tiers online", async () => {
    const r = await createPendingOrder({ ...buyer(20), seatIds: [seatIds[1], seatIds[4]] });
    const items = await query<Row & { ticket_type_id: number; quantity: number; unit_price_cents: number }>(`SELECT ticket_type_id, quantity, unit_price_cents FROM order_items WHERE order_id = ? ORDER BY ticket_type_id`, [r.orderId]);
    expect(items.map((i) => [Number(i.ticket_type_id), Number(i.quantity), Number(i.unit_price_cents)])).toEqual([[goldId, 1, 5000], [silverId, 1, 2500]]);
    await expect(createPendingOrder({ ...buyer(21), lines: [{ ticketTypeId: goldId, quantity: 1 }] })).rejects.toThrow(/seat map/);
  });

  it("issues one ticket per seat, labelled with the seat, when paid", async () => {
    const r = await createPendingOrder({ ...buyer(30), seatIds: [seatIds[2]] });
    expect(await finalizePaidOrder(r.orderId, { paymentIntentId: `pi_seat_${tag}` })).toBe(true);
    const tickets = await query<Row & { seat_label: string; event_seat_id: number }>(`SELECT seat_label, event_seat_id FROM tickets WHERE order_id = ?`, [r.orderId]);
    expect(tickets).toHaveLength(1);
    expect(Number(tickets[0].event_seat_id)).toBe(seatIds[2]);
    expect(tickets[0].seat_label).toBe("Floor · Row A · Seat 3");
    expect((await listEventSeats(eventId)).find((s) => s.id === seatIds[2])!.status).toBe("sold");
    await expect(createPendingOrder({ ...buyer(31), seatIds: [seatIds[2]] })).rejects.toThrow(/just taken/);
  });

  it("releases seats when holds expire, and refunds a late payment for a seat taken meanwhile", async () => {
    const late = await createPendingOrder({ ...buyer(40), seatIds: [seatIds[3]] });
    await execute(`UPDATE orders SET hold_expires_at = NOW() - INTERVAL 1 MINUTE WHERE event_id = ? AND status = 'pending'`, [eventId]);
    await expireStaleHolds();
    expect((await listEventSeats(eventId)).find((s) => s.id === seatIds[3])!.status).toBe("available");
    await createPendingOrder({ ...buyer(41), seatIds: [seatIds[3]] });
    await expect(finalizePaidOrder(late.orderId, { paymentIntentId: `pi_late_${tag}` })).rejects.toThrow("OVERSOLD");
  });

  it("gives the box office the best free seats of a tier", async () => {
    const r = await createPendingOrder({ ...buyer(50), lines: [{ ticketTypeId: silverId, quantity: 2 }], source: "box_office", createdBy: null, bypassSalesWindow: true });
    const held = await query<Row & { id: number }>(`SELECT id FROM event_seats WHERE hold_order_id = ? ORDER BY sort_order`, [r.orderId]);
    expect(held).toHaveLength(2);
    expect(held.every((s) => seatIds.slice(4).includes(Number(s.id)))).toBe(true);
    const use = await seatingInUse(eventId);
    expect(use.sold).toBe(1);
    expect(use.held).toBeGreaterThan(0);
  });
});
