import { test, expect } from "@playwright/test";
import { login, uniq } from "./helpers/ui";

/** Super Admin can edit and delete everything: tickets, orders, events, users, organizations. */
test.describe.serial("super admin edit & delete", () => {
  const id = uniq();
  const slug = `e2e-crud-${id}`;
  let eventId = "";
  let orderCode = "";

  test("set up: org, event, free order", async ({ page, browser }) => {
    await login(page);
    await page.goto("/admin/organizations?new=1");
    await page.fill("#name", `E2E CRUD ${id}`);
    await page.fill("#slug", slug);
    await page.fill("#contact_email", `e2e-crud-${id}@fattixx.local`);
    await Promise.all([page.waitForURL(new RegExp(`/admin/organizations/${slug}`)), page.click('form button:has-text("Create organization")')]);

    await page.goto(`/org/${slug}/events/new`);
    await page.fill("#title", `CRUD Night ${id}`);
    await page.fill("#starts_at", "2026-12-12T20:00");
    await Promise.all([page.waitForURL(/\/events\/\d+\?created=1/), page.click('button:has-text("Create event as draft")')]);
    eventId = page.url().match(/events\/(\d+)/)![1];
    await page.click('button:has-text("Add ticket type") >> nth=0');
    await page.fill("#tt-name", "Free");
    await page.fill("#tt-price", "0");
    await page.fill("#tt-qty", "10");
    await page.click("[data-slot=dialog-content] button[type=submit]");
    await expect(page.locator("table")).toContainText("Free");
    await page.click('button:has-text("Publish")');
    await expect(page.locator("body")).toContainText("Event published");

    const guest = await (await browser.newContext()).newPage();
    await guest.goto("/");
    await guest.fill("#q", `CRUD Night ${id}`);
    await guest.click(`#events a:has-text("CRUD Night ${id}")`);
    const free = guest.locator("li", { hasText: "Free" });
    await free.locator('button[aria-label="More"]').click();
    await free.locator('button[aria-label="More"]').click();
    await guest.fill("#name", "CRUD Guest");
    await guest.fill("#email", `e2e-crudguest-${id}@fattixx.local`);
    await Promise.all([guest.waitForURL(/\/checkout\/FTX-/), guest.click('button:has-text("Get free tickets")')]);
    orderCode = guest.url().match(/FTX-[A-Z0-9]+/)![0];
    await Promise.all([guest.waitForURL(/\/orders\/FTX-/), guest.click('button:has-text("Confirm free tickets")')]);
    await guest.context().close();
  });

  test("void one ticket, then cancel the order", async ({ page }) => {
    await login(page);
    await page.goto(`/org/${slug}/orders/${orderCode}`);
    await page.locator('button:has-text("Void")').first().click();
    await page.click("[data-slot=alert-dialog-action]");
    await expect(page.locator("body")).toContainText("Ticket voided");
    await expect(page.locator("table").last()).toContainText("cancelled");

    await page.click('button[aria-label="More order actions"]');
    await page.click("text=Cancel order (void tickets, no refund)");
    await page.fill("#cancel-reason", "Test cancellation");
    await page.click('[data-slot=dialog-content] button:has-text("Cancel order & void tickets")');
    await expect(page.locator("body")).toContainText("Order cancelled and tickets voided");
    await page.reload();
    await expect(page.locator("h1")).toContainText(/cancelled/i);
    // inventory came back: 10 available
    await page.goto(`/org/${slug}/events/${eventId}`);
    await expect(page.locator("table")).toContainText("10 / 10");
  });

  test("delete the order permanently", async ({ page }) => {
    await login(page);
    await page.goto(`/org/${slug}/orders/${orderCode}`);
    await page.click('button[aria-label="More order actions"]');
    await page.click("text=Delete order permanently");
    await Promise.all([page.waitForURL(/\/orders\?deleted=/), page.click('[data-slot=dialog-content] button:has-text("Delete permanently")')]);
    await page.goto(`/org/${slug}/orders/${orderCode}`);
    await expect(page.locator("body")).toContainText(/not found|404/i);
  });

  test("force-delete the event from the platform events list", async ({ page }) => {
    await login(page);
    await page.goto("/admin/events");
    const row = page.locator("tr", { hasText: `CRUD Night ${id}` });
    await expect(row).toBeVisible();
    await row.locator('button:has-text("Delete")').click();
    await page.click("[data-slot=alert-dialog-action]");
    await expect(page.locator("tr", { hasText: `CRUD Night ${id}` })).toHaveCount(0);
  });

  test("edit a user, then delete them", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/users?q=e2e-crudguest-${id}`);
    const row = page.locator("tr", { hasText: `e2e-crudguest-${id}` });
    await expect(row).toHaveCount(0); // guests without accounts are not users
    // create an account to edit
    await page.goto("/admin/users");
    await page.click('button:has-text("Add platform staff")');
    await page.fill("#pu-name", "Temp Person");
    await page.fill("#pu-email", `e2e-temp-${id}@fattixx.local`);
    await page.selectOption("#pu-role", "support");
    await page.click("[data-slot=dialog-content] button[type=submit]");
    await page.click('[data-slot=dialog-content] button:has-text("Done")');
    await page.goto(`/admin/users?q=e2e-temp-${id}`);
    const temp = page.locator("tr", { hasText: `e2e-temp-${id}` });
    await temp.locator('button[aria-label="Actions"]').click();
    await page.click("text=Edit name & email");
    await page.fill('[data-slot=dialog-content] input[name="name"]', "Renamed Person");
    await page.click("[data-slot=dialog-content] button[type=submit]");
    await expect(page.locator("body")).toContainText("User updated");
    await expect(page.locator("tr", { hasText: `e2e-temp-${id}` })).toContainText("Renamed Person");
    page.once("dialog", (d) => d.accept());
    await temp.locator('button[aria-label="Actions"]').click();
    await page.click("text=Delete user");
    await expect(page.locator("body")).toContainText("User deleted");
    await expect(page.locator("tr", { hasText: `e2e-temp-${id}` })).toHaveCount(0);
  });

  test("delete the organization", async ({ page }) => {
    await login(page);
    await page.goto(`/admin/organizations/${slug}`);
    await page.click('[data-slot=tabs-trigger]:has-text("Fees & status"), button:has-text("Fees & status")');
    await page.click('button:has-text("Delete organization")');
    await Promise.all([page.waitForURL(/\/admin\/organizations\?deleted=1/), page.click("[data-slot=alert-dialog-action]")]);
    await expect(page.locator("body")).not.toContainText(`E2E CRUD ${id}`);
  });
});
