/**
 * Editing and deleting a reserved seating tier from the Seating tab, against the `fattixx_test` database: rename and
 * reprice, other events' tiers and general admission tickets are out of reach, deleting puts the seats back to not for
 * sale, and a tier with orders stays.
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
import { deleteSeatTier, updateSeatTier } from "@/lib/seating/actions";
import { syncSeatedQuantities } from "@/lib/seating/inventory";
import { createPendingOrder } from "@/lib/orders/checkout";
import { expandLayout, newRowsSection, type SeatMapLayout } from "@/lib/seating/layout";

const tag = randomUUID().slice(0, 8);
const slug = `it-tiers-${tag}`;
const eventSlug = `it-tiers-event-${tag}`;
let orgId: number, eventId: number, otherEventId: number, gaId: number, otherTierId: number;

const form = (fields: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ org: slug, event_id: eventId, ...fields })) fd.set(k, String(v));
  return fd;
};
const tierRow = (id: number) => queryOne<Row & { name: string; price_cents: number; quantity: number }>(`SELECT name, price_cents, quantity FROM ticket_types WHERE id = ?`, [id]);
const addTier = async (name: string, event = eventId) => (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity, max_per_order, seated, seat_color) VALUES (?, ?, 5000, 0, 10, 1, '#A8121A')`, [event, name])).insertId;
const seatsOf = async (tier: number | null) => (await query<Row & { id: number }>(`SELECT id FROM event_seats WHERE event_id = ? AND ticket_type_id <=> ? ORDER BY sort_order`, [eventId, tier])).map((r) => Number(r.id));

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  orgId = (await execute(`INSERT INTO organizations (slug, name, contact_email, pro_until, verified_at) VALUES (?, 'IT Tiers', 'it@test.local', NOW() + INTERVAL 30 DAY, NOW())`, [slug])).insertId;
  const event = async (s: string) => (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'Tiers', NOW() + INTERVAL 30 DAY, 'America/New_York', 'published', 'public', 'buyer_pays')`, [orgId, s],
  )).insertId;
  eventId = await event(eventSlug);
  otherEventId = await event(`${eventSlug}-other`);
  gaId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'GA', 2500, 100)`, [eventId])).insertId;
  otherTierId = await addTier("Elsewhere", otherEventId);
  const layout: SeatMapLayout = { version: 1, width: 600, height: 400, shapes: [], sections: [newRowsSection({ id: "s", name: "Floor", rows: 2, seatsPerRow: 4 })] };
  await execute(`INSERT INTO event_seating (event_id, layout) VALUES (?, ?)`, [eventId, JSON.stringify(layout)]);
  for (const s of expandLayout(layout)) {
    await execute(`INSERT INTO event_seats (event_id, seat_key, section, row_label, seat_number, label, x, y, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [eventId, s.key, s.section, s.row, s.number, s.label, s.x, s.y, s.sort]);
  }
});

afterAll(async () => {
  if (orgId) await execute(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  await db.end();
});

describe("editing a tier", () => {
  it("renames and reprices it", async () => {
    const id = await addTier("Balcny");
    expect(await updateSeatTier(undefined, form({ tier_id: id, name: "Balcony", price: "75.50" }))).toMatchObject({ ok: true });
    expect(await tierRow(id)).toMatchObject({ name: "Balcony", price_cents: 7550 });
  });

  it("refuses a bad name or price and leaves the tier alone", async () => {
    const id = await addTier("Stalls");
    expect((await updateSeatTier(undefined, form({ tier_id: id, name: "x", price: "10" })))?.error).toBeTruthy();
    expect((await updateSeatTier(undefined, form({ tier_id: id, name: "Stalls", price: "ten" })))?.error).toBeTruthy();
    expect(await tierRow(id)).toMatchObject({ name: "Stalls", price_cents: 5000 });
  });

  it("only reaches this event's seated tiers", async () => {
    expect((await updateSeatTier(undefined, form({ tier_id: otherTierId, name: "Hacked", price: "1" })))?.error).toBeTruthy();
    expect((await updateSeatTier(undefined, form({ tier_id: gaId, name: "Hacked", price: "1" })))?.error).toBeTruthy();
    expect(await tierRow(otherTierId)).toMatchObject({ name: "Elsewhere", price_cents: 5000 });
    expect(await tierRow(gaId)).toMatchObject({ name: "GA", price_cents: 2500 });
  });
});

describe("deleting a tier", () => {
  it("puts its seats back to not for sale and keeps blocks", async () => {
    const id = await addTier("Short lived");
    const seats = (await seatsOf(null)).slice(0, 2);
    await execute(`UPDATE event_seats SET ticket_type_id = ? WHERE id IN (?, ?)`, [id, ...seats]);
    await execute(`UPDATE event_seats SET blocked = 1, block_reason = 'desk' WHERE id = ?`, [seats[0]]);
    expect(await deleteSeatTier(form({ tier_id: id }))).toMatchObject({ ok: true });
    expect(await tierRow(id)).toBeFalsy();
    expect(await seatsOf(null)).toEqual(expect.arrayContaining(seats));
    expect(await queryOne(`SELECT blocked, block_reason FROM event_seats WHERE id = ?`, [seats[0]])).toMatchObject({ blocked: 1, block_reason: "desk" });
    await execute(`UPDATE event_seats SET blocked = 0, block_reason = NULL WHERE id = ?`, [seats[0]]);
  });

  it("only reaches this event's seated tiers", async () => {
    expect((await deleteSeatTier(form({ tier_id: otherTierId })))?.error).toBeTruthy();
    expect((await deleteSeatTier(form({ tier_id: gaId })))?.error).toBeTruthy();
    expect(await tierRow(otherTierId)).toBeTruthy();
    expect(await tierRow(gaId)).toBeTruthy();
  });

  it("refuses a tier with seats in a buyer's cart, keeping seat and tier", async () => {
    const id = await addTier("Popular");
    const [seat] = await seatsOf(null);
    await execute(`UPDATE event_seats SET ticket_type_id = ? WHERE id = ?`, [id, seat]);
    await syncSeatedQuantities(eventId);
    await createPendingOrder({ eventSlug, email: `b-${tag}@test.local`, name: "Buyer", marketingOptIn: false, userId: null, ip: "test", lines: [], seatIds: [seat] });
    const r = await deleteSeatTier(form({ tier_id: id }));
    expect(r?.error).toMatch(/has orders/);
    expect(await tierRow(id)).toBeTruthy();
    expect(await seatsOf(id)).toEqual([seat]);
  });
});
