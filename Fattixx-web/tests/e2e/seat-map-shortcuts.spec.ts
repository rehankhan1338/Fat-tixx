import { test, expect, type Locator, type Page } from "@playwright/test";
import { E2E, testDb } from "./helpers/db";
import { login, uniq, watchConsole } from "./helpers/ui";

/**
 * Seat maps without a request, selection shortcuts, autosave and comp seats, in a real browser:
 *  - a Super Admin creates a map from Admin → Seat maps (no organizer request), selects seats by dragging a box,
 *    Shift+click and double-click, takes seats out with Delete, and gets the unsaved work back after a reload;
 *  - the organizer's Seating tab assigns seats picked with the same shortcuts, and keeps a selection across a reload;
 *  - Issue tickets gives a comp ticket for an exact seat.
 */
test.describe.configure({ mode: "serial" });

const id = uniq();
const orgName = `E2E Shortcuts ${id}`;
const venue = `Shortcut Hall ${id}`;
let page: Page;
let orgId = 0, orgSlug = "", eventId = 0, mapId = 0;

async function db<T = import("mysql2").RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await testDb();
  try {
    const [rows] = await conn.query<import("mysql2").RowDataPacket[]>(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  orgSlug = `e2e-shortcuts-${id}`;
  await db(`INSERT INTO organizations (slug, name, contact_email, pro_until, verified_at) VALUES (?, ?, 'e2e@fattixx.local', NOW() + INTERVAL 30 DAY, NOW())`, [orgSlug, orgName]);
  orgId = Number((await db<{ id: number }>(`SELECT id FROM organizations WHERE slug = ?`, [orgSlug]))[0].id);
  await db(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'Shortcut night', NOW() + INTERVAL 30 DAY, 'America/New_York', 'draft', 'public', 'buyer_pays')`,
    [orgId, `e2e-shortcuts-event-${id}`],
  );
  eventId = Number((await db<{ id: number }>(`SELECT id FROM events WHERE organization_id = ?`, [orgId]))[0].id);
});

test.afterAll(async () => {
  await db(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  if (mapId) await db(`DELETE FROM seat_maps WHERE id = ?`, [mapId]);
  await page.context().close();
});

/** Builder canvas units → screen pixels (the canvas is 1200 × 800 at 100% zoom). */
async function canvasPoint(x: number, y: number) {
  const box = (await page.getByRole("application", { name: "Seat map builder canvas" }).boundingBox())!;
  return { x: box.x + (x * box.width) / 1200, y: box.y + (y * box.height) / 800 };
}
async function drag(from: { x: number; y: number }, to: { x: number; y: number }, modifiers: ("Shift" | "Alt")[] = []) {
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  for (const m of modifiers) await page.keyboard.up(m);
}
// A new rows block: 5 rows × 12 seats centred at x 600, row A at y 265, 22 apart, rows 26 apart.
const seatAt = (row: number, seat: number) => canvasPoint(600 + (seat - 6.5) * 22, 265 + row * 26);

test("a Super Admin starts a seat map without a request", async () => {
  await login(page);
  await page.goto(`${E2E.adminUrl}/admin/seating`);
  await page.getByRole("button", { name: "New seat map" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Built for").selectOption({ label: orgName });
  await dialog.getByLabel("Venue name").fill(venue);
  await dialog.getByRole("button", { name: "Create and open the builder" }).click();
  await page.waitForURL(/\/admin\/seating\/maps\/\d+$/);
  mapId = Number(page.url().split("/").pop());
  await expect(page.getByRole("heading", { name: `${venue} seating` })).toBeVisible();
});

test("seats are selected by box, Shift+click and double-click, and Delete takes them out", async () => {
  await page.getByRole("button", { name: "+ Rows" }).click();
  await expect(page.getByText("60 seats", { exact: true })).toBeVisible();
  // Bring the new block (canvas y 250–380) to the middle of the window.
  await page.getByRole("application", { name: "Seat map builder canvas" }).locator("circle").nth(30).evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));

  // A box over seats 1–4 of rows A and B, started on empty canvas.
  await drag(await canvasPoint(465, 250), await canvasPoint(556, 300));
  await expect(page.getByText("8 seats selected")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByText("52 seats", { exact: true })).toBeVisible();

  const a6 = await seatAt(0, 6), a8 = await seatAt(0, 8), c9 = await seatAt(2, 9);
  await page.mouse.click(a6.x, a6.y);
  await expect(page.getByText("1 seat selected")).toBeVisible();
  await page.keyboard.down("Shift");
  await page.mouse.click(a8.x, a8.y);
  await page.keyboard.up("Shift");
  await expect(page.getByText("3 seats selected")).toBeVisible();
  await page.mouse.dblclick(c9.x, c9.y);
  await expect(page.getByText("15 seats selected")).toBeVisible();
  // Alt + box removes from the selection.
  await drag(await canvasPoint(465, 305), await canvasPoint(728, 330), ["Alt"]); // Alt + box over row C removes it again
  await expect(page.getByText("3 seats selected")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/seats? selected/)).toBeHidden();
});

test("unsaved work is autosaved and comes back after a reload", async () => {
  await expect(page.getByText(/autosaved at/)).toBeVisible({ timeout: 30_000 });
  const [row] = await db<{ draft_layout: string | null }>(`SELECT draft_layout FROM seat_maps WHERE id = ?`, [mapId]);
  expect(row.draft_layout).toContain("Section");
  page.once("dialog", (d) => d.accept()); // the "leave the page?" prompt for unsaved changes
  await page.reload();
  await expect(page.getByText(/Restored unsaved changes/)).toBeVisible();
  await expect(page.getByText("52 seats", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/^Saved: /)).toBeVisible();
  await page.getByRole("button", { name: "Publish map" }).click();
  await expect(page.getByText(/Published\. .* can now use it/)).toBeVisible();
  const [map] = await db<{ status: string; seat_count: number; draft_layout: string | null }>(`SELECT status, seat_count, draft_layout FROM seat_maps WHERE id = ?`, [mapId]);
  expect(map).toMatchObject({ status: "approved", seat_count: 52, draft_layout: null });
});

const seatButton = (scope: Page | Locator, label: string) => scope.getByRole("button", { name: new RegExp(`^Section · ${label} ·`) });
async function boxOver(first: Locator, last: Locator, modifiers: ("Shift" | "Alt")[] = []) {
  await first.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  const a = (await first.boundingBox())!, b = (await last.boundingBox())!;
  await drag({ x: a.x - 2, y: a.y - 2 }, { x: b.x + b.width + 2, y: b.y + b.height + 2 }, modifiers);
}

test("the organizer's Seating tab uses the map and assigns seats picked with the shortcuts", async () => {
  await page.goto(`${E2E.adminUrl}/org/${orgSlug}/events/${eventId}?tab=seating`);
  await page.locator("#seating-map").selectOption(String(mapId));
  await page.getByRole("button", { name: "Use this map" }).click();
  await expect(page.getByText(/^Seating:/)).toBeVisible();
  await page.locator("#tier-name").fill("Gold");
  await page.locator("#tier-price").fill("25");
  await page.getByRole("button", { name: "Add tier" }).click();
  await expect(page.locator("table").first().getByText("Gold")).toBeVisible();

  await boxOver(seatButton(page, "Row A · Seat 5"), seatButton(page, "Row B · Seat 6"));
  await expect(page.getByText("4 selected", { exact: true })).toBeVisible();
  await seatButton(page, "Row A · Seat 7").click();
  await expect(page.getByText("5 selected", { exact: true })).toBeVisible();
  await seatButton(page, "Row A · Seat 9").click({ modifiers: ["Shift"] });
  await expect(page.getByText("7 selected", { exact: true })).toBeVisible();
  await seatButton(page, "Row C · Seat 10").dblclick();
  await expect(page.getByText("19 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Assign to tier" }).click();
  await expect(page.getByText("Assigned 19 seats to Gold.")).toBeVisible();
  await expect(page.locator("table").first().getByRole("row", { name: /Gold/ }).getByRole("cell").nth(2)).toHaveText("19");
});

test("a selection survives a reload, and Esc clears it", async () => {
  await seatButton(page, "Row D · Seat 1").click();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.waitForTimeout(500); // the selection is stored a moment after it changes
  await page.reload();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await expect(page.getByText("(kept from your last visit)")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Nothing selected")).toBeVisible();
});

test("a comp ticket gets the exact seat chosen on the map", async () => {
  const watch = watchConsole(page);
  await page.goto(`${E2E.adminUrl}/org/${orgSlug}/events/${eventId}?tab=attendees`);
  await page.getByRole("button", { name: "Issue tickets" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Attendee name").fill("Guest Person");
  await dialog.getByLabel("Attendee email").fill(`guest-${id}@fattixx.local`);
  await dialog.getByLabel("Ticket type").selectOption({ label: "Gold (seat map)" });
  await seatButton(dialog, "Row C · Seat 4").click();
  await expect(dialog.getByText("1 chosen")).toBeVisible();
  await dialog.getByRole("button", { name: "Issue & email tickets" }).click();
  await expect(page.getByText(/1 ticket\(s\) issued .*Section · Row C · Seat 4/)).toBeVisible();
  const tickets = await db<{ seat_label: string }>(`SELECT seat_label FROM tickets WHERE event_id = ?`, [eventId]);
  expect(tickets.map((t) => t.seat_label)).toEqual(["Section · Row C · Seat 4"]);
  watch.assertClean();
});
