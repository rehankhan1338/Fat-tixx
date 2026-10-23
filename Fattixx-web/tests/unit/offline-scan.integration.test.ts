/**
 * Integration tests (fattixx_test DB) for offline check-in sync: idempotent replays, conflicts when a
 * ticket was admitted twice or refunded while a device was offline, and the offline QR hash.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { db, execute, queryOne, type Row } from "@/lib/db";
import { createPendingOrder, finalizePaidOrder } from "@/lib/orders/checkout";
import { listOrderTickets } from "@/lib/orders/queries";
import { applyOfflineScans } from "@/lib/checkin/offline";
import { offlineTicketHash, signTicket } from "@/lib/tickets";

const tag = randomUUID().slice(0, 8);
let orgId: number, eventId: number, staffId: number;
const tickets: { id: number; code: string; secret: string }[] = [];

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  orgId = (await execute(`INSERT INTO organizations (slug, name, contact_email) VALUES (?, 'IT Offline', 'off@test.local')`, [`it-off-${tag}`])).insertId;
  staffId = (await execute(`INSERT INTO users (public_id, email, email_normalized, name) VALUES (?, ?, ?, 'Door Staff')`, [randomUUID(), `door-${tag}@test.local`, `door-${tag}@test.local`])).insertId;
  const slug = `it-offline-${tag}`;
  eventId = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'IT Offline', NOW() + INTERVAL 1 DAY, 'America/New_York', 'published', 'public', 'buyer_pays')`,
    [orgId, slug],
  )).insertId;
  const tt = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'Free', 0, 10)`, [eventId])).insertId;
  const r = await createPendingOrder({ eventSlug: slug, lines: [{ ticketTypeId: tt, quantity: 3 }], email: `o-${tag}@test.local`, name: "Off Buyer", marketingOptIn: false, userId: null, ip: "test" });
  await finalizePaidOrder(r.orderId, {});
  for (const t of await listOrderTickets(r.orderId)) tickets.push({ id: Number(t.id), code: t.code, secret: t.secret });
});

afterAll(async () => {
  if (orgId) await execute(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  if (staffId) await execute(`DELETE FROM users WHERE id = ?`, [staffId]);
  await db.end();
});

const base = () => ({ eventId, staffId, activeDateId: null, deviceId: "dev-A", ip: "127.0.0.1", userAgent: "vitest" });
const item = (ticketId: number, ref = `r-${randomUUID()}`) => ({ ref, ticketId, kind: "valid" as const, at: new Date(Date.now() - 60_000).toISOString() });

describe("offline QR hash", () => {
  it("matches sha256 of the signed payload and differs per ticket", () => {
    const t = tickets[0];
    const expected = createHash("sha256").update(signTicket(t.code, t.secret)).digest("hex").slice(0, 32);
    expect(offlineTicketHash(t.code, t.secret)).toBe(expected);
    expect(offlineTicketHash(tickets[1].code, tickets[1].secret)).not.toBe(expected);
  });
});

describe("applyOfflineScans", () => {
  it("admits a valid ticket once and replays of the same ref are no-ops", async () => {
    const it1 = item(tickets[0].id);
    const first = await applyOfflineScans({ ...base(), items: [it1] });
    expect(first).toEqual({ synced: 1, conflicts: [] });
    const replay = await applyOfflineScans({ ...base(), items: [it1] });
    expect(replay.conflicts).toHaveLength(0);
    const rows = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM checkin_log WHERE client_ref = ?`, [it1.ref]);
    expect(Number(rows!.n)).toBe(1);
    const t = await queryOne<Row & { status: string; checked_in_at: Date }>(`SELECT status, checked_in_at FROM tickets WHERE id = ?`, [tickets[0].id]);
    expect(t!.status).toBe("used");
    // The device time is kept (one minute ago), not the sync time.
    expect(Date.now() - new Date(t!.checked_in_at).getTime()).toBeGreaterThan(30_000);
  });

  it("flags a conflict when another device already admitted the ticket", async () => {
    const r = await applyOfflineScans({ ...base(), deviceId: "dev-B", items: [item(tickets[0].id)] });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].reason).toMatch(/already checked in/);
    const c = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM checkin_log WHERE event_id = ? AND result = 'offline_conflict' AND device_id = 'dev-B'`, [eventId]);
    expect(Number(c!.n)).toBe(1);
  });

  it("flags a conflict when the ticket was refunded while the device was offline", async () => {
    await execute(`UPDATE tickets SET status = 'refunded' WHERE id = ?`, [tickets[1].id]);
    const r = await applyOfflineScans({ ...base(), items: [item(tickets[1].id)] });
    expect(r.conflicts[0].reason).toMatch(/refunded/);
  });

  it("never records a check-in in the future and ignores malformed refs and foreign tickets", async () => {
    const future = { ref: `r-${randomUUID()}`, ticketId: tickets[2].id, kind: "manual" as const, at: new Date(Date.now() + 86_400_000).toISOString() };
    const r = await applyOfflineScans({ ...base(), items: [{ ...future, ref: "bad ref!" }, { ...future, ticketId: 999999999, ref: `r-${randomUUID()}` }, future] });
    expect(r.synced).toBe(1);
    const t = await queryOne<Row & { checked_in_at: Date }>(`SELECT checked_in_at FROM tickets WHERE id = ?`, [tickets[2].id]);
    expect(new Date(t!.checked_in_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
