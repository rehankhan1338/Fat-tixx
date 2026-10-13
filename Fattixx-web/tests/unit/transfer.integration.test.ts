/**
 * Integration tests for ticket transfers against the `fattixx_test` database: the old ticket is retired,
 * a fresh one is issued to the recipient, history and email are recorded, inventory is unchanged.
 *   Create the DB once:  DB_NAME=fattixx_test node scripts/db-setup.mjs
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, execute, query, queryOne, type Row } from "@/lib/db";
import { createPendingOrder, finalizePaidOrder } from "@/lib/orders/checkout";
import { checkinCounts, getOrderByCode, listOrderTickets } from "@/lib/orders/queries";
import { TransferError, heldByRecipient, holderMayTransfer, listEventTransfers, listTicketsReceivedBy, listTransferHolders, transferTicket } from "@/lib/orders/transfer";

const tag = randomUUID().slice(0, 8);
let orgId: number, eventId: number, typeId: number, orderId: number, orderCode: string;
const buyerEmail = `buyer-${tag}@test.local`;
const friendEmail = `friend-${tag}@test.local`;

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  orgId = (await execute(`INSERT INTO organizations (slug, name, contact_email) VALUES (?, ?, ?)`, [`tr-org-${tag}`, "TR Org", "tr@test.local"])).insertId;
  eventId = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode, allow_transfers) VALUES (?, ?, 'TR Event', NOW() + INTERVAL 30 DAY, 'America/New_York', 'published', 'public', 'buyer_pays', 1)`,
    [orgId, `tr-event-${tag}`],
  )).insertId;
  typeId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'GA', 0, 10)`, [eventId])).insertId;
  const o = await createPendingOrder({ eventSlug: `tr-event-${tag}`, email: buyerEmail, name: "Buyer", marketingOptIn: false, userId: null, ip: "test", lines: [{ ticketTypeId: typeId, quantity: 2 }] });
  await finalizePaidOrder(o.orderId, {});
  orderId = o.orderId; orderCode = o.code;
});

afterAll(async () => {
  if (orgId) await execute(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  await db.end();
});

describe("ticket transfers", () => {
  it("retires the old ticket and issues a new one to the recipient", async () => {
    const [first] = await listOrderTickets(orderId);
    const before = await checkinCounts(eventId);
    const r = await transferTicket({ ticketId: Number(first.id), orderId, toName: "Friend", toEmail: friendEmail.toUpperCase(), initiatedBy: "holder", actorUserId: null, note: "Enjoy" });

    const tickets = await listOrderTickets(orderId);
    const old = tickets.find((t) => Number(t.id) === Number(first.id))!;
    const fresh = tickets.find((t) => Number(t.id) === r.newTicketId)!;
    expect(old.status).toBe("transferred");
    expect(fresh.status).toBe("valid");
    expect(fresh.code).not.toBe(old.code);
    expect(fresh.secret).not.toBe(old.secret);
    expect(fresh.attendee_email).toBe(friendEmail);
    expect(Number(fresh.transferred_from_id)).toBe(Number(first.id));
    expect(Number(fresh.order_item_id)).toBe(Number(first.order_item_id));
    // One live ticket swapped for another: counts are unchanged.
    expect(await checkinCounts(eventId)).toEqual(before);

    const order = (await getOrderByCode(orderCode))!;
    expect(heldByRecipient(fresh, order.buyer_email)).toBe(true);
    expect(heldByRecipient(tickets.find((t) => t.status === "valid" && !t.transferred_from_id)!, order.buyer_email)).toBe(false);

    const [h] = await listEventTransfers(eventId);
    expect(h.from_ticket_code).toBe(old.code);
    expect(h.to_ticket_code).toBe(fresh.code);
    expect(h.initiated_by).toBe("holder");
    expect(h.note).toBe("Enjoy");

    const mail = await queryOne<Row & { subject: string }>(`SELECT subject FROM email_outbox WHERE to_email = ? ORDER BY id DESC LIMIT 1`, [friendEmail]);
    expect(mail?.subject).toMatch(/sent you a ticket: TR Event/);
    expect((await listTicketsReceivedBy(friendEmail)).map((t) => t.code)).toEqual([fresh.code]);
    // Event-wide notices (cancel / postpone / broadcast) reach the recipient, but not the buyer twice.
    expect(await listTransferHolders(eventId)).toEqual([{ email: friendEmail, name: "Friend" }]);
  });

  it("refuses to transfer a ticket that is already transferred or checked in", async () => {
    const tickets = await listOrderTickets(orderId);
    const old = tickets.find((t) => t.status === "transferred")!;
    await expect(transferTicket({ ticketId: Number(old.id), orderId, toName: "X", toEmail: "x@test.local", initiatedBy: "holder", actorUserId: null })).rejects.toBeInstanceOf(TransferError);
    const mine = tickets.find((t) => t.status === "valid" && !t.transferred_from_id)!;
    await execute(`UPDATE tickets SET status = 'used', checked_in_at = NOW() WHERE id = ?`, [mine.id]);
    await expect(transferTicket({ ticketId: Number(mine.id), orderId, toName: "X", toEmail: "x@test.local", initiatedBy: "staff", actorUserId: null })).rejects.toThrow(/checked in/);
  });

  it("allows only one of two concurrent transfers of the same ticket", async () => {
    const fresh = (await listOrderTickets(orderId)).find((t) => t.status === "valid")!;
    const results = await Promise.allSettled([1, 2].map((n) => transferTicket({ ticketId: Number(fresh.id), orderId, toName: `R${n}`, toEmail: `r${n}-${tag}@test.local`, initiatedBy: "holder", actorUserId: null })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const live = await query<Row>(`SELECT id FROM tickets WHERE order_id = ? AND status IN ('valid','used')`, [orderId]);
    expect(live).toHaveLength(2);
  });

  it("holder transfers follow the event setting and close at event start", () => {
    const base = { allow_transfers: 1, status: "paid", event_status: "published", event_starts_at: new Date(Date.now() + 86_400_000) };
    expect(holderMayTransfer(base)).toBeNull();
    expect(holderMayTransfer({ ...base, allow_transfers: 0 })).toMatch(/does not allow/);
    expect(holderMayTransfer({ ...base, status: "refunded" })).toMatch(/paid order/);
    expect(holderMayTransfer({ ...base, event_status: "cancelled" })).toMatch(/cancelled/);
    expect(holderMayTransfer({ ...base, event_starts_at: new Date(Date.now() - 1000) })).toMatch(/event starts/);
  });
});
