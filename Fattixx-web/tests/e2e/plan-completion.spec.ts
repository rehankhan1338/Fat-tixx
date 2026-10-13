import { createHmac, randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { loadEnvLocal, testDb } from "./helpers/db";
import { login, uniq, watchConsole } from "./helpers/ui";

/**
 * Plan-completion features end to end: promoter link + promo code at checkout, offline scanning with
 * sync and conflict review, the ad system, organizer applications, embed / permission headers.
 */
test.describe.configure({ mode: "serial" });

const id = uniq();
const orgSlug = `e2e-p-${id}`;
const eventSlug = `e2e-pev-${id}`;
const linkCode = `e2e${id}`.slice(0, 20);
let orgId = 0, eventId = 0, gaId = 0;
const tickets: { id: number; payload: string }[] = [];

function sign(code: string, secret: string) {
  loadEnvLocal();
  const body = `FTX1.${code}.${secret}`;
  return `${body}.${createHmac("sha256", process.env.TICKET_SIGNING_KEY!).update(body).digest("base64url").slice(0, 22)}`;
}

test.beforeAll(async () => {
  const conn = await testDb();
  try {
    const [org] = await conn.query<import("mysql2").ResultSetHeader>(`INSERT INTO organizations (slug, name, contact_email, verified_at) VALUES (?, ?, ?, NOW())`, [orgSlug, `E2E Plan ${id}`, `e2e-porg-${id}@fattixx.local`]);
    orgId = org.insertId;
    const [venue] = await conn.query<import("mysql2").ResultSetHeader>(`INSERT INTO venues (organization_id, name, city, region) VALUES (?, 'E2E Hall', 'Charleston', 'SC')`, [orgId]);
    const [ev] = await conn.query<import("mysql2").ResultSetHeader>(
      `INSERT INTO events (organization_id, venue_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, ?, ?, NOW() + INTERVAL 20 DAY, 'America/New_York', 'published', 'public', 'buyer_pays')`,
      [orgId, venue.insertId, eventSlug, `E2E Plan Night ${id}`],
    );
    eventId = ev.insertId;
    const [ga] = await conn.query<import("mysql2").ResultSetHeader>(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'General Admission', 2000, 50)`, [eventId]);
    gaId = ga.insertId;
    await conn.query(`INSERT INTO promo_codes (event_id, code, kind, value) VALUES (?, 'HALF', 'percent', 5000)`, [eventId]);
    await conn.query(`INSERT INTO tracking_links (organization_id, event_id, code, name, utm_source, utm_medium) VALUES (?, ?, ?, 'E2E promoter', 'e2e-promoter', 'referral')`, [orgId, eventId, linkCode]);
    // Two issued tickets for the scanner tests.
    const [o] = await conn.query<import("mysql2").ResultSetHeader>(
      `INSERT INTO orders (code, access_token_hash, organization_id, event_id, buyer_email, buyer_name, status, fee_mode, paid_at) VALUES (?, ?, ?, ?, ?, 'Door Guest', 'paid', 'buyer_pays', NOW())`,
      [`FTX-${id.slice(-6).toUpperCase()}`, "0".repeat(64), orgId, eventId, `e2e-door-${id}@fattixx.local`],
    );
    const [item] = await conn.query<import("mysql2").ResultSetHeader>(`INSERT INTO order_items (order_id, ticket_type_id, ticket_type_name, quantity, unit_price_cents) VALUES (?, ?, 'General Admission', 2, 2000)`, [o.insertId, gaId]);
    for (let i = 0; i < 2; i++) {
      const code = randomBytes(8).toString("hex").toUpperCase().slice(0, 12).replace(/[^A-Z0-9]/g, "A");
      const secret = randomBytes(16).toString("hex");
      const [t] = await conn.query<import("mysql2").ResultSetHeader>(
        `INSERT INTO tickets (code, secret, order_id, order_item_id, event_id, ticket_type_id, attendee_name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [code, secret, o.insertId, item.insertId, eventId, gaId, `Door Guest ${i + 1}`],
      );
      tickets.push({ id: t.insertId, payload: sign(code, secret) });
    }
    await conn.query(`UPDATE ticket_types SET sold = 2 WHERE id = ?`, [gaId]);
  } finally {
    await conn.end();
  }
});

test("promoter link is counted, attributed, and a promo code discounts the checkout", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/r/${linkCode}`);
  await expect(page).toHaveURL(new RegExp(`/events/${eventSlug}\\?.*ref=${linkCode}`));
  await page.locator("li", { hasText: "General Admission" }).locator('button[aria-label="More"]').click();
  await page.fill("#name", "Promo Buyer");
  await page.fill("#email", `e2e-promo-${id}@fattixx.local`);
  await page.fill("#promo_code", "half");
  await page.waitForTimeout(900);
  await Promise.all([page.waitForURL(/\/checkout\/FTX-/), page.click('button:has-text("Continue to payment")')]);
  await expect(page.locator("body")).toContainText("Promo discount");
  await expect(page.locator("body")).toContainText("−$10.00");
  const conn = await testDb();
  try {
    const [[o]] = await conn.query<import("mysql2").RowDataPacket[]>(`SELECT o.discount_cents, o.utm_source, o.tracking_link_id, l.clicks FROM orders o LEFT JOIN tracking_links l ON l.id = o.tracking_link_id WHERE o.buyer_email = ?`, [`e2e-promo-${id}@fattixx.local`]);
    expect(Number(o.discount_cents)).toBe(1000);
    expect(o.utm_source).toBe("e2e-promoter");
    expect(o.tracking_link_id).not.toBeNull();
    expect(Number(o.clicks)).toBe(1);
  } finally { await conn.end(); }
});

test("scanner keeps working offline, syncs, and flags a double admission for review", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  const res = await page.goto(`/org/${orgSlug}/events/${eventId}/scan`);
  expect(res!.headers()["permissions-policy"]).toContain("camera=(self)");
  await expect(page.locator("body")).toContainText("2 tickets on this device");

  await context.setOffline(true);
  await page.fill('input[aria-label="Ticket code"]', tickets[0].payload);
  await page.click('button:has-text("Check")');
  await expect(page.locator("[role=status]")).toContainText("Admitted offline");
  await expect(page.locator("body")).toContainText("Offline: scanning from the downloaded list");
  // Same ticket again on this device: already used locally.
  await page.waitForTimeout(4100);
  await page.fill('input[aria-label="Ticket code"]', tickets[0].payload);
  await page.click('button:has-text("Check")');
  await expect(page.locator("[role=status]")).toContainText("ALREADY USED");
  // A forged QR (valid code, wrong secret) is rejected offline too.
  const forged = tickets[1].payload.replace(/\.[a-f0-9]{32}\./, `.${"0".repeat(32)}.`);
  await page.fill('input[aria-label="Ticket code"]', forged);
  await page.click('button:has-text("Check")');
  await expect(page.locator("[role=status]")).toContainText("INVALID");
  // Ticket 2 admitted offline while another door already let it in.
  await page.waitForTimeout(4100);
  await page.fill('input[aria-label="Ticket code"]', tickets[1].payload);
  await page.click('button:has-text("Check")');
  await expect(page.locator("[role=status]")).toContainText("Admitted offline");
  const conn = await testDb();
  try {
    await conn.query(`UPDATE tickets SET status = 'used', checked_in_at = NOW() WHERE id = ?`, [tickets[1].id]);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("body")).toContainText("flagged as conflicts", { timeout: 20_000 });
    const [[t]] = await conn.query<import("mysql2").RowDataPacket[]>(`SELECT status FROM tickets WHERE id = ?`, [tickets[0].id]);
    expect(t.status).toBe("used");
    const [logs] = await conn.query<import("mysql2").RowDataPacket[]>(`SELECT result, offline FROM checkin_log WHERE event_id = ? AND offline = 1 ORDER BY id`, [eventId]);
    expect(logs.map((l) => l.result)).toEqual(["valid", "offline_conflict"]);
  } finally { await conn.end(); }

  await page.goto(`/org/${orgSlug}/events/${eventId}`);
  await expect(page.locator("body")).toContainText("1 offline check-in conflict to review");
  await page.click('button:has-text("Mark reviewed")');
  await expect(page.locator("body")).not.toContainText("offline check-in conflict to review", { timeout: 15_000 });
});

test("super admin creates, activates and serves an ad; impressions are counted", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const c = watchConsole(page);
  await login(page);
  await page.goto("/admin/ads/new");
  await page.fill("#c-name", `e2e-ad-${id}`);
  await page.fill("#c-adv", "E2E Sponsor Co");
  await page.fill("#c-url", "https://example.com/sponsor");
  await page.fill("#c-event", String(eventId));
  await page.fill("#c-priority", "100");
  await page.check("#pl-event_detail");
  await Promise.all([page.waitForURL(/\/admin\/ads\/\d+$/), page.click('button:has-text("Create campaign")')]);
  await page.fill('input[name="alt_text"]', "E2E sponsor banner");
  await page.fill('input[name="headline"]', `Drinks by E2E ${id}`);
  await page.click('button:has-text("Add creative")');
  await expect(page.locator("body")).toContainText(`Drinks by E2E ${id}`);
  await page.click('button:has-text("Activate")');
  await page.click('[role=alertdialog] button:has-text("Activate")');
  await expect(page.locator("h1")).toContainText("active");

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`/events/${eventSlug}`);
  const ad = visitor.locator('aside[aria-label="Sponsored"]');
  await expect(ad).toContainText(`Drinks by E2E ${id}`, { timeout: 15_000 });
  await expect(ad).toContainText("Sponsored · E2E Sponsor Co");
  await ad.scrollIntoViewIfNeeded();
  const conn = await testDb();
  try {
    await expect.poll(async () => {
      const [[s]] = await conn.query<import("mysql2").RowDataPacket[]>(`SELECT COALESCE(SUM(s.impressions),0) AS n FROM ad_stats s JOIN ad_campaigns c ON c.id = s.campaign_id WHERE c.name = ?`, [`e2e-ad-${id}`]);
      return Number(s.n);
    }, { timeout: 15_000 }).toBeGreaterThan(0);
    // The checkout page has no ad slot (no ads near payment fields).
    await visitor.goto(`/tickets/find`);
    await expect(visitor.locator('aside[aria-label="Sponsored"]')).toHaveCount(0);
  } finally { await conn.end(); }
  c.assertClean();
});

test("organizer application is reviewed and approved into a verified organization", async ({ browser }) => {
  const applicant = await (await browser.newContext()).newPage();
  await applicant.goto("/sell");
  await applicant.fill("#ap-name", "E2E Applicant");
  await applicant.fill("#ap-email", `e2e-apply-${id}@fattixx.local`);
  await applicant.fill("#ap-org", `e2e-apply-${id}`);
  await applicant.fill("#ap-legal", "E2E Promotions LLC");
  await applicant.fill("#ap-tax", "1234");
  await applicant.fill("#ap-addr", "1 King St, Charleston SC");
  await applicant.check("#ap-agree");
  await applicant.waitForTimeout(900);
  await applicant.click('button:has-text("Apply to sell tickets")');
  await expect(applicant.locator("body")).toContainText("application is in review");

  const admin = await (await browser.newContext()).newPage();
  await login(admin);
  await admin.goto("/admin/applications");
  const card = admin.locator("li", { hasText: `e2e-apply-${id}` });
  await expect(card).toContainText("E2E Promotions LLC");
  await card.locator('button:has-text("Verify & approve")').click();
  await expect(admin.locator("body")).toContainText("is its Organization Admin");
  const conn = await testDb();
  try {
    const [[o]] = await conn.query<import("mysql2").RowDataPacket[]>(`SELECT verified_at, (SELECT role FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = g.id AND u.email_normalized = ?) AS role FROM organizations g WHERE slug LIKE ?`, [`e2e-apply-${id}@fattixx.local`, `e2e-apply-${id}%`]);
    expect(o.verified_at).not.toBeNull();
    expect(o.role).toBe("org_admin");
  } finally { await conn.end(); }
});

test("embed widget may be framed by other sites; everything else may not", async ({ request }) => {
  const embed = await request.get(`/embed/${eventSlug}`);
  expect(embed.status()).toBe(200);
  expect(embed.headers()["x-frame-options"]).toBeUndefined();
  expect(embed.headers()["content-security-policy"]).toContain("frame-ancestors *");
  const page = await request.get(`/events/${eventSlug}`);
  expect(page.headers()["x-frame-options"]).toBe("DENY");
  expect(page.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  const script = await request.get("/embed.js");
  expect(script.headers()["cross-origin-resource-policy"]).toBe("cross-origin");
  const health = await request.get("/api/health");
  expect((await health.json()).status).toBe("ok");
});
