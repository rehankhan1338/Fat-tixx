/**
 * "Live now, payouts later" (plan 5.6.9, option A) against the `fattixx_test` database: which organizations are asked
 * to set up payouts, the reminder emails and how often they go out.
 *   Create the DB once:  DB_NAME=fattixx_test node scripts/db-setup.mjs
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, execute, queryOne, type Row } from "@/lib/db";
import { needsPayoutSetup, orgsAwaitingPayoutSetup, sendPayoutReminders } from "@/lib/payments/payout-reminders";

const tag = randomUUID().slice(0, 8);
const orgIds: number[] = [];
const userIds: number[] = [];

async function org(name: string, verified: boolean): Promise<number> {
  const id = (await execute(`INSERT INTO organizations (slug, name, contact_email, verified_at) VALUES (?, ?, 'p@test.local', ?)`, [`pr-${name}-${tag}`, name, verified ? new Date() : null])).insertId;
  orgIds.push(id);
  const u = (await execute(`INSERT INTO users (public_id, email, email_normalized, name) VALUES (?, ?, ?, 'Admin')`, [randomUUID(), `pr-${name}-${tag}@test.local`, `pr-${name}-${tag}@test.local`])).insertId;
  userIds.push(u);
  await execute(`INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'org_admin')`, [id, u]);
  return id;
}

async function event(orgId: number, opts: { price: number; status?: string; days?: number }): Promise<void> {
  const e = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, ends_at, timezone, status, visibility, fee_mode)
     VALUES (?, ?, 'Payout test', NOW() + INTERVAL ? DAY, NOW() + INTERVAL ? DAY + INTERVAL 3 HOUR, 'America/New_York', ?, 'public', 'buyer_pays')`,
    [orgId, `pr-ev-${randomUUID().slice(0, 8)}`, opts.days ?? 7, opts.days ?? 7, opts.status ?? "published"],
  )).insertId;
  await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'GA', ?, 10)`, [e, opts.price]);
}

let paidNew: number, freeNew: number, paidVerified: number, draftOnly: number, pastOnly: number;

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  await execute(`UPDATE platform_settings SET \`value\` = 'manual' WHERE \`key\` = 'payout_mode'`);
  paidNew = await org("paidnew", false);
  await event(paidNew, { price: 2500 });
  freeNew = await org("freenew", false);
  await event(freeNew, { price: 0 });
  paidVerified = await org("paidver", true);
  await event(paidVerified, { price: 2500 });
  draftOnly = await org("draft", false);
  await event(draftOnly, { price: 2500, status: "draft" });
  pastOnly = await org("past", false);
  await event(pastOnly, { price: 2500, days: -3 });
});

afterAll(async () => {
  await execute(`DELETE FROM email_outbox WHERE related_type = 'organization' AND related_id IN (${orgIds.map(() => "?").join(",")})`, orgIds.map(String));
  for (const id of orgIds) await execute(`DELETE FROM organizations WHERE id = ?`, [id]);
  for (const id of userIds) await execute(`DELETE FROM users WHERE id = ?`, [id]);
  await db.end();
});

describe("payout setup reminders", () => {
  it("lists only organizations selling paid tickets on a live, upcoming event that can't be paid yet", async () => {
    const ids = (await orgsAwaitingPayoutSetup()).map((o) => o.id);
    expect(ids).toContain(paidNew);
    expect(ids).not.toContain(freeNew); // nothing to pay out
    expect(ids).not.toContain(paidVerified); // manual payouts: Fattixx has verified it and pays it
    expect(ids).not.toContain(draftOnly); // nothing on sale
    expect(ids).not.toContain(pastOnly); // event over
    expect(await needsPayoutSetup(paidNew)).toBe(true);
    expect(await needsPayoutSetup(paidVerified)).toBe(false);
  });

  it("emails the organization's admins, then waits a few days before the next reminder", async () => {
    await sendPayoutReminders();
    const sent = await queryOne<Row & { n: number; subject: string }>(
      `SELECT COUNT(*) AS n, MAX(subject) AS subject FROM email_outbox WHERE related_type = 'organization' AND related_id = ?`, [String(paidNew)],
    );
    expect(Number(sent?.n)).toBe(1);
    expect(sent?.subject).toMatch(/Set up payouts/);
    const none = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM email_outbox WHERE related_type = 'organization' AND related_id = ?`, [String(freeNew)]);
    expect(Number(none?.n)).toBe(0);

    await sendPayoutReminders(); // same day: no second email
    const again = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM email_outbox WHERE related_type = 'organization' AND related_id = ?`, [String(paidNew)]);
    expect(Number(again?.n)).toBe(1);

    await execute(`UPDATE organizations SET payout_reminder_at = NOW() - INTERVAL 4 DAY WHERE id = ?`, [paidNew]);
    await sendPayoutReminders();
    const later = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM email_outbox WHERE related_type = 'organization' AND related_id = ?`, [String(paidNew)]);
    expect(Number(later?.n)).toBe(2);
  });

  it("stops once Fattixx verifies the organization", async () => {
    await execute(`UPDATE organizations SET verified_at = NOW() WHERE id = ?`, [paidNew]);
    expect(await needsPayoutSetup(paidNew)).toBe(false);
  });
});
