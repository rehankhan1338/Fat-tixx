import { test, expect } from "@playwright/test";
import { testDb } from "./helpers/db";
import { uniq, watchConsole } from "./helpers/ui";

/**
 * The public create flow (plan 5.6) as a new organizer, in a real browser: no login wall, the checks before sign-up,
 * the live fee preview, the passwordless sign-up with a 6-digit code, the event going live at once with the payout
 * banner (5.6.9, option A), and the organizer sign-up questionnaire on the way into the dashboard.
 * Runs without an email provider, so the sign-up window shows the code in its test-mode notice.
 */
test.describe.configure({ mode: "serial" });

const id = uniq();
const email = `e2e-create-${id}@fattixx.local`;
const name = `E2E Create ${id}`;
const nextYear = new Date().getFullYear() + 1;

test.afterAll(async () => {
  const conn = await testDb();
  try {
    await conn.query(`DELETE FROM organizations WHERE name = ?`, [`E2E Host ${id}`]);
    await conn.query(`DELETE FROM users WHERE email_normalized = ?`, [email]);
    await conn.query(`DELETE FROM auth_codes WHERE destination = ?`, [email]);
  } finally {
    await conn.end();
  }
});

test("a new organizer goes from /create to a live event and the sign-up questionnaire", async ({ page }) => {
  const consoleLog = watchConsole(page);
  await page.goto("/create");
  await expect(page).toHaveURL(/\/create$/); // no login wall (5.6.2)

  // checks before sign-up (5.6.7): nothing opens, the problems are listed
  await page.getByRole("button", { name: "Create event" }).first().click();
  await expect(page.getByText(/things? left to add/).first()).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.locator("#c-name-input").fill(name);
  await page.locator("#c-category button").first().click();
  await page.locator("#c-sd").fill(`${nextYear}-07-10`);
  await page.locator("#c-st").fill("20:00");
  await page.locator("#c-location").getByRole("button", { name: "Online" }).click();
  await page.locator("#c-location").getByPlaceholder("https://").fill("https://meet.example.com/e2e");
  await page.locator("#c-tickets").getByPlaceholder("0.00").first().fill("25");
  // live fee preview (5.6.5): 6.5% + $1.29 on $25, buyer pays it
  await expect(page.locator("#c-tickets")).toContainText("Buyers pay $27.92, you receive $25.00");
  await expect(page.getByText("Draft saved").first()).toBeVisible();

  // the draft survives a reload (5.6.6)
  await page.reload();
  await expect(page.locator("#c-name-input")).toHaveValue(name);

  await page.getByRole("button", { name: "Create event" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Send code" }).click();
  const code = (await dialog.locator("b.font-mono").textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);
  await dialog.getByLabel("Code").fill(code);

  // screen 3: names, organizer name defaulting to the person's name, the terms
  await dialog.getByLabel("First name").fill("Jo");
  await dialog.getByLabel("Last name").fill(`Host${id}`);
  await expect(dialog.getByLabel("Organizer name")).toHaveValue(`Jo Host${id}`);
  await dialog.getByLabel("Organizer name").fill(`E2E Host ${id}`);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Create account and event" }).click();

  // live at once, with the payout banner (5.6.9 option A) and a working link (5.6.11)
  await expect(page.getByRole("heading", { name: "Your event is live." })).toBeVisible();
  await expect(page.getByText("Set up payouts to get paid for your ticket sales.")).toBeVisible();
  const url = await page.locator("#event-url").inputValue();
  for (const share of ["Text message", "WhatsApp", "X", "Facebook", "Email"]) await expect(page.getByRole("link", { name: share, exact: true })).toBeVisible();

  // the sign-up questionnaire on the way into the dashboard ("Organizer Sign Up")
  await page.getByRole("link", { name: "Go to dashboard" }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByText("Step 1 of 6")).toBeVisible();
  await page.getByText("Music", { exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  for (let i = 2; i <= 6; i++) await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page).toHaveURL(/\/org\/[^/]+$/);
  await expect(page.getByText("Set up payouts to get paid for your ticket sales.")).toBeVisible();

  // the public event page is live
  const res = await page.goto(new URL(url).pathname);
  expect(res?.status()).toBe(200);
  await expect(page.getByText(name).first()).toBeVisible();

  const conn = await testDb();
  try {
    const [rows] = await conn.query<import("mysql2").RowDataPacket[]>(`SELECT event_types, questionnaire_done_at FROM organizations WHERE name = ?`, [`E2E Host ${id}`]);
    expect(rows[0].event_types).toBe("music");
    expect(rows[0].questionnaire_done_at).not.toBeNull();
  } finally {
    await conn.end();
  }
  consoleLog.assertClean();
});

