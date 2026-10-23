import 'server-only';
import type { PoolConnection } from 'mysql2/promise';
import { execute, query, type Row } from '../db';

/*
 * Seat holds inside the checkout transaction (plan 5.7.3–5.7.13). The same hold rules as every other ticket: a pending
 * order holds its seats until `orders.hold_expires_at`, a paid order owns them through its tickets. Seat rows are
 * locked (SELECT … FOR UPDATE) before they are checked and claimed, and always after the ticket type rows, in the same
 * order as finalizePaidOrder, so concurrent buyers queue on the seat instead of both getting it.
 */

export type LockedSeat = Row & { id: number; ticket_type_id: number | null; blocked: number; hold_order_id: number | null; label: string };

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Of these locked seats, the ones held by a live pending order or sold to a valid ticket (other than `exceptOrderId`'s hold). */
async function takenSeatIds(conn: PoolConnection, seats: LockedSeat[], exceptOrderId: number | null = null): Promise<Set<number>> {
  const taken = new Set<number>();
  if (!seats.length) return taken;
  const holds = [...new Set(seats.map((s) => Number(s.hold_order_id)).filter((id) => id && id !== exceptOrderId))];
  if (holds.length) {
    const [live] = await conn.query<(Row & { id: number })[]>(
      `SELECT id FROM orders WHERE id IN (${marks(holds.length)}) AND status = 'pending' AND hold_expires_at > NOW()`, holds,
    );
    const liveIds = new Set(live.map((o) => Number(o.id)));
    for (const s of seats) if (s.hold_order_id && liveIds.has(Number(s.hold_order_id))) taken.add(Number(s.id));
  }
  const ids = seats.map((s) => Number(s.id));
  const [sold] = await conn.query<(Row & { event_seat_id: number })[]>(
    `SELECT event_seat_id FROM tickets WHERE event_seat_id IN (${marks(ids.length)}) AND status IN ('valid','used')`, ids,
  );
  for (const t of sold) taken.add(Number(t.event_seat_id));
  return taken;
}

/** Tiers of the chosen seats, read before the transaction so the ticket types can be locked first. */
export async function seatTiers(conn: PoolConnection, eventId: number, seatIds: number[]): Promise<Map<number, number | null>> {
  if (!seatIds.length) return new Map();
  const [rows] = await conn.query<(Row & { id: number; ticket_type_id: number | null })[]>(
    `SELECT id, ticket_type_id FROM event_seats WHERE event_id = ? AND id IN (${marks(seatIds.length)})`, [eventId, ...seatIds],
  );
  return new Map(rows.map((r) => [Number(r.id), r.ticket_type_id ? Number(r.ticket_type_id) : null]));
}

/**
 * Lock the seats a buyer chose and check every one can be held: still in the tier it was priced at, not blocked,
 * not in someone else's live hold and not sold. Returns an error the buyer can act on.
 */
export async function lockChosenSeats(conn: PoolConnection, eventId: number, seatIds: number[], expectedTier: Map<number, number | null>): Promise<{ error: string } | { ok: true }> {
  const [seats] = await conn.query<LockedSeat[]>(
    `SELECT id, ticket_type_id, blocked, hold_order_id, label FROM event_seats WHERE event_id = ? AND id IN (${marks(seatIds.length)}) ORDER BY id FOR UPDATE`, [eventId, ...seatIds],
  );
  if (seats.length !== seatIds.length) return { error: 'One of the seats you picked is no longer on the map. Reload the page and pick again.' };
  for (const s of seats) {
    if (!s.ticket_type_id || s.blocked) return { error: `${s.label} is not for sale. Pick another seat.` };
    if (Number(s.ticket_type_id) !== expectedTier.get(Number(s.id))) return { error: `The price of ${s.label} just changed. Reload the page to see it.` };
  }
  const taken = await takenSeatIds(conn, seats);
  const first = seats.find((s) => taken.has(Number(s.id)));
  if (first) return { error: `${first.label} was just taken by someone else. Pick another seat.` };
  return { ok: true };
}

/** Box office and comps: the first free seats of a tier in map order (best seats first), locked. */
export async function pickBestSeats(conn: PoolConnection, eventId: number, ticketTypeId: number, quantity: number): Promise<number[]> {
  const [seats] = await conn.query<LockedSeat[]>(
    `SELECT id, ticket_type_id, blocked, hold_order_id, label FROM event_seats WHERE event_id = ? AND ticket_type_id = ? AND blocked = 0 ORDER BY sort_order, id FOR UPDATE`,
    [eventId, ticketTypeId],
  );
  const taken = await takenSeatIds(conn, seats);
  return seats.filter((s) => !taken.has(Number(s.id))).slice(0, quantity).map((s) => Number(s.id));
}

export async function holdSeatsForOrder(conn: PoolConnection, orderId: number, seatIds: number[]): Promise<void> {
  if (seatIds.length) await conn.query(`UPDATE event_seats SET hold_order_id = ? WHERE id IN (${marks(seatIds.length)})`, [orderId, ...seatIds]);
}

/**
 * When the order is paid: its seats of one tier, locked. Throws OVERSOLD (handled like any other oversell: the payment
 * is refunded) if a seat was claimed by someone else after this order's hold expired, or sold meanwhile.
 */
export async function seatsForPaidItem(conn: PoolConnection, orderId: number, ticketTypeId: number, quantity: number): Promise<{ id: number; label: string }[]> {
  const [seats] = await conn.query<LockedSeat[]>(
    `SELECT id, ticket_type_id, blocked, hold_order_id, label FROM event_seats WHERE hold_order_id = ? AND ticket_type_id = ? ORDER BY sort_order, id FOR UPDATE`,
    [orderId, ticketTypeId],
  );
  const taken = await takenSeatIds(conn, seats, orderId);
  if (seats.length !== quantity || taken.size) throw new Error('OVERSOLD');
  return seats.map((s) => ({ id: Number(s.id), label: s.label }));
}

/**
 * Organizer changes (tier, block): lock the seats and split them into the ones that may change and the ones that are
 * sold or in a live hold, which keep their tier and stay unblocked (the rule for seats once they are sold).
 */
export async function lockSeatsForChange(conn: PoolConnection, eventId: number, seatIds: number[]): Promise<{ free: LockedSeat[]; taken: LockedSeat[] }> {
  if (!seatIds.length) return { free: [], taken: [] };
  const [seats] = await conn.query<LockedSeat[]>(
    `SELECT id, ticket_type_id, blocked, hold_order_id, label FROM event_seats WHERE event_id = ? AND id IN (${marks(seatIds.length)}) ORDER BY id FOR UPDATE`, [eventId, ...seatIds],
  );
  const taken = await takenSeatIds(conn, seats);
  return { free: seats.filter((s) => !taken.has(Number(s.id))), taken: seats.filter((s) => taken.has(Number(s.id))) };
}

/** Is anything on this event's map held or sold? (The map can only be removed or replaced when nothing is.) */
export async function seatingInUse(eventId: number): Promise<{ sold: number; held: number }> {
  const [sold, held] = await Promise.all([
    query<Row & { n: number }>(`SELECT COUNT(*) AS n FROM tickets k JOIN event_seats s ON s.id = k.event_seat_id WHERE s.event_id = ? AND k.status IN ('valid','used')`, [eventId]),
    query<Row & { n: number }>(`SELECT COUNT(*) AS n FROM event_seats s JOIN orders o ON o.id = s.hold_order_id WHERE s.event_id = ? AND o.status = 'pending' AND o.hold_expires_at > NOW()`, [eventId]),
  ]);
  return { sold: Number(sold[0]?.n ?? 0), held: Number(held[0]?.n ?? 0) };
}

/** A tier's inventory is the seats assigned to it that are not blocked. Run after any seat change. */
export async function syncSeatedQuantities(eventId: number): Promise<void> {
  await execute(
    `UPDATE ticket_types t SET t.quantity = (SELECT COUNT(*) FROM event_seats s WHERE s.ticket_type_id = t.id AND s.blocked = 0) WHERE t.event_id = ? AND t.seated = 1`, [eventId],
  );
}
