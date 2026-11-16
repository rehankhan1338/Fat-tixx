/**
 * Integration tests (fattixx_test DB) for app push notifications (src/lib/push.ts): who is told about an event,
 * signed-out phones being skipped, once-only "sold out" / "new event" alerts, and sending through Expo with a stubbed
 * fetch (tickets, retries with backoff, uninstalled apps switched off, receipts).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { db, execute, query, queryOne, type Row } from "@/lib/db";
import {
  checkPushReceipts, deliverDuePushes, eventAudience, isExpoPushToken, pushEventPublished, pushIfSoldOut, pushStaffAssigned, queuePush, registerDevice,
} from "@/lib/push";

const tag = randomUUID().slice(0, 8);
let orgId: number, eventId: number, ticketTypeId: number;
const u: Record<"admin" | "organizer" | "organizerOut" | "staff" | "staffOut" | "signedOut", number> = { admin: 0, organizer: 0, organizerOut: 0, staff: 0, staffOut: 0, signedOut: 0 };
const token = (name: string) => `ExponentPushToken[${name}-${tag}-xxxxxxxx]`;

async function user(name: string): Promise<number> {
  const email = `${name.toLowerCase()}-${tag}@test.local`;
  return (await execute(`INSERT INTO users (public_id, email, email_normalized, name) VALUES (?, ?, ?, ?)`, [randomUUID(), email, email, name])).insertId;
}
async function session(userId: number, revoked = false): Promise<string> {
  const id = randomBytes(32).toString("hex");
  await execute(`INSERT INTO sessions (id, user_id, expires_at, revoked_at) VALUES (?, ?, NOW() + INTERVAL 1 DAY, ?)`, [id, userId, revoked ? new Date() : null]);
  return id;
}
async function outbox(): Promise<(Row & { id: number; user_id: number; kind: string; status: string; attempts: number; title: string; url: string | null })[]> {
  return query(
    `SELECT p.id, d.user_id, p.kind, p.status, p.attempts, p.title, p.url FROM push_outbox p JOIN push_devices d ON d.id = p.device_id
      WHERE d.token LIKE ? ORDER BY p.id`, [`%-${tag}-%`],
  );
}
const clearOutbox = () => execute(`DELETE p FROM push_outbox p JOIN push_devices d ON d.id = p.device_id WHERE d.token LIKE ?`, [`%-${tag}-%`]);

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  orgId = (await execute(`INSERT INTO organizations (slug, name, contact_email) VALUES (?, 'IT Push', 'push@test.local')`, [`it-push-${tag}`])).insertId;
  for (const k of Object.keys(u) as (keyof typeof u)[]) u[k] = await user(k);
  const members: [number, string, number][] = [
    [u.admin, "org_admin", 0], [u.organizer, "organizer", 0], [u.organizerOut, "organizer", 0], [u.staff, "staff", 0], [u.staffOut, "staff", 0], [u.signedOut, "org_admin", 0],
  ];
  for (const [id, role, all] of members) await execute(`INSERT INTO organization_members (organization_id, user_id, role, all_events) VALUES (?, ?, ?, ?)`, [orgId, id, role, all]);
  eventId = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'Push Party', NOW() + INTERVAL 3 DAY, 'America/New_York', 'published', 'public', 'buyer_pays')`,
    [orgId, `it-push-${tag}`],
  )).insertId;
  ticketTypeId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'GA', 0, 5)`, [eventId])).insertId;
  for (const id of [u.organizer, u.staff]) await execute(`INSERT INTO event_members (event_id, user_id) VALUES (?, ?)`, [eventId, id]);
  // every person has the app on one phone; signedOut's session was revoked
  for (const k of Object.keys(u) as (keyof typeof u)[]) {
    await registerDevice({ userId: u[k], sessionId: await session(u[k], k === "signedOut"), token: token(k), platform: "android" });
  }
});

afterEach(() => { vi.unstubAllGlobals(); });

afterAll(async () => {
  if (orgId) await execute(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  for (const id of Object.values(u)) if (id) await execute(`DELETE FROM users WHERE id = ?`, [id]);
  await db.end();
});

describe("tokens", () => {
  it("accepts Expo push tokens only", () => {
    expect(isExpoPushToken("ExponentPushToken[abcdefghijklmnop]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abcdefghijklmnop]")).toBe(true);
    expect(isExpoPushToken("abcdefghijklmnop")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[a b]")).toBe(false);
    expect(isExpoPushToken(42)).toBe(false);
  });
});

describe("eventAudience", () => {
  it("is admins, organizers with access and assigned staff, like the app's own access rules", async () => {
    const all = await eventAudience(eventId);
    expect(all.sort()).toEqual([u.admin, u.organizer, u.staff, u.signedOut].sort());
    expect(all).not.toContain(u.organizerOut);
    expect(all).not.toContain(u.staffOut);
  });
  it("leaves staff out of manager-only alerts and can skip the person who acted", async () => {
    expect((await eventAudience(eventId, { managersOnly: true })).sort()).toEqual([u.admin, u.organizer, u.signedOut].sort());
    expect(await eventAudience(eventId, { exceptUserId: u.admin })).not.toContain(u.admin);
  });
});

describe("queueing", () => {
  it("skips phones whose session was signed out", async () => {
    await clearOutbox();
    expect(await queuePush([u.admin, u.signedOut], { kind: "test", title: "Hi", body: "There" })).toBe(1);
    expect((await outbox()).map((r) => Number(r.user_id))).toEqual([u.admin]);
  });

  it("tells a newly assigned person, with a link to the event", async () => {
    await clearOutbox();
    expect(await pushStaffAssigned(eventId, u.staffOut)).toBe(1);
    const [row] = await outbox();
    expect(Number(row.user_id)).toBe(u.staffOut);
    expect(row.url).toBe(`/event/it-push-${tag}/${eventId}`);
  });

  it("sends 'sold out' to admins and organizers once, when every public ticket is gone", async () => {
    await clearOutbox();
    expect(await pushIfSoldOut(eventId)).toBe(0); // 5 left
    await execute(`UPDATE ticket_types SET sold = quantity WHERE id = ?`, [ticketTypeId]);
    expect(await pushIfSoldOut(eventId)).toBe(2); // admin + organizer (signedOut's phone is skipped)
    expect(await pushIfSoldOut(eventId)).toBe(0);
    expect((await outbox()).map((r) => Number(r.user_id)).sort()).toEqual([u.admin, u.organizer].sort());
  });

  it("sends 'new event' only when the switch was on, once, and not to the person who published", async () => {
    await clearOutbox();
    expect(await pushEventPublished(eventId, u.admin)).toBe(0); // push_on_publish is off
    await execute(`UPDATE events SET push_on_publish = 1 WHERE id = ?`, [eventId]);
    expect(await pushEventPublished(eventId, u.admin)).toBe(2); // organizer + assigned staff
    expect(await pushEventPublished(eventId, u.admin)).toBe(0);
    const rows = await outbox();
    expect(rows.map((r) => r.kind)).toEqual(["event_published", "event_published"]);
    expect(rows.map((r) => Number(r.user_id))).not.toContain(u.admin);
  });
});

describe("sending through Expo", () => {
  it("marks accepted messages sent and switches off phones where the app was uninstalled", async () => {
    await clearOutbox();
    await queuePush([u.admin, u.staff], { kind: "test", title: "Hi", body: "There", url: "/account" });
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const msgs = JSON.parse(init.body) as { to: string; data: { url?: string } }[];
      expect(msgs.every((m) => m.data.url === "/account")).toBe(true);
      const data = msgs.map((m, i) => (m.to === token("staff") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: `tk-${tag}-${i}` }));
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await deliverDuePushes();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const rows = await outbox();
    expect(rows.find((x) => Number(x.user_id) === u.admin)?.status).toBe("sent");
    expect(rows.find((x) => Number(x.user_id) === u.staff)?.status).toBe("failed");
    const dev = await queryOne<Row & { disabled_at: Date | null }>(`SELECT disabled_at FROM push_devices WHERE token = ?`, [token("staff")]);
    expect(dev?.disabled_at).not.toBeNull();
    // a switched-off phone gets nothing more until the app registers again
    expect(await queuePush([u.staff], { kind: "test", title: "Again", body: "x" })).toBe(0);
  });

  it("retries later with backoff when Expo cannot be reached", async () => {
    await clearOutbox();
    await queuePush([u.admin], { kind: "test", title: "Retry", body: "x" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await deliverDuePushes();
    const row = await queryOne<Row & { status: string; attempts: number; wait: number }>(
      `SELECT p.status, p.attempts, TIMESTAMPDIFF(SECOND, NOW(), p.next_attempt_at) AS wait FROM push_outbox p JOIN push_devices d ON d.id = p.device_id WHERE d.token = ?`, [token("admin")],
    );
    expect(row?.status).toBe("queued");
    expect(Number(row?.attempts)).toBe(1);
    expect(Number(row?.wait)).toBeGreaterThan(60); // 2 minutes
    // not due yet: the next run leaves it alone
    const again = vi.fn();
    vi.stubGlobal("fetch", again);
    await deliverDuePushes();
    expect(again).not.toHaveBeenCalled();
  });

  it("reads receipts for messages sent a while ago", async () => {
    await clearOutbox();
    await queuePush([u.admin], { kind: "test", title: "Receipt", body: "x" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ status: "ok", id: `rc-${tag}` }] }), { status: 200 })));
    await deliverDuePushes();
    await execute(`UPDATE push_outbox SET sent_at = NOW() - INTERVAL 20 MINUTE WHERE expo_ticket_id = ?`, [`rc-${tag}`]);
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      const { ids } = JSON.parse(init.body) as { ids: string[] };
      return new Response(JSON.stringify({ data: Object.fromEntries(ids.map((id) => [id, { status: "ok" }])) }), { status: 200 });
    }));
    const r = await checkPushReceipts();
    expect(r.delivered).toBeGreaterThanOrEqual(1);
    expect((await outbox()).map((x) => x.status)).toEqual(["delivered"]);
  });
});
