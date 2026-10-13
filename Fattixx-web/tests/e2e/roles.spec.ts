import { test, expect } from "@playwright/test";
import { ADMIN_LOGIN_RE, E2E } from "./helpers/db";
import { login, uniq, watchConsole } from "./helpers/ui";

/** Least-privilege platform roles from the plan: Support and Finance see only what their job needs. */
test.describe("platform staff roles", () => {
  test("support user: orders, users and emails only; finance-only pages are denied", async ({ page, browser }) => {
    const id = uniq();
    const email = `e2e-support-${id}@fattixx.local`;
    await login(page);
    await page.goto("/admin/users");
    await page.click('button:has-text("Add platform staff")');
    await page.fill("#pu-name", "Support Person");
    await page.fill("#pu-email", email);
    await page.selectOption("#pu-role", "support");
    await page.click("[data-slot=dialog-content] button[type=submit]");
    const link = await page.locator("[data-slot=dialog-content] code").textContent();
    expect(link).toContain("/set-password/");

    const staff = await (await browser.newContext()).newPage();
    const c = watchConsole(staff);
    await staff.goto(link!.trim());
    await staff.fill("#password", "Support-Strong-Pass-44");
    await staff.fill("#confirm", "Support-Strong-Pass-44");
    // Setting the password never signs staff in on the public site: they continue at the console's sign-in page.
    await Promise.all([staff.waitForURL(ADMIN_LOGIN_RE), staff.click("main form button[type=submit]")]);
    await expect(staff.locator("body")).toContainText("Your password is set");
    await login(staff, email, "Support-Strong-Pass-44", `${E2E.adminUrl}/`);
    await expect(staff).toHaveURL(/\/admin$/);
    const nav = staff.locator("nav[aria-label=Panel]");
    await expect(nav).toContainText("Orders & Tickets");
    await expect(nav).toContainText("Users");
    await expect(nav).toContainText("Emails");
    await expect(nav).not.toContainText("Organizations");
    await expect(nav).not.toContainText("Fees & Settings");
    await expect(nav).not.toContainText("Audit Log");
    await expect(staff.locator("header")).toContainText("Support");

    for (const p of ["/admin/orders", "/admin/users", "/admin/emails", "/admin/security"]) {
      const res = await staff.goto(p);
      expect(res!.status(), p).toBe(200);
      await expect(staff).toHaveURL(new RegExp(p.replace(/\//g, "\\/") + "$"));
    }
    for (const p of ["/admin/settings", "/admin/organizations", "/admin/audit", "/admin/events"]) {
      await staff.goto(p);
      await expect(staff, p).toHaveURL(/\/admin\?denied=1$/);
    }
    // No "Add platform staff" button and no role-management actions for support
    await staff.goto("/admin/users");
    await expect(staff.locator('button:has-text("Add platform staff")')).toHaveCount(0);
    c.assertClean();
    await staff.context().close();
  });

  test("finance user: organizations, events, orders and read-only settings", async ({ page, browser }) => {
    const id = uniq();
    const email = `e2e-finance-${id}@fattixx.local`;
    await login(page);
    await page.goto("/admin/users");
    await page.click('button:has-text("Add platform staff")');
    await page.fill("#pu-name", "Finance Person");
    await page.fill("#pu-email", email);
    await page.selectOption("#pu-role", "finance");
    await page.click("[data-slot=dialog-content] button[type=submit]");
    const link = await page.locator("[data-slot=dialog-content] code").textContent();

    const fin = await (await browser.newContext()).newPage();
    await fin.goto(link!.trim());
    await fin.fill("#password", "Finance-Strong-Pass-44");
    await fin.fill("#confirm", "Finance-Strong-Pass-44");
    await Promise.all([fin.waitForURL(ADMIN_LOGIN_RE), fin.click("main form button[type=submit]")]);
    await login(fin, email, "Finance-Strong-Pass-44", `${E2E.adminUrl}/`);
    await expect(fin).toHaveURL(/\/admin$/);
    const nav = fin.locator("nav[aria-label=Panel]");
    await expect(nav).toContainText("Organizations");
    await expect(nav).toContainText("Fees & Settings");
    await expect(nav).not.toContainText("Users");
    await expect(nav).not.toContainText("Emails");
    await fin.goto("/admin/settings");
    await expect(fin.locator("body")).toContainText("Only a Super Admin can change these settings");
    await expect(fin.locator("main form button[type=submit]")).toHaveCount(0);
    await fin.goto("/admin/users");
    await expect(fin).toHaveURL(/\/admin\?denied=1$/);
    await fin.context().close();
  });
});
