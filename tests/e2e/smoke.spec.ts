import { test, expect } from "@playwright/test";
import { login, watchConsole } from "./helpers/ui";

const ADMIN_PAGES = ["/admin", "/admin/ads", "/admin/ads/new", "/admin/applications", "/admin/organizations", "/admin/events", "/admin/orders", "/admin/users", "/admin/settings", "/admin/settings?tab=branding", "/admin/emails", "/admin/emails/templates", "/admin/payments", "/admin/payments?tab=stripe", "/admin/payouts", "/admin/disputes", "/admin/monitoring", "/admin/audit", "/admin/security", "/dashboard", "/account"];
const PUBLIC_PAGES = ["/", "/login", "/register", "/forgot-password", "/tickets/find", "/set-password/not-a-real-token", "/terms", "/privacy", "/refunds", "/ticketing-terms", "/organizer-agreement", "/sell"];

test.describe("smoke", () => {
  test("public pages render without console errors", async ({ page }) => {
    const c = watchConsole(page);
    for (const p of PUBLIC_PAGES) {
      const res = await page.goto(p, { waitUntil: "load" });
      expect(res!.status(), p).toBe(200);
    }
    c.assertClean();
  });

  test("admin pages render without console errors", async ({ page }) => {
    const c = watchConsole(page);
    await login(page);
    for (const p of ADMIN_PAGES) {
      const res = await page.goto(p, { waitUntil: "load" });
      expect(res!.status(), p).toBe(200);
    }
    c.assertClean();
  });

  test("unknown routes return 404 pages, not crashes", async ({ page }) => {
    await login(page);
    for (const p of ["/events/does-not-exist", "/orders/FTX-NOPE", "/t/AAAAAAAAAAAA?k=000000000000", "/org/no-such-org", "/admin/organizations/no-such-org"]) {
      const res = await page.goto(p);
      expect([404, 200].includes(res!.status()), p).toBe(true);
      await expect(page.locator("body")).not.toContainText(/Unhandled|Application error/);
    }
  });
});
