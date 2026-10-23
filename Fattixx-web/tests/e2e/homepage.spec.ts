import { test, expect } from "@playwright/test";
import { testDb } from "./helpers/db";
import { uniq, watchConsole } from "./helpers/ui";

/** The public homepage design wired to real events: listing, all-in price, category filter, search, deep links. */
test.describe.configure({ mode: "serial" });

const id = uniq();
const slug = `e2e-home-${id}`;
const title = `E2E Homepage Jazz ${id}`;

test.beforeAll(async () => {
  const conn = await testDb();
  try {
    const [org] = await conn.query<import("mysql2").ResultSetHeader>(`INSERT INTO organizations (slug, name, contact_email) VALUES (?, 'E2E Home Org', ?)`, [`e2e-ho-${id}`, `e2e-ho-${id}@fattixx.local`]);
    const [venue] = await conn.query<import("mysql2").ResultSetHeader>(`INSERT INTO venues (organization_id, name, city, region, latitude, longitude) VALUES (?, 'Jazz Cellar', 'Greenville', 'SC', 34.8526, -82.394)`, [org.insertId]);
    const [ev] = await conn.query<import("mysql2").ResultSetHeader>(
      `INSERT INTO events (organization_id, venue_id, slug, title, category, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, ?, ?, 'Music', NOW() + INTERVAL 3 DAY, 'America/New_York', 'published', 'public', 'buyer_pays')`,
      [org.insertId, venue.insertId, slug, title],
    );
    await conn.query(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'GA', 2500, 100)`, [ev.insertId]);
  } finally { await conn.end(); }
});

test("real events are listed with all-in prices, filters and links", async ({ page }) => {
  const c = watchConsole(page);
  await page.goto("/");
  await expect(page.locator("h1").first()).toContainText("tickets for everything");
  await expect(page.locator("body")).not.toContainText("Preview: sample events");

  await page.fill("#q", title);
  const card = page.locator("#events article", { hasText: title });
  await expect(card).toBeVisible();
  // $25 + 6.5% service fee + $1.29 (no venue tax): the same all-in price the event page shows.
  await expect(card).toContainText("From $27.92");
  await expect(card).toContainText("Jazz Cellar, Greenville, SC");
  await expect(card.locator(`a[href="/events/${slug}"]`)).toBeVisible();

  // Category pill: Nightlife hides it, Music shows it.
  await page.click('button[aria-pressed]:has-text("Nightlife")');
  await expect(card).toHaveCount(0);
  await page.click('button[aria-pressed]:has-text("Music")');
  await expect(card).toBeVisible();

  await card.locator("a").first().click();
  await expect(page).toHaveURL(new RegExp(`/events/${slug}`));
  c.assertClean();
});

test("footer deep links apply their filters", async ({ page }) => {
  await page.goto("/?price=free#events");
  await expect(page.locator('#events button[aria-pressed="true"]:has-text("Free")')).toBeVisible();
  await page.fill("#q", title);
  await expect(page.locator("#events article", { hasText: title })).toHaveCount(0); // paid event filtered out
});
