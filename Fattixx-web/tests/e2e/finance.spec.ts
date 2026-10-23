import { test, expect } from "@playwright/test";
import { E2E } from "./helpers/db";
import { createEventInDashboard, login, uniq, watchConsole } from "./helpers/ui";

/** Payouts, disputes, payments & Stripe settings, monitoring, branding and email templates. */
test.describe.serial("finance, monitoring, branding & templates", () => {
  const id = uniq();

  test("payouts: approve a settlement, record the payout, void an approval", async ({ page }) => {
    const c = watchConsole(page);
    await login(page);
    // Create an org with a paid-looking (free) order so the event has settlement rows; free events have gross 0,
    // so use a box-office order which records revenue without Stripe.
    await page.goto(`${E2E.adminUrl}/admin/organizations?new=1`);
    await page.fill("#name", `E2E Fin ${id}`); await page.fill("#slug", `e2e-fin-${id}`); await page.fill("#contact_email", `e2e-fin-${id}@fattixx.local`);
    await Promise.all([page.waitForURL(/\/admin\/organizations\/e2e-fin-/), page.click('form button:has-text("Create organization")')]);
    const eventId = await createEventInDashboard(page, E2E.adminUrl, `e2e-fin-${id}`, { title: `Fin Night ${id}`, date: `${new Date().getFullYear() + 1}-12-20`, time: "20:00", ticket: "GA", price: "40" });
    await expect(page.locator("table")).toContainText("GA");
    await page.click('button:has-text("Publish")');
    await expect(page.locator("body")).toContainText("Event published");
    // Box-office sale (paid at the door) records revenue.
    await page.goto(`${E2E.adminUrl}/org/e2e-fin-${id}/events/${eventId}?tab=attendees`);
    await page.click('button:has-text("Issue tickets")');
    await page.selectOption("#is-source", "box_office");
    await page.fill("#is-name", "Door Buyer"); await page.fill("#is-email", `e2e-door-${id}@fattixx.local`);
    await page.fill("#is-qty", "2");
    await page.click("[data-slot=dialog-content] button[type=submit]");
    await expect(page.locator("body")).toContainText("ticket(s) issued");

    await page.goto(`${E2E.adminUrl}/admin/payouts`);
    const row = page.locator("tr", { hasText: `Fin Night ${id}` });
    await expect(row).toContainText("$80.00"); // 2 × $40 net revenue, buyer-pays mode → absorbed 0, due 80
    await row.locator('button:has-text("Approve settlement")').click();
    await page.fill("#amount", "70.00");
    await page.click('[data-slot=dialog-content] button:has-text("Approve")');
    await expect(page.locator("body")).toContainText("Settlement approved");
    await expect(page.locator("tr", { hasText: `Fin Night ${id}` }).first()).toContainText("$10.00"); // remaining due
    const hist = page.locator("tr", { hasText: "$70.00" }).last();
    await hist.locator('button:has-text("Record payout")').click();
    await page.fill("#reference", "ACH-12345");
    await page.click('[data-slot=dialog-content] button:has-text("Mark as paid")');
    await expect(page.locator("body")).toContainText("Payout recorded");
    await expect(page.locator("body")).toContainText("ACH-12345");
    // approve the remaining 10 then void it
    await page.locator("tr", { hasText: `Fin Night ${id}` }).first().locator('button:has-text("Approve settlement")').click();
    await page.click('[data-slot=dialog-content] button:has-text("Approve")');
    await expect(page.locator("body")).toContainText("Settlement approved");
    await page.locator("tr", { hasText: "$10.00" }).last().locator('button:has-text("Void")').click();
    await page.click("[data-slot=alert-dialog-action]");
    await expect(page.locator("body")).toContainText("Approval voided");
    c.assertClean();
  });

  test("disputes, payments and monitoring pages render; Stripe key validation works", async ({ page }) => {
    const c = watchConsole(page);
    await login(page);
    for (const p of ["/admin/disputes", "/admin/payments", "/admin/payments?tab=reconcile", "/admin/payments?tab=stripe", "/admin/monitoring"]) {
      const res = await page.goto(p, { waitUntil: "load" });
      expect(res!.status(), p).toBe(200);
    }
    await page.goto(`${E2E.adminUrl}/admin/payments?tab=stripe`);
    await expect(page.locator("body")).toContainText("TEST — sandbox");
    await expect(page.locator("body")).toContainText("/api/stripe/webhook");
    // wrong prefix is rejected before any network call
    await page.fill("#test-secret", "sk_live_notallowedhere");
    await page.click('button:has-text("Save test keys")');
    await expect(page.locator("body")).toContainText("must start with sk_test_");
    // a fake test key is rejected by Stripe itself
    await page.fill("#test-secret", "sk_test_" + "0".repeat(24));
    await page.fill("#test-pk", "pk_test_" + "0".repeat(24));
    await page.click('button:has-text("Save test keys")');
    await expect(page.locator("body")).toContainText(/Stripe rejected|Invalid API Key/i, { timeout: 30000 });
    // switching to live without keys is refused
    page.once("dialog", (d) => d.accept());
    await page.click('button:has-text("Use live keys")');
    await expect(page.locator("body")).toContainText("Add the live secret and publishable keys before switching");
    c.assertClean();
  });

  test("branding: change name and colour, see it on the public site", async ({ page }) => {
    await login(page);
    await page.goto(`${E2E.adminUrl}/admin/settings?tab=branding`);
    await page.fill("#platform_name", `Fattixx ${id}`);
    await page.fill("#brand_color", "#1e3a8a");
    await page.click('button:has-text("Save branding")');
    await expect(page.locator("body")).toContainText("Branding saved");
    // The homepage carries the FATTIXX design wordmark; other public pages use the configurable branding.
    await page.goto("/terms");
    await expect(page).toHaveTitle(new RegExp(`Fattixx ${id}`)); // the header keeps the Fattixx wordmark (design); the name is in the title
    const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
    expect(primary).toBe("#1e3a8a");
    // restore
    await page.goto(`${E2E.adminUrl}/admin/settings?tab=branding`);
    await page.fill("#platform_name", "Fattixx");
    await page.fill("#brand_color", "#f59e0b");
    await page.click('button:has-text("Save branding")');
    await expect(page.locator("body")).toContainText("Branding saved");
  });

  test("email templates: edit, preview, send, reset", async ({ page }) => {
    await login(page);
    await page.goto(`${E2E.adminUrl}/admin/emails/templates`);
    await page.click('button:has-text("Team invitation")');
    await page.fill("#tpl-subject", `Welcome aboard ${id}: {{context}}`);
    await page.click('button:has-text("Save template")');
    await expect(page.locator("body")).toContainText("Template saved");
    await expect(page.frameLocator('iframe[title="Email preview"]').locator("h1")).toContainText(`Welcome aboard ${id}`);
    // the live email uses the edited subject
    await page.goto(`${E2E.adminUrl}/admin/users`);
    await page.click('button:has-text("Add platform staff")');
    await page.fill("#pu-name", "Tpl Person"); await page.fill("#pu-email", `e2e-tpl-${id}@fattixx.local`);
    await page.click("[data-slot=dialog-content] button[type=submit]");
    await page.click('[data-slot=dialog-content] button:has-text("Done")');
    await page.goto(`${E2E.adminUrl}/admin/emails`);
    await expect(page.locator("body")).toContainText(`Welcome aboard ${id}: the Fattixx platform team`);
    // reset
    await page.goto(`${E2E.adminUrl}/admin/emails/templates`);
    await page.click('button:has-text("Team invitation")');
    await page.click('button:has-text("Reset to default")');
    await page.click("[data-slot=alert-dialog-action]");
    await expect(page.locator("body")).toContainText("Reset to default");
  });
});
