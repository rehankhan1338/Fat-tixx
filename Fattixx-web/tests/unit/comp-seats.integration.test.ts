/**
 * Comp and box-office tickets with seat numbers, against the `fattixx_test` database: the organizer picks the exact
 * seats, blocked seats (held back for guests) can be given, seats of another tier or already sold are refused, and a
 * failed order leaves blocked seats blocked.
 *   Create the DB once:  DB_NAME=fattixx_test node scripts/db-setup.mjs
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, has: () => false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/authz", async (original) => {
  const real = await original<typeof import("@/lib/authz")>();
  const { queryOne } = await import("@/lib/db");
  return {
    ...real,
    canAccessEvent: async () => true,
    assertOrg: async (slug: string) => {
      const org = await queryOne(`SELECT * FROM organizations WHERE slug = ?`, [slug]);
      if (!org) throw new Error("Organization not found");
      return { session: { id: "s", user: { id: null, roles: [] } }, org, role: "org_admin", isOrgAdmin: true, isSuperAdmin: false, perms: {} };
    },
  };
});

import { db, execute, query, queryOne, type Row } from "@/lib/db";
import { issueStaffOrder } from "@/lib/orders/actions";
import { syncSeatedQuantities } from "@/lib/seating/inventory";
import { listEventSeats } from "@/lib/seating/queries";
import { expandLayout, newRowsSection, type SeatMapLayout } from "@/lib/seating/layout";

const tag = randomUUID().slice(0, 8);
const slug = `it-comp-${tag}`;
const eventSlug = `it-comp-event-${tag}`;
let orgId: number, eventId: number, goldId: number, silverId: number;
let seatIds: number[] = [];

const form = (fields: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ org: slug, event_id: eventId, source: "complimentary", name: "Guest Person", email: `guest-${tag}@test.local`, ...fields })) fd.set(k, String(v));
  return fd;
};
const ticketsOf = (code: string) => query<Row & { seat_label: string; event_seat_id: number }>(
  `SELECT k.seat_label, k.event_seat_id FROM tickets k JOIN orders o ON o.id = k.order_id WHERE o.code = ? ORDER BY k.event_seat_id`, [code],
);
const orderCode = (message: string | undefined) => /Order (\S+)\./.exec(message ?? "")?.[1] ?? "";
const tierQty = async (id: number) => Number((await queryOne<Row & { quantity: number }>(`SELECT quantity FROM ticket_types WHERE id = ?`, [id]))!.quantity);

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  orgId = (await execute(`INSERT INTO organizations (slug, name, contact_email, pro_until, verified_at) VALUES (?, 'IT Comps', 'it@test.local', NOW() + INTERVAL 30 DAY, NOW())`, [slug])).insertId;
  eventId = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'Comps', NOW() + INTERVAL 30 DAY, 'America/New_York', 'published', 'public', 'buyer_pays')`,
    [orgId, eventSlug],
  )).insertId;
  goldId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity, max_per_order, seated, seat_color) VALUES (?, 'Gold', 5000, 0, 10, 1, '#A8121A')`, [eventId])).insertId;
  silverId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity, max_per_order, seated, seat_color) VALUES (?, 'Silver', 2500, 0, 10, 1, '#1D4ED8')`, [eventId])).insertId;
  // 2 rows × 5 seats: row A gold, row B silver.
  const layout: SeatMapLayout = { version: 1, width: 600, height: 400, shapes: [], sections: [newRowsSection({ id: "s", name: "Floor", rows: 2, seatsPerRow: 5 })] };
  await execute(`INSERT INTO event_seating (event_id, layout) VALUES (?, ?)`, [eventId, JSON.stringify(layout)]);
  for (const s of expandLayout(layout)) {
    await execute(
      `INSERT INTO event_seats (event_id, seat_key, section, row_label, seat_number, label, x, y, ticket_type_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventId, s.key, s.section, s.row, s.number, s.label, s.x, s.y, s.row === "A" ? goldId : silverId, s.sort],
    );
  }
  seatIds = (await query<Row & { id: number }>(`SELECT id FROM event_seats WHERE event_id = ? ORDER BY sort_order`, [eventId])).map((r) => Number(r.id));
  // Seat A5 is held back for guests.
  await execute(`UPDATE event_seats SET blocked = 1, block_reason = 'House seat' WHERE id = ?`, [seatIds[4]]);
  await syncSeatedQuantities(eventId);
});

afterAll(async () => {
  if (orgId) await execute(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  await db.end();
});

describe("comp tickets on a seat map", () => {
  it("issues one ticket per chosen seat, labelled with the seat (not the best free ones)", async () => {
    const r = await issueStaffOrder(undefined, form({ ticket_type_id: goldId, quantity: 1, seat_ids: `${seatIds[3]},${seatIds[2]}` }));
    expect(r).toMatchObject({ ok: true });
    expect(r?.message).toContain("Floor · Row A · Seat 3");
    const tickets = await ticketsOf(orderCode(r?.message));
    expect(tickets.map((t) => Number(t.event_seat_id))).toEqual([seatIds[2], seatIds[3]]);
    expect(tickets.map((t) => t.seat_label)).toEqual(["Floor · Row A · Seat 3", "Floor · Row A · Seat 4"]);
    const seats = await listEventSeats(eventId);
    expect(seats.filter((s) => s.status === "sold").map((s) => s.id)).toEqual([seatIds[2], seatIds[3]]);
  });

  it("gives a blocked seat, unblocking it and counting it in the tier", async () => {
    expect(await tierQty(goldId)).toBe(4);
    const r = await issueStaffOrder(undefined, form({ ticket_type_id: goldId, seat_ids: `${seatIds[4]}`, source: "box_office" }));
    expect(r).toMatchObject({ ok: true });
    expect((await ticketsOf(orderCode(r?.message))).map((t) => t.seat_label)).toEqual(["Floor · Row A · Seat 5"]);
    const seat = (await listEventSeats(eventId)).find((s) => s.id === seatIds[4])!;
    expect(seat).toMatchObject({ status: "sold", blockReason: null });
    expect(await tierQty(goldId)).toBe(5);
  });

  it("refuses seats of another tier, and seats already sold", async () => {
    expect(await issueStaffOrder(undefined, form({ ticket_type_id: goldId, seat_ids: `${seatIds[0]},${seatIds[5]}` }))).toMatchObject({ error: expect.stringMatching(/Row B · Seat 1 isn’t in this ticket type’s pricing tier/) });
    expect(await issueStaffOrder(undefined, form({ ticket_type_id: goldId, seat_ids: `${seatIds[2]}` }))).toMatchObject({ error: expect.stringMatching(/taken/) });
    expect((await listEventSeats(eventId)).find((s) => s.id === seatIds[0])!.status).toBe("available");
  });

  it("blocks a seat again when the order can't be issued", async () => {
    await execute(`UPDATE event_seats SET blocked = 1, block_reason = 'Camera' WHERE id = ?`, [seatIds[6]]);
    await syncSeatedQuantities(eventId);
    // B2 is blocked; B1 is sold first, so an order for both fails and B2 must go back to blocked.
    expect(await issueStaffOrder(undefined, form({ ticket_type_id: silverId, seat_ids: `${seatIds[5]}` }))).toMatchObject({ ok: true });
    expect(await issueStaffOrder(undefined, form({ ticket_type_id: silverId, seat_ids: `${seatIds[5]},${seatIds[6]}` }))).toMatchObject({ error: expect.any(String) });
    const seat = (await listEventSeats(eventId)).find((s) => s.id === seatIds[6])!;
    expect(seat).toMatchObject({ status: "blocked", blockReason: "Camera" });
  });

  it("still gives the best free seats when no seat is chosen", async () => {
    const r = await issueStaffOrder(undefined, form({ ticket_type_id: silverId, quantity: 2 }));
    expect(r).toMatchObject({ ok: true });
    expect((await ticketsOf(orderCode(r?.message))).map((t) => Number(t.event_seat_id))).toEqual([seatIds[7], seatIds[8]]);
  });
});
