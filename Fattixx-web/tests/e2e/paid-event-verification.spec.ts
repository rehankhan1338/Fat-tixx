import { test, expect, type Page } from "@playwright/test";
import { E2E, testDb } from "./helpers/db";
import { createEventInDashboard, login, uniq } from "./helpers/ui";

/**
 * Paid events of organizations made on /create wait for verification (src/lib/orgs/verification.ts), end to end in a
 * real browser: a free event goes live at once with a skippable password prompt; a paid one is held "In review"
 * (team-only preview, 404 for everyone else) also when published from the dashboard; the organizer sends the
 * verification with a required password; platform staff approve it in the admin console; the held event goes live,
 * the organizer is emailed and can sign in with the new password.
 */
test.describe.configure({ mode: "serial" });

const id = uniq();
const email = `e2e-verify-${id}@fattixx.local`;
const orgName = `E2E Verify ${id}`;
const password = "Verify flow passphrase 2026";
const nextYear = new Date().getFullYear() + 1;

let organizer: Page;
let orgSlug = "";
let paidEventId = "";
let paidEventPath = "";

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
  organizer = await (await browser.newContext()).newPage();
});

test.afterAll(async () => {
  await db(`DELETE FROM organizer_applications WHERE contact_email = ?`, [email]);
  await db(`DELETE FROM organizations WHERE name = ?`, [orgName]);
  await db(`DELETE FROM users WHERE email_normalized = ?`, [email]);
  await db(`DELETE FROM auth_codes WHERE destination = ?`, [email]);
  await organizer.context().close();
});

test("a free event from /create goes live at once and offers a password that can be skipped", async () => {
  const page = organizer;
  await page.goto("/create");
  await page.locator("#c-name-input").fill(`Free night ${id}`);
  await page.locator("#c-category button").first().click();
  await page.locator("#c-sd").fill(`${nextYear}-08-14`);
  await page.locator("#c-st").fill("19:00");
  await page.locator("#c-location").getByRole("button", { name: "Online" }).click();
  await page.locator("#c-location").getByPlaceholder("https://").fill("https://meet.example.com/e2e");

  await page.getByRole("button", { name: "Create event" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Send code" }).click();
  const code = (await dialog.locator("b.font-mono").textContent())!.trim();
  await dialog.getByLabel("Code").fill(code);
  await dialog.getByLabel("First name").fill("Vee");
  await dialog.getByLabel("Last name").fill(`Host${id}`);
  await dialog.getByLabel("Organizer name").fill(orgName);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Create account and event" }).click();

  await expect(page.getByRole("heading", { name: "Your event is live." })).toBeVisible();
  await expect(page.getByText("Set a password for your account")).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText("Set a password for your account")).toBeHidden();

  orgSlug = (await db<{ slug: string }>(`SELECT slug FROM organizations WHERE name = ?`, [orgName]))[0].slug;
  const [org] = await db<{ verified_at: Date | null }>(`SELECT verified_at FROM organizations WHERE slug = ?`, [orgSlug]);
  expect(org.verified_at).toBeNull();
});

test("the dashboard keeps reminding about the password", async () => {
  const page = organizer;
  await page.goto(`/org/${orgSlug}/welcome`);
  await page.getByText("Music", { exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  for (let i = 2; i <= 6; i++) await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/org/${orgSlug}$`));
  await expect(page.getByText("Set a password for your account")).toBeVisible();
  await page.getByRole("button", { name: "Later" }).click();
  await expect(page.getByText("Set a password for your account")).toBeHidden();
  await page.reload();
  await expect(page.getByText("Set a password for your account")).toBeVisible(); // "Later" only lasts until the next page
});

test("a paid event can't go on sale from the dashboard before verification", async ({ browser }) => {
  const page = organizer;
  paidEventId = await createEventInDashboard(page, "", orgSlug, { title: `Paid gala ${id}`, date: `${nextYear}-09-20`, time: "20:00", ticket: "GA", price: "30" });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText(/In review: paid events go live once your organization is verified/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("in review", { exact: true }).first()).toBeVisible(); // status badge
  await expect(page.getByRole("button", { name: "Verify organization" })).toBeVisible();
  await expect(page.getByText("Your paid event is in review.")).toBeVisible();

  const [ev] = await db<{ status: string; slug: string }>(`SELECT status, slug FROM events WHERE id = ?`, [paidEventId]);
  expect(ev.status).toBe("in_review");
  paidEventPath = `/events/${ev.slug}`;

  // the organizer previews it with the "In review" banner
  await page.goto(paidEventPath);
  await expect(page.getByText("In review", { exact: true })).toBeVisible();
  await expect(page.getByText(/Paid events go live once your organization is verified/)).toBeVisible();

  // nobody else can see it, and it isn't listed
  const visitor = await browser.newContext();
  try {
    const anon = await visitor.newPage();
    expect((await anon.goto(paidEventPath))?.status()).toBe(404);
    await anon.goto("/events");
    await expect(anon.getByText(`Paid gala ${id}`)).toHaveCount(0);
  } finally {
    await visitor.close();
  }
});

test("verification starts from the organizer's details and requires a password", async () => {
  const page = organizer;
  await page.goto(`/org/${orgSlug}/verify`);
  await expect(page.getByRole("heading", { name: "Verify your organization" })).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Your name")).toHaveValue(`Vee Host${id}`);

  await page.getByLabel("Legal name (for payouts)").fill("E2E Verify Events LLC");
  await page.getByLabel("Tax ID (last 4 digits)").fill("4321");
  await page.getByLabel("Business address").fill("1 King St, Charleston SC");
  await page.locator("#vf-agree").check();

  // the password is required: the browser blocks the form without it
  await page.getByRole("button", { name: "Send for verification" }).click();
  await expect(page.getByLabel("New password")).toHaveJSProperty("validity.valueMissing", true);
  expect(await db(`SELECT 1 FROM organizer_applications WHERE contact_email = ?`, [email])).toHaveLength(0);

  // mismatched passwords are turned down by the server
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(`${password}x`);
  await page.getByRole("button", { name: "Send for verification" }).click();
  await expect(page.locator("#f-vf-confirm-fx-error")).toHaveText("The two passwords do not match.");

  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Send for verification" }).click();
  // the page refreshes into its "in review" state
  await expect(page.getByText("Your verification is in review.")).toBeVisible();

  const [user] = await db<{ password_hash: string | null }>(`SELECT password_hash FROM users WHERE email_normalized = ?`, [email]);
  expect(user.password_hash).not.toBeNull();
  const [app] = await db<{ status: string; organization_id: number }>(`SELECT status, organization_id FROM organizer_applications WHERE contact_email = ?`, [email]);
  expect(app.status).toBe("pending");

  // the reminders change: no password prompt, verification in progress
  await page.goto(`/org/${orgSlug}`);
  await expect(page.getByText("Set a password for your account")).toBeHidden();
  await expect(page.getByText(/We’re verifying your organization/)).toBeVisible();
  await page.goto(`/org/${orgSlug}/verify`);
  await expect(page.getByText("Your verification is in review.")).toBeVisible();
});

test("platform staff approve it and the held event goes live", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  try {
    await login(admin);
    await admin.goto(`${E2E.adminUrl}/admin/applications`);
    const card = admin.locator("li", { hasText: orgName });
    await expect(card).toContainText("E2E Verify Events LLC");
    await expect(card).toContainText("Existing organization");
    await expect(card).toContainText("1 paid event waiting in review");
    await card.getByRole("button", { name: "Verify & approve" }).click();
    await expect(admin.getByText(/is verified and 1 held event is now live/)).toBeVisible();
  } finally {
    await admin.context().close();
  }

  const [org] = await db<{ verified_at: Date | null }>(`SELECT verified_at FROM organizations WHERE slug = ?`, [orgSlug]);
  expect(org.verified_at).not.toBeNull();
  const [ev] = await db<{ status: string }>(`SELECT status FROM events WHERE id = ?`, [paidEventId]);
  expect(ev.status).toBe("published");
  const [mail] = await db<{ subject: string; text_body: string }>(`SELECT subject, text_body FROM email_outbox WHERE to_email = ? ORDER BY id DESC LIMIT 1`, [email]);
  expect(mail.subject).toContain("is verified");
  expect(mail.text_body).toContain(`Paid gala ${id}`);

  const visitor = await browser.newContext();
  try {
    const anon = await visitor.newPage();
    expect((await anon.goto(paidEventPath))?.status()).toBe(200);
    await expect(anon.getByText(`Paid gala ${id}`).first()).toBeVisible();
  } finally {
    await visitor.close();
  }
});

test("the organizer can now sign in with the password and sees no reminders", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  try {
    await login(page, email, password);
    await page.goto(`/org/${orgSlug}`);
    await expect(page.getByRole("heading", { name: orgName })).toBeVisible();
    await expect(page.getByText("Set a password for your account")).toHaveCount(0);
    await expect(page.getByText(/paid event is in review/)).toHaveCount(0);
  } finally {
    await page.context().close();
  }
});
