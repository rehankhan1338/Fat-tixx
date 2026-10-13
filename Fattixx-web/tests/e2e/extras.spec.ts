import { test, expect, type Page } from "@playwright/test";
import { latestLinkFor, testDb } from "./helpers/db";
import { login, uniq, watchConsole } from "./helpers/ui";

/**
 * Event extras end to end: multi-day schedule, add-ons, checkout questions, presale access codes,
 * waitlist, recurring series and private links. Seeds an org + published event straight into the DB.
 */
test.describe.configure({ mode: "serial" });

const id = uniq();
const orgSlug = `e2e-x-${id}`;
const eventSlug = `e2e-ev-${id}`;
const buyerEmail = `e2e-xbuyer-${id}@fattixx.local`;
const waiterEmail = `e2e-xwait-${id}@fattixx.local`;
let eventId = 0;
let orderCode = "";

test.beforeAll(async () => {
  const conn = await testDb();
  try {
    const [org] = await conn.query<import("mysql2").ResultSetHeader>(`INSERT INTO organizations (slug, name, contact_email) VALUES (?, ?, ?)`, [orgSlug, `E2E Extras ${id}`, `e2e-xorg-${id}@fattixx.local`]);
    const [ev] = await conn.query<import("mysql2").ResultSetHeader>(
      `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, ?, '2026-12-05 01:00:00', 'America/New_York', 'published', 'public', 'buyer_pays')`,
      [org.insertId, eventSlug, `E2E Extras Night ${id}`],
    );
    eventId = ev.insertId;
    await conn.query(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'General Admission', 0, 2)`, [eventId]);
  } finally {
    await conn.end();
  }
});

async function openTab(page: Page, name: string) {
  await page.click(`[role=tab]:has-text("${name}")`);
}

test("organizer adds a second day, an add-on, a question and a presale ticket", async ({ page }) => {
  const c = watchConsole(page);
  await login(page);
  await page.goto(`/org/${orgSlug}/events/${eventId}`);
  await expect(page.locator("h1")).toContainText(`E2E Extras Night ${id}`);

  await openTab(page, "Schedule");
  await page.click('button:has-text("Add a day") >> nth=0');
  await page.fill("#d-label", "Saturday");
  await page.fill("#d-start", "2026-12-05T20:00");
  await page.click("[data-slot=dialog-content] button[type=submit]");
  await expect(page.locator("table")).toContainText("Day 1");
  await expect(page.locator("table")).toContainText("Saturday");
  await expect(page.locator("body")).toContainText("2 days");

  await openTab(page, "Checkout");
  await page.click('button:has-text("Add add-on") >> nth=0');
  await page.fill("#ad-name", "Parking pass");
  await page.fill("#ad-price", "0");
  await page.fill("#ad-qty", "5");
  await page.click("[data-slot=dialog-content] button[type=submit]");
  await expect(page.locator("body")).toContainText("Parking pass");
  await page.click('button:has-text("Add question") >> nth=0');
  await page.fill("#q-label", "Dietary needs?");
  await page.click("#q-required");
  await page.click("[data-slot=dialog-content] button[type=submit]");
  await expect(page.locator("body")).toContainText("Dietary needs?");

  await openTab(page, "Ticket types");
  await page.click('button:has-text("Add ticket type") >> nth=0');
  await page.fill("#tt-name", "Early Bird");
  await page.fill("#tt-price", "0");
  await page.fill("#tt-qty", "5");
  await expect(page.locator("#tt-day")).toBeVisible(); // multi-day: "valid for" selector appears
  await page.fill("#tt-code", "EARLY");
  await page.click("[data-slot=dialog-content] button[type=submit]");
  await expect(page.locator("table")).toContainText("code: EARLY");
  await expect(page.locator("table")).toContainText("all days");
  c.assertClean();
});

test("buyer unlocks the presale with a code, adds an add-on, answers the question and completes a free order", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const c = watchConsole(page);
  await page.goto(`/events/${eventSlug}`);
  await expect(page.locator("body")).toContainText("2-day event");
  await expect(page.locator("body")).toContainText("Saturday");
  await expect(page.locator("body")).not.toContainText("Early Bird");
  await page.fill("#access-code", "early");
  await Promise.all([page.waitForURL(/code=early/), page.click('button:has-text("Unlock")')]);
  await expect(page.locator("body")).toContainText("Code accepted");
  const early = page.locator("li", { hasText: "Early Bird" });
  await expect(early).toContainText("presale");
  await early.locator('button[aria-label="More"]').click();
  const parking = page.locator("li", { hasText: "Parking pass" });
  await expect(parking).toBeVisible();
  await parking.locator('button[aria-label="More"]').click();
  await expect(page.locator("body")).toContainText("1 ticket + 1 add-on");
  await page.fill("#name", "Presale Buyer");
  await page.fill("#email", buyerEmail);
  // Required question blocks checkout until answered (browser-side required attribute).
  await expect(page.locator('input[name^="q_"]')).toHaveAttribute("required", "");
  await page.fill('input[name^="q_"]', "Vegan");
  await Promise.all([page.waitForURL(/\/checkout\/FTX-/), page.click('button:has-text("Get free tickets")')]);
  orderCode = page.url().match(/FTX-[A-Z0-9]+/)![0];
  await expect(page.locator("body")).toContainText("Parking pass");
  await Promise.all([page.waitForURL(/\/orders\/FTX-/), page.click('button:has-text("Confirm free tickets")')]);
  await expect(page.locator("body")).toContainText("You’re going");
  await expect(page.locator("body")).toContainText("1 × Parking pass");
  await expect(page.locator("body")).toContainText("Add-ons have no QR code");
  c.assertClean();
});

test("organizer sees the answer and add-on on the order; a sold-out type opens the waitlist and tickets can be released", async ({ page, browser }) => {
  const c = watchConsole(page);
  await login(page);
  await page.goto(`/org/${orgSlug}/orders/${orderCode}`);
  await expect(page.locator("body")).toContainText("Dietary needs?");
  await expect(page.locator("body")).toContainText("Vegan");
  await expect(page.locator("body")).toContainText("Parking pass");

  // Sell out General Admission behind the scenes.
  const conn = await testDb();
  try { await conn.query(`UPDATE ticket_types SET sold = quantity WHERE event_id = ? AND name = 'General Admission'`, [eventId]); } finally { await conn.end(); }

  const pub = await (await browser.newContext()).newPage();
  await pub.goto(`/events/${eventSlug}`);
  await expect(pub.locator("body")).toContainText("Sold out");
  await expect(pub.locator("body")).toContainText("join the waitlist");
  await pub.fill("#wl-email", waiterEmail);
  await pub.fill("#wl-name", "Hopeful Fan");
  await pub.click('button:has-text("Notify me")');
  await expect(pub.locator("body")).toContainText("You are on the waitlist");

  await page.goto(`/org/${orgSlug}/events/${eventId}?tab=waitlist`);
  await expect(page.locator("body")).toContainText(waiterEmail);
  await expect(page.locator("[role=tab]", { hasText: "Waitlist (1)" })).toBeVisible();
  await page.click('button:has-text("Release tickets to waitlist")');
  await page.click('[data-slot=dialog-content] button:has-text("Send emails")');
  await expect(page.locator("body")).toContainText("1 person notified");
  expect(await latestLinkFor(waiterEmail, `/events/${eventSlug}`)).not.toBeNull();
  await expect(page.locator("table")).toContainText(/sent/i);
  await expect(page.locator("table")).toContainText("emailed");
  c.assertClean();
});

test("recurring copies are created and linked; a private event only opens with its key", async ({ page, browser }) => {
  const c = watchConsole(page);
  await login(page);
  await page.goto(`/org/${orgSlug}/events/${eventId}`);
  await page.click('button[aria-label="More actions"]');
  await page.click('[role=menuitem]:has-text("Make recurring")');
  await page.selectOption("#frequency", "weekly");
  await page.fill("#count", "2");
  await page.click("#series-publish");
  await page.click('[data-slot=dialog-content] button:has-text("Create dates")');
  await expect(page.locator("body")).toContainText("2 more occurrences created and published");
  await page.reload();
  await expect(page.locator("body")).toContainText("recurring");

  const pub = await (await browser.newContext()).newPage();
  await pub.goto(`/events/${eventSlug}`);
  await expect(pub.locator("body")).toContainText("More dates for this event");
  const links = pub.locator("a", { hasText: /Dec 1[12], 2026|Dec 1[89], 2026/ });
  await expect(links).toHaveCount(2);

  // Copies carry the schedule, ticket types, add-ons and questions.
  const conn = await testDb();
  try {
    const [rows] = await conn.query<import("mysql2").RowDataPacket[]>(
      `SELECT e.id, (SELECT COUNT(*) FROM event_dates d WHERE d.event_id = e.id) AS days, (SELECT COUNT(*) FROM ticket_types t WHERE t.event_id = e.id) AS types,
              (SELECT COUNT(*) FROM event_addons a WHERE a.event_id = e.id) AS addons, (SELECT COUNT(*) FROM event_questions q WHERE q.event_id = e.id) AS questions, e.status
         FROM events e WHERE e.series_id = (SELECT series_id FROM events WHERE id = ?) AND e.id <> ?`, [eventId, eventId]);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect([Number(r.days), Number(r.types), Number(r.addons), Number(r.questions), r.status]).toEqual([2, 2, 1, 1, "published"]);
    await conn.query(`UPDATE events SET visibility = 'private', private_key = 'e2ekey1234567890' WHERE id = ?`, [eventId]);
  } finally { await conn.end(); }

  const anon = await (await browser.newContext()).newPage();
  expect((await anon.goto(`/events/${eventSlug}`))!.status()).toBe(404);
  expect((await anon.goto(`/events/${eventSlug}?key=wrong`))!.status()).toBe(404);
  const ok = await anon.goto(`/events/${eventSlug}?key=e2ekey1234567890`);
  expect(ok!.status()).toBe(200);
  await expect(anon.locator("h1")).toContainText(`E2E Extras Night ${id}`);

  // The organizer page shows the shareable private link.
  await page.goto(`/org/${orgSlug}/events/${eventId}`);
  await expect(page.locator("body")).toContainText("Private event — share this link");
  await expect(page.locator("body")).toContainText("key=e2ekey1234567890");
  c.assertClean();
});
