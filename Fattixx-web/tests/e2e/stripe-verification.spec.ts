import { test, expect, type Page } from "@playwright/test";
import { E2E, testDb } from "./helpers/db";
import { createEventInDashboard, login, uniq } from "./helpers/ui";

/**
 * Stripe onboarding inside verification in a real browser (docs/Stripe_Onboarding_Manual_Test_Guide.docx): Step 2
 * on the verify page, the Individual / sole proprietor type without EIN, no sending before Stripe, the Stripe status
 * staff see on applications and organizations, approval blocked until Stripe verifies.
 *
 * Stripe's own form can't load without real keys, so the servers run with placeholder test keys
 * (STRIPE_SECRET_KEY=sk_test_e2e_placeholder, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_e2e_placeholder) and the
 * account's progress through Stripe is written to org_stripe_accounts the way the app records it. Skipped unless
 * E2E_STRIPE_CONNECT=1 says the servers were started that way. Stripe calls themselves are covered by
 * tests/unit/stripe-verification.integration.test.ts.
 */
test.describe.configure({ mode: "serial" });
test.skip(!process.env.E2E_STRIPE_CONNECT, "start the e2e servers with placeholder Stripe test keys and set E2E_STRIPE_CONNECT=1");

const id = uniq();
const email = `e2e-stripe-${id}@fattixx.local`;
const orgName = `E2E Stripe ${id}`;
const password = "Stripe flow passphrase 2026";
const nextYear = new Date().getFullYear() + 1;

let organizer: Page;
let orgSlug = "";
let orgId = 0;
let paidEventId = "";
let savedMode: string | null = null;

async function db<T = import("mysql2").RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const conn = await testDb();
  try {
    const [rows] = await conn.query<import("mysql2").RowDataPacket[]>(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

/** Where the organizer is with Stripe, as the app stores it after reading the account from Stripe. */
async function stripeAccount(state: "started" | "submitted" | "verified") {
  const v = { started: [0, 0, 0, '["individual.dob.day"]'], submitted: [1, 0, 0, "[]"], verified: [1, 1, 1, "[]"] }[state];
  await db(
    `INSERT INTO org_stripe_accounts (organization_id, stripe_mode, account_id, details_submitted, transfers_active, payouts_enabled, requirements_due, synced_at)
     VALUES (?, 'test', ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE details_submitted = VALUES(details_submitted), transfers_active = VALUES(transfers_active), payouts_enabled = VALUES(payouts_enabled), requirements_due = VALUES(requirements_due)`,
    [orgId, `acct_e2e_${id}`, ...v],
  );
}

test.beforeAll(async ({ browser }) => {
  savedMode = (await db<{ value: string }>("SELECT `value` FROM platform_settings WHERE `key` = 'payout_mode'"))[0]?.value ?? null;
  await db("INSERT INTO platform_settings (`key`, `value`) VALUES ('payout_mode', 'connect') ON DUPLICATE KEY UPDATE `value` = 'connect'");
  await db("UPDATE platform_settings SET `value` = 'test' WHERE `key` = 'stripe_mode'");
  organizer = await (await browser.newContext()).newPage();
});

test.afterAll(async () => {
  await db("UPDATE platform_settings SET `value` = ? WHERE `key` = 'payout_mode'", [savedMode ?? "manual"]);
  await db(`DELETE FROM organizer_applications WHERE contact_email = ?`, [email]);
  await db(`DELETE FROM organizations WHERE name = ?`, [orgName]);
  await db(`DELETE FROM users WHERE email_normalized = ?`, [email]);
  await db(`DELETE FROM auth_codes WHERE destination = ?`, [email]);
  await organizer.context().close();
});

test("guide test 1: an organizer from /create with a paid event held in review", async () => {
  const page = organizer;
  await page.goto("/create");
  await page.locator("#c-name-input").fill(`Free warmup ${id}`);
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
  await dialog.getByLabel("First name").fill("Jordan");
  await dialog.getByLabel("Last name").fill(`Lee${id}`);
  await dialog.getByLabel("Organizer name").fill(orgName);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Create account and event" }).click();
  await expect(page.getByRole("heading", { name: "Your event is live." })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();

  const [org] = await db<{ id: number; slug: string }>(`SELECT id, slug FROM organizations WHERE name = ?`, [orgName]);
  orgSlug = org.slug;
  orgId = Number(org.id);
  // the new organization's welcome questions come first
  await page.goto(`/org/${orgSlug}/welcome`);
  await page.getByText("Music", { exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  for (let i = 2; i <= 6; i++) await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/org/${orgSlug}$`));
  paidEventId = await createEventInDashboard(page, "", orgSlug, { title: `Rooftop Jazz ${id}`, date: `${nextYear}-09-20`, time: "20:00", ticket: "General admission", price: "25" });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText(/In review: paid events go live once your organization is verified/)).toBeVisible();
});

test("guide test 2: the verify page has the Stripe step, and Individual / sole proprietor needs no EIN", async () => {
  const page = organizer;
  await page.goto(`/org/${orgSlug}/verify`);
  await expect(page.getByText(`Step 1: ${orgName}`)).toBeVisible();
  const step2 = page.locator("fieldset#stripe");
  await expect(step2).toContainText("Step 2: Payouts with Stripe");
  await expect(step2).toContainText("Not started");
  await expect(step2.getByRole("button", { name: "Set up payouts" })).toBeVisible();

  const type = page.getByLabel("Type");
  await expect(type.locator("option", { hasText: "Individual / sole proprietor" })).toHaveCount(1);
  await type.selectOption("company");
  await expect(page.getByLabel("EIN (last 4 digits)")).toBeVisible();
  await expect(page.getByLabel("Legal name (for payouts)")).toBeVisible();
  await expect(page.getByLabel("Business address")).toBeVisible();

  await type.selectOption("individual");
  await expect(page.getByLabel("EIN (last 4 digits)")).toHaveCount(0);
  await expect(page.getByLabel("Your legal name (for payouts)")).toBeVisible();
  await expect(page.getByText("As on your ID")).toBeVisible();
  await expect(page.getByLabel("Address", { exact: true })).toBeVisible();
  await expect(step2).toContainText("No EIN needed");
});

test("guide test 3: the verification can't be sent before Stripe", async () => {
  const page = organizer;
  await page.getByLabel("Your legal name (for payouts)").fill(`Jordan Lee${id}`);
  await page.getByLabel("Address", { exact: true }).fill("100 Congress Ave, Austin, TX 78701");
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.locator("#vf-agree").check();
  await page.getByRole("button", { name: "Send for verification" }).click();
  await expect(page.getByText("Finish the payouts setup with Stripe (step 2) before sending your verification.")).toBeVisible();
  expect(await db(`SELECT 1 FROM organizer_applications WHERE organization_id = ?`, [orgId])).toHaveLength(0);
});

test("guide test 4: Set up payouts stays on the page (placeholder keys: Stripe turns it down, the page says so)", async () => {
  const page = organizer;
  await page.locator("fieldset#stripe").getByRole("button", { name: "Set up payouts" }).click();
  await expect(page.locator("fieldset#stripe").getByRole("alert")).toContainText("Stripe could not start the setup");
  await expect(page).toHaveURL(new RegExp(`/org/${orgSlug}/verify$`));
  await expect(page.getByLabel("Your legal name (for payouts)")).toHaveValue(`Jordan Lee${id}`); // the form keeps what was typed

  // Stripe's form half-done: the step now reads In progress, and sending is still blocked
  await stripeAccount("started");
  await page.reload();
  await expect(page.locator("fieldset#stripe")).toContainText("In progress");
  await expect(page.locator("fieldset#stripe").getByRole("button", { name: "Continue with Stripe" })).toBeVisible();
});

test("guide test 5: once Stripe has the details the verification goes in", async () => {
  const page = organizer;
  await stripeAccount("submitted");
  await page.reload();
  await expect(page.locator("fieldset#stripe")).toContainText("Stripe is verifying");
  await page.getByLabel("Type").selectOption("individual");
  await page.getByLabel("Your legal name (for payouts)").fill(`Jordan Lee${id}`);
  await page.getByLabel("Address", { exact: true }).fill("100 Congress Ave, Austin, TX 78701");
  if (await page.getByLabel("New password").count()) {
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
  }
  await page.locator("#vf-agree").check();
  await page.getByRole("button", { name: "Send for verification" }).click();
  await expect(page.getByText("Your verification is in review.")).toBeVisible();
  const [app] = await db<{ status: string; business_type: string; tax_id_last4: string | null }>(`SELECT status, business_type, tax_id_last4 FROM organizer_applications WHERE organization_id = ?`, [orgId]);
  expect(app).toMatchObject({ status: "pending", business_type: "individual", tax_id_last4: null });
  // until Stripe verifies, the in-review page keeps the Stripe step
  await page.reload();
  await expect(page.locator("fieldset#stripe")).toContainText("Stripe is verifying");
});

test("guide tests 6–8: staff see the Stripe status and can approve only once Stripe has verified", async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  try {
    await login(admin);
    await admin.goto(`${E2E.adminUrl}/admin/applications`);
    const card = admin.locator("li", { hasText: orgName });
    await expect(card).toContainText("Individual / sole proprietor");
    await expect(card).toContainText("Stripe: In progress");
    await expect(card).toContainText("Approval opens once Stripe has verified this organizer");

    await card.getByRole("button", { name: "Verify & approve" }).click();
    await expect(admin.getByText(/Stripe setup isn't complete \(status: In progress\)\..*must finish it before you can approve/)).toBeVisible();
    expect((await db<{ status: string }>(`SELECT status FROM organizer_applications WHERE organization_id = ?`, [orgId]))[0].status).toBe("pending");
    expect((await db<{ status: string }>(`SELECT status FROM events WHERE id = ?`, [paidEventId]))[0].status).toBe("in_review");

    await admin.goto(`${E2E.adminUrl}/admin/organizations?q=${encodeURIComponent(orgName)}`);
    await expect(admin.getByRole("columnheader", { name: "Stripe" })).toBeVisible();
    await expect(admin.getByRole("row", { name: new RegExp(orgName) })).toContainText("In progress");

    // Stripe verifies the organizer
    await stripeAccount("verified");
    await admin.goto(`${E2E.adminUrl}/admin/organizations/${orgSlug}`);
    await admin.getByRole("tab", { name: "Fattixx Pro" }).click(); // the "Stripe Connect payouts" section sits on this tab
    await expect(admin.getByText(/account acct_e2e_.*: Verified/)).toBeVisible();

    await admin.goto(`${E2E.adminUrl}/admin/applications`);
    await expect(card).toContainText("Stripe: Verified");
    await expect(card).not.toContainText("Approval opens once");
    await card.getByRole("button", { name: "Verify & approve" }).click();
    await expect(admin.getByText(/is verified and 1 held event is now live/)).toBeVisible();
  } finally {
    await admin.context().close();
  }
  expect((await db<{ status: string }>(`SELECT status FROM events WHERE id = ?`, [paidEventId]))[0].status).toBe("published");
  await organizer.goto(`/org/${orgSlug}/verify`);
  await expect(organizer.getByText(`${orgName} is verified.`)).toBeVisible();
});

test("guide test 12: with manual payouts there is no Stripe column", async ({ browser }) => {
  await db("UPDATE platform_settings SET `value` = 'manual' WHERE `key` = 'payout_mode'");
  const admin = await (await browser.newContext()).newPage();
  try {
    await login(admin);
    await admin.goto(`${E2E.adminUrl}/admin/organizations?q=${encodeURIComponent(orgName)}`);
    await expect(admin.getByRole("row", { name: new RegExp(orgName) })).toBeVisible();
    await expect(admin.getByRole("columnheader", { name: "Stripe" })).toHaveCount(0);
  } finally {
    await admin.context().close();
    await db("UPDATE platform_settings SET `value` = 'connect' WHERE `key` = 'payout_mode'");
  }
});
