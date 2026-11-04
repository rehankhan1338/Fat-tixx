import { test, expect, type Page } from "@playwright/test";
import { testDb } from "./helpers/db";
import { uniq, watchConsole } from "./helpers/ui";
import { newRowsSection, type SeatMapLayout } from "../../src/lib/seating/layout";

/**
 * Creating an event on a seat map, in a real browser: an organizer not on Pro is never offered it; on Pro it starts from
 * Events or Seat maps, asks for no ticket, and lands on the event's Seating tab, where seats are priced before publishing.
 */
test.describe.configure({ mode: "serial" });

const id = uniq();
const email = `e2e-map-${id}@fattixx.local`;
const orgName = `E2E Map ${id}`;
const mapName = `Hall ${id}`;
const nextYear = new Date().getFullYear() + 1;
let page: Page;
let slug: string;

async function db(sql: string, args: unknown[] = []) {
  const conn = await testDb();
  try {
    const [rows] = await conn.query<import("mysql2").RowDataPacket[]>(sql, args);
    return rows;
  } finally {
    await conn.end();
  }
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
});

test.afterAll(async () => {
  await db(`DELETE FROM organizations WHERE name = ?`, [orgName]);
  await db(`DELETE FROM seat_maps WHERE name = ?`, [mapName]);
  await db(`DELETE FROM users WHERE email_normalized = ?`, [email]);
  await db(`DELETE FROM auth_codes WHERE destination = ?`, [email]);
  await page.context().close();
});

test("an organizer not on Pro isn't offered a seat map", async () => {
  await page.goto("/create");
  await page.locator("#c-name-input").fill(`First night ${id}`);
  await page.locator("#c-category button").first().click();
  await page.locator("#c-sd").fill(`${nextYear}-07-10`);
  await page.locator("#c-st").fill("19:00");
  await page.locator("#c-location").getByRole("button", { name: "Online" }).click();
  await page.locator("#c-location").getByPlaceholder("https://").fill("https://meet.example.com/e2e");
  await expect(page.getByRole("group", { name: "Event type" }).getByRole("button", { name: "Seat map" })).toBeHidden();
  await page.getByRole("button", { name: "Create event" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Send code" }).click();
  await dialog.getByLabel("Code").fill((await dialog.locator("b.font-mono").textContent())!.trim());
  await dialog.getByLabel("First name").fill("Map");
  await dialog.getByLabel("Last name").fill(`Host${id}`);
  await dialog.getByLabel("Organizer name").fill(orgName);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Create account and event" }).click();
  await expect(page.getByRole("heading", { name: "Your event is live." })).toBeVisible();

  slug = (await db(`SELECT slug FROM organizations WHERE name = ?`, [orgName]))[0].slug;
  await db(`UPDATE organizations SET questionnaire_done_at = NOW() WHERE slug = ?`, [slug]);
  await page.goto(`/org/${slug}/events`);
  await expect(page.getByRole("button", { name: "New event" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Create event using a seat map" })).toBeHidden();
  await page.goto(`/org/${slug}/events/new?seating=1`);
  await expect(page.locator("#c-name-input")).toBeVisible();
  await expect(page.getByRole("group", { name: "Event type" }).getByRole("button", { name: "Seat map" })).toBeHidden();
});

test("on Pro, an event is made from a map without a ticket, priced on the Seating tab, then published", async () => {
  const consoleLog = watchConsole(page);
  const [org] = await db(`SELECT id FROM organizations WHERE slug = ?`, [slug]);
  await db(`UPDATE organizations SET pro_until = NOW() + INTERVAL 30 DAY, verified_at = NOW() WHERE id = ?`, [org.id]);
  await db(`INSERT INTO venues (organization_id, name, city, country, timezone) VALUES (?, 'Grand Hall', 'Atlanta', 'US', 'America/New_York')`, [org.id]);
  const [venue] = await db(`SELECT id, name FROM venues WHERE organization_id = ? AND name = 'Grand Hall'`, [org.id]);
  const layout: SeatMapLayout = { version: 1, width: 600, height: 400, shapes: [], sections: [newRowsSection({ id: "floor", name: "Floor", rows: 1, seatsPerRow: 4 })] };
  await db(`INSERT INTO seat_maps (organization_id, venue_id, name, venue_name, status, layout, seat_count) VALUES (?, ?, ?, ?, 'approved', ?, 4)`, [org.id, venue.id, mapName, venue.name, JSON.stringify(layout)]);
  const [map] = await db(`SELECT id FROM seat_maps WHERE name = ?`, [mapName]);

  // the Seat maps tab has the same way in, per map
  await page.goto(`/org/${slug}/seating`);
  await expect(page.getByRole("button", { name: "Create event using a seat map" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create event", exact: true })).toHaveAttribute("href", `/org/${slug}/events/new?seating=1&map=${map.id}`);

  await page.goto(`/org/${slug}/events`);
  await page.getByRole("button", { name: "Create event using a seat map" }).click();
  await expect(page).toHaveURL(/\/events\/new\?seating=1$/);
  const type = page.getByRole("group", { name: "Event type" });
  await expect(type.getByRole("button", { name: "Seat map" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Ticket name")).toBeHidden();
  await expect(page.getByRole("button", { name: "Add ticket type" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Save as draft" })).toBeHidden();

  await page.locator("#c-name-input").fill(`Map night ${id}`);
  await page.locator("#c-category button").first().click();
  await page.locator("#c-sd").fill(`${nextYear}-08-14`);
  await page.locator("#c-st").fill("19:00");

  // no map chosen: the page says so instead of saving
  await page.getByRole("button", { name: "Continue to seating" }).first().click();
  await expect(page.getByText("Choose a seat map").first()).toBeVisible();

  await page.locator("#c-seat-map").selectOption(String(map.id));
  await expect(page.locator("#c-location").locator("select")).toHaveValue(String(venue.id)); // the map's venue fills the location
  await page.getByRole("button", { name: "Continue to seating" }).first().click();

  await expect(page).toHaveURL(/\/org\/[^/]+\/events\/\d+\?tab=seating&created=1$/);
  await expect(page.getByText("Create a pricing tier, select seats on the map")).toBeVisible();
  await expect(page.getByText(`Seating: ${mapName}`)).toBeVisible();
  await expect(page.getByText("4 not for sale")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();

  // the draft reopens on the create page as a seated event: no ticket cards to fill in
  const eventPath = new URL(page.url()).pathname;
  await page.goto(`${eventPath}/edit`);
  await expect(page.getByText(`This event uses ${mapName}.`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add ticket type" })).toBeHidden();
  await page.getByRole("button", { name: "Publish now" }).first().click();
  await expect(page.getByText("Put seats on sale first").first()).toBeVisible();
  await page.goto(`${eventPath}?tab=seating`);

  await page.getByLabel("New tier").fill("Floor");
  await page.getByLabel("Price ($)").fill("45");
  await page.getByRole("button", { name: "Add tier" }).click();
  await expect(page.getByRole("cell", { name: "Floor" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Select all" }).click();
  await page.getByRole("button", { name: "Assign to tier" }).click();
  await expect(page.getByText("Assigned 4 seats to Floor.")).toBeVisible();

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Event published")).toBeVisible();
  const eventId = Number(eventPath.split("/").pop());
  expect((await db(`SELECT status FROM events WHERE id = ?`, [eventId]))[0].status).toBe("published");
  consoleLog.assertClean();
});
