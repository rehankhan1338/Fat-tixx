import { test, expect } from "@playwright/test";
import { latestLinkFor } from "./helpers/db";
import { login, uniq, watchConsole } from "./helpers/ui";

/**
 * The whole Phase 1 story in one ordered flow:
 * organization → venue → event → ticket types → publish → guest purchase → scanning → attendees/sales → refund → team invite.
 */
test.describe.serial("platform flow", () => {
  const id = uniq();
  const orgName = `E2E Org ${id}`;
  const orgAdminEmail = `e2e-orgadmin-${id}@fattixx.local`;
  let orgSlug = "";
  let eventId = "";
  let orderCode = "";
  let ticketCodes: string[] = [];
  let inviteLink: string | null = null;

  test("super admin creates an organization and invites its admin", async ({ page }) => {
    const c = watchConsole(page);
    await login(page);
    await page.goto("/admin/organizations?new=1");
    await page.fill("#name", orgName);
    await page.fill("#slug", `e2e-${id}`);
    await page.fill("#contact_email", `e2e-contact-${id}@fattixx.local`);
    await page.fill("#admin_name", "E2E Org Admin");
    await page.fill("#admin_email", orgAdminEmail);
    await Promise.all([page.waitForURL(/\/admin\/organizations\/e2e-/), page.click('form button:has-text("Create organization")')]);
    orgSlug = new URL(page.url()).pathname.split("/").pop()!;
    inviteLink = new URL(page.url()).searchParams.get("invite");
    expect(inviteLink).toContain("/set-password/");
    await expect(page.locator("h1")).toContainText(orgName);
    c.assertClean();
  });

  test("organizer adds a venue with tax, creates and publishes an event with ticket types", async ({ page }) => {
    const c = watchConsole(page);
    await login(page);
    await page.goto(`/org/${orgSlug}/venues`);
    await page.click('button:has-text("Add venue")');
    await page.fill("#v-name", "E2E Hall");
    await page.fill("#v-city", "Charleston");
    await page.fill("#v-region", "SC");
    await page.fill("#v-tax", "5.00");
    await page.click("[data-slot=dialog-content] button[type=submit]");
    await expect(page.locator("table")).toContainText("E2E Hall");

    await page.goto(`/org/${orgSlug}/events/new`);
    await page.fill("#title", `E2E Night ${id}`);
    await page.fill("#summary", "Automated test event");
    await page.selectOption("#venue_id", { label: "E2E Hall" });
    await page.fill("#starts_at", "2026-12-05T20:00");
    await page.fill("#doors_at", "2026-12-05T19:00");
    await page.fill("#age_restriction", "21");
    await Promise.all([page.waitForURL(/\/events\/\d+\?created=1/), page.click('button:has-text("Create event as draft")')]);
    eventId = page.url().match(/events\/(\d+)/)![1];

    // publishing without ticket types is not possible (button disabled with a hint)
    await expect(page.locator('button:has-text("Publish")')).toBeDisabled();
    await expect(page.locator('button:has-text("Publish")')).toHaveAttribute("title", /ticket type/);

    const addTicket = async (name: string, kind: string, price: string, qty: number) => {
      await page.click('button:has-text("Add ticket type") >> nth=0');
      await page.fill("#tt-name", name);
      await page.selectOption("#tt-kind", kind);
      if (kind !== "complimentary") await page.fill("#tt-price", price);
      await page.fill("#tt-qty", String(qty));
      await page.click("[data-slot=dialog-content] button[type=submit]");
      await expect(page.locator("table")).toContainText(name);
    };
    await addTicket("General Admission", "general", "25.00", 100);
    await addTicket("Free RSVP", "general", "0", 3);
    await page.click('button:has-text("Publish")');
    await expect(page.locator("body")).toContainText("Event published");
    await page.reload();
    await expect(page.locator('button:has-text("Unpublish")')).toBeVisible();
    c.assertClean();
  });

  test("guest sees all-in pricing, buys free tickets, and paid checkout explains Stripe is not configured", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    const c = watchConsole(page);
    await page.goto("/");
    await page.fill("#q", `E2E Night ${id}`); // homepage grid search
    await page.click(`#events a:has-text("E2E Night ${id}")`);
    await expect(page).toHaveURL(/\/events\//);
    await expect(page.locator("body")).toContainText("$28.49"); // 25 + 5% fee + $0.99 + 5% tax
    await expect(page.locator("body")).toContainText("21+ event");

    const free = page.locator("li", { hasText: "Free RSVP" });
    await free.locator('button[aria-label="More"]').click();
    await free.locator('button[aria-label="More"]').click();
    await page.fill("#name", "Guest Buyer");
    await page.fill("#email", `e2e-guest-${id}@fattixx.local`);
    await Promise.all([page.waitForURL(/\/checkout\/FTX-/), page.click('button:has-text("Get free tickets")')]);
    orderCode = page.url().match(/FTX-[A-Z0-9]+/)![0];
    await Promise.all([page.waitForURL(/\/orders\/FTX-/), page.click('button:has-text("Confirm free tickets")')]);
    await expect(page.locator("body")).toContainText("You’re going");
    await expect(page.locator('img[alt^="QR code for ticket"]')).toHaveCount(2);
    ticketCodes = await page.$$eval("p.font-mono.text-xs", (els) => els.map((e) => e.textContent!.trim()).filter((t) => /^[A-Z0-9]{12}$/.test(t)));
    expect(ticketCodes).toHaveLength(2);

    // attendee edits a name on their own ticket
    await page.locator('button:has-text("Edit")').first().click();
    await page.fill('input[name="attendee_name"]', "Renamed Guest");
    await page.click('button:has-text("Save")');
    await expect(page.locator("body")).toContainText("Renamed Guest");

    // only 1 Free RSVP left now (3 - 2)
    await page.goto("/");
    await page.fill("#q", `E2E Night ${id}`); // homepage grid search
    await page.click(`#events a:has-text("E2E Night ${id}")`);
    await expect(page.locator("li", { hasText: "Free RSVP" })).toContainText("Only 1 left");

    // paid path
    const ga = page.locator("li", { hasText: "General Admission" });
    await ga.locator('button[aria-label="More"]').click();
    await page.fill("#name", "Card Buyer");
    await page.fill("#email", `e2e-card-${id}@fattixx.local`);
    await Promise.all([page.waitForURL(/\/checkout\/FTX-/), page.click('button:has-text("Continue to payment")')]);
    await expect(page.locator("body")).toContainText("Card payments are not available");
    await expect(page.locator("body")).toContainText("Card processing");
    c.assertClean();
    await page.context().close();
  });

  test("scanner validates, rejects reuse and forgeries; attendees and settlement reflect it", async ({ page }) => {
    const c = watchConsole(page);
    await login(page);
    await page.goto(`/org/${orgSlug}/events/${eventId}/scan`);
    const input = page.locator('input[placeholder^="Type ticket code"]');
    await input.fill(ticketCodes[0]);
    await page.click('button:has-text("Check")');
    await expect(page.getByText("VALID", { exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText("Check ID");
    await page.waitForTimeout(4200); // debounce window for the same code
    await input.fill(ticketCodes[0]);
    await page.click('button:has-text("Check")');
    await expect(page.getByText("ALREADY USED", { exact: true })).toBeVisible();
    await input.fill("FTX1.BADCODE1234.deadbeef.xx");
    await page.click('button:has-text("Check")');
    await expect(page.getByText("INVALID", { exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText(/1\s*\/\s*2/);

    // manual check-in of the second ticket through search
    await page.fill('input[placeholder="Name, email, order or ticket code"]', ticketCodes[1]);
    await page.click('li:has-text("' + ticketCodes[1] + '") button:has-text("Check in")');
    await expect(page.getByText("CHECKED IN", { exact: true })).toBeVisible();

    // undo the manual one (super admin has undo permission)
    await page.click('button:has-text("Undo")');
    await page.fill("textarea", "test undo");
    await page.click('button:has-text("Undo check-in")');
    await expect(page.getByText("UNDONE", { exact: true })).toBeVisible();

    await page.goto(`/org/${orgSlug}/events/${eventId}?tab=attendees`);
    await expect(page.locator("body")).toContainText("Renamed Guest");
    await page.goto(`/org/${orgSlug}/events/${eventId}?tab=sales`);
    await expect(page.locator("body")).toContainText("Net payout to organizer");
    c.assertClean();
  });

  test("organizer resends tickets and the outbox records every email", async ({ page }) => {
    await login(page);
    await page.goto(`/org/${orgSlug}/orders/${orderCode}`);
    await page.click('button:has-text("Resend tickets")');
    await page.click("[data-slot=alert-dialog-action]");
    await expect(page.locator("body")).toContainText("Tickets re-sent");
    await page.goto("/admin/emails");
    await expect(page.locator("body")).toContainText("Your tickets: E2E Night");
    await expect(page.locator("body")).toContainText("Your tickets are confirmed");
  });

  test("invited org admin sets a password, lands in the org panel, and is blocked from /admin", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    const link = inviteLink ?? (await latestLinkFor(orgAdminEmail, "set-password"));
    expect(link).toBeTruthy();
    await page.goto(link!);
    await page.fill("#password", "OrgAdmin-Strong-Pass-55");
    await page.fill("#confirm", "OrgAdmin-Strong-Pass-55");
    await Promise.all([page.waitForURL(/\/org\//), page.click("main form button[type=submit]")]);
    await expect(page).toHaveURL(new RegExp(`/org/${orgSlug}`));
    await page.goto("/admin");
    await expect(page).toHaveURL(/dashboard\?denied=1/);
    await expect(page.locator("body")).toContainText("do not have access");
    await page.goto(`/org/${orgSlug}/team`);
    await expect(page.locator("body")).toContainText("E2E Org Admin");

    // add a staff member with override permission, then remove them
    await page.click('button:has-text("Add team member")');
    await page.fill("#name", "Door Staff");
    await page.fill("#email", `e2e-staff-${id}@fattixx.local`);
    await page.selectOption("#role", "staff");
    await page.check("#can_override_checkin");
    await page.click("[data-slot=dialog-content] button[type=submit]");
    await expect(page.locator("[data-slot=dialog-content]")).toContainText("Door Staff was added");
    await page.click('[data-slot=dialog-content] button:has-text("Done")');
    await expect(page.locator("table")).toContainText("Door Staff");
    await page.context().close();
  });

  test("cancelling the event refunds/voids every order and notifies buyers", async ({ page }) => {
    await login(page);
    await page.goto(`/org/${orgSlug}/events/${eventId}`);
    await page.click('button[aria-label="More actions"]');
    await page.click("text=Cancel event & refund everyone");
    await page.fill("#reason", "Automated test cancellation");
    await page.click('button:has-text("Cancel event & refund")');
    await expect(page.locator("body")).toContainText("Event cancelled");
    await page.reload();
    await expect(page.locator("body")).toContainText("This event was cancelled");
    await page.goto(`/org/${orgSlug}/orders/${orderCode}`);
    await expect(page.locator("body")).toContainText(/cancelled|refunded/i);
    await page.goto("/admin/emails");
    await expect(page.locator("body")).toContainText("Cancelled: E2E Night");
  });
});
