import { test, expect, type Page } from "@playwright/test";
import { testDb } from "./helpers/db";
import { uniq, watchConsole } from "./helpers/ui";
import { expandLayout, newRowsSection, type SeatMapLayout, type Shape } from "../../src/lib/seating/layout";

/**
 * The event's Seating tab with a map taller than its window, in a real browser: the whole map shows without scrolling,
 * zoom works from there and keeps the same seats in view, selecting a seat doesn't move the map, and a pricing tier can
 * be added, edited, assigned and deleted.
 */
test.describe.configure({ mode: "serial" });

const id = uniq();
const email = `e2e-tiers-${id}@fattixx.local`;
const orgName = `E2E Tiers ${id}`;
const nextYear = new Date().getFullYear() + 1;

let page: Page;
let path = "";

async function db<T = import("mysql2").RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await testDb();
  try {
    const [rows] = await conn.query<import("mysql2").RowDataPacket[]>(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

/** Six sections in three bands under a stage: the shape of a theatre, much taller than the window at full width. */
function theatre(): SeatMapLayout {
  const band = (name: string, y: number) => [
    newRowsSection({ id: `${name}l`.toLowerCase(), name: `${name} Left`, x: 200, y }),
    newRowsSection({ id: `${name}r`.toLowerCase(), name: `${name} Right`, x: 500, y }),
  ];
  const shapes: Shape[] = [{ id: "stage", kind: "stage", x: 250, y: 20, w: 300, h: 60, text: "Stage" } as Shape];
  return { version: 1, width: 1000, height: 1000, shapes, sections: [...band("Ultra", 140), ...band("First", 340), ...band("Balcony", 540)] };
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
});

test.afterAll(async () => {
  await db(`DELETE FROM organizations WHERE name = ?`, [orgName]);
  await db(`DELETE FROM users WHERE email_normalized = ?`, [email]);
  await db(`DELETE FROM auth_codes WHERE destination = ?`, [email]);
  await page.context().close();
});

const scroller = () => page.getByRole("group", { name: "Event seat map" }).locator("xpath=..");
const metrics = () => scroller().evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight, top: el.scrollTop, left: el.scrollLeft }));
const seat = (label: string) => page.getByRole("button", { name: new RegExp(`^${label} ·`) });

test("an organizer opens the Seating tab of an event with a tall map", async () => {
  await page.goto("/create");
  await page.locator("#c-name-input").fill(`Tiers night ${id}`);
  await page.locator("#c-category button").first().click();
  await page.locator("#c-sd").fill(`${nextYear}-08-14`);
  await page.locator("#c-st").fill("19:00");
  await page.locator("#c-location").getByRole("button", { name: "Online" }).click();
  await page.locator("#c-location").getByPlaceholder("https://").fill("https://meet.example.com/e2e");
  await page.getByRole("button", { name: "Create event" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Send code" }).click();
  await dialog.getByLabel("Code").fill((await dialog.locator("b.font-mono").textContent())!.trim());
  await dialog.getByLabel("First name").fill("Tee");
  await dialog.getByLabel("Last name").fill(`Host${id}`);
  await dialog.getByLabel("Organizer name").fill(orgName);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Create account and event" }).click();
  await expect(page.getByRole("heading", { name: "Your event is live." })).toBeVisible();

  const [org] = await db<{ id: number; slug: string }>(`SELECT id, slug FROM organizations WHERE name = ?`, [orgName]);
  const [event] = await db<{ id: number }>(`SELECT id FROM events WHERE organization_id = ?`, [org.id]);
  await db(`UPDATE organizations SET pro_until = NOW() + INTERVAL 30 DAY, verified_at = NOW() WHERE id = ?`, [org.id]);
  const layout = theatre();
  await db(`INSERT INTO event_seating (event_id, layout) VALUES (?, ?)`, [event.id, JSON.stringify(layout)]);
  for (const s of expandLayout(layout)) {
    await db(`INSERT INTO event_seats (event_id, seat_key, section, row_label, seat_number, label, x, y, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [event.id, s.key, s.section, s.row, s.number, s.label, s.x, s.y, s.sort]);
  }
  path = `/org/${org.slug}/events/${event.id}?tab=seating`;
  await page.goto(path);
  await expect(page.getByText(/^Seating:/)).toBeVisible();
});

test("the whole map fits its window, and zoom keeps the same seats in view", async () => {
  await expect.poll(async () => { const m = await metrics(); return m.sh <= m.ch && m.sw <= m.cw; }).toBe(true);
  await scroller().scrollIntoViewIfNeeded();

  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await zoomIn.click();
  await expect.poll(async () => { const m = await metrics(); return m.sh > m.ch; }).toBe(true);
  await zoomIn.click();
  const zoomed = await metrics();
  // Started from the centre of the map, so it stays near the centre instead of jumping to the corner.
  expect(Math.abs(zoomed.top + zoomed.ch / 2 - zoomed.sh / 2)).toBeLessThan(zoomed.ch / 2);

  await page.getByRole("button", { name: "Fit the whole map" }).click();
  await expect.poll(async () => { const m = await metrics(); return m.sh <= m.ch && m.sw <= m.cw; }).toBe(true);
});

test("selecting a seat doesn't move the map", async () => {
  const before = (await scroller().boundingBox())!;
  await seat("Ultra Left · Row A · Seat 1").click();
  await expect(page.getByText("1 selected")).toBeVisible();
  expect((await scroller().boundingBox())!.y).toBe(before.y);
  await page.getByRole("button", { name: "Clear selection" }).click();
});

test("a tier can be added, edited, given seats and deleted", async () => {
  const table = page.locator("table").first();
  await page.locator("#tier-name").fill("Balcny");
  await page.locator("#tier-price").fill("50");
  await page.getByRole("button", { name: "Add tier" }).click();
  await expect(table.getByText("Balcny")).toBeVisible();
  await expect(page.locator("#tier-name")).toHaveValue("");

  await page.getByRole("button", { name: "Edit Balcny" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Balcony");
  await dialog.getByLabel("Price ($)").fill("75");
  await dialog.getByRole("button", { name: "Save tier" }).click();
  await expect(dialog).toBeHidden();
  const row = table.getByRole("row", { name: /Balcony/ });
  await expect(row).toContainText("$75.00");

  await page.getByText("Ultra Left", { exact: true }).click();
  await expect(page.getByText("60 selected")).toBeVisible();
  await page.getByRole("button", { name: "Assign to tier" }).click();
  await expect(row.getByRole("cell").nth(2)).toHaveText("60");

  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("60 seats go back to not for sale");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(table.getByText("Balcony")).toBeHidden();
  await expect(table.getByRole("row", { name: /Not for sale/ })).toContainText("360");
  await expect(page.getByRole("button", { name: "Assign to tier" })).toBeHidden();
});

test("page stays free of console errors", async () => {
  const watch = watchConsole(page);
  await page.goto(path);
  await expect(page.getByText(/^Seating:/)).toBeVisible();
  watch.assertClean();
});
