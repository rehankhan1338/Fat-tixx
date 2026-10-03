import { test, expect } from "@playwright/test";
import { E2E, latestLinkFor } from "./helpers/db";
import { login, uniq, watchConsole } from "./helpers/ui";

test.describe("authentication", () => {
  test("login page has security headers and no 2FA wording", async ({ page }) => {
    const res = await page.goto("/login");
    expect(res!.status()).toBe(200);
    const h = res!.headers();
    expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-powered-by"]).toBeUndefined();
    await expect(page.locator("body")).not.toContainText(/authenticator|two-factor/i);
  });

  test("wrong password and unknown email give the same generic error", async ({ page }) => {
    await login(page, E2E.adminEmail, "definitely-wrong-password");
    await expect(page.locator("form [role=alert]")).toContainText("Incorrect email or password");
    await login(page, `nobody-${uniq()}@nowhere.invalid`, "whatever-password-123");
    await expect(page.locator("form [role=alert]")).toContainText("Incorrect email or password");
  });

  test("super admin lands on /admin; session cookie is HttpOnly + Strict; sign-out works", async ({ page, context }) => {
    const c = watchConsole(page);
    await login(page);
    await expect(page).toHaveURL(/\/admin$/);
    const cookie = (await context.cookies()).find((k) => k.name === "fx_session" || k.name === "__Host-fx_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");
    await page.click("[data-slot=sidebar-footer] [data-slot=dropdown-menu-trigger]");
    await expect(page.locator("[data-slot=dropdown-menu-content]")).toContainText(E2E.adminEmail);
    await Promise.all([page.waitForURL(/\/login$/), page.click("[data-slot=dropdown-menu-content] >> text=Sign out")]);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    c.assertClean();
  });

  test("cross-origin POST is rejected", async ({ request }) => {
    const res = await request.post("/login", { headers: { origin: "https://evil.example", "content-type": "text/plain" }, data: "x" });
    expect(res.status()).toBe(403);
  });

  test("attendee can register, sees account page, and password reset link works", async ({ page }) => {
    const email = `e2e-attendee-${uniq()}@fattixx.local`;
    await page.goto("/register");
    await page.fill("#name", "E2E Attendee");
    await page.fill("#email", email);
    await page.fill("#password", "Attendee-Strong-Pass-77");
    await page.waitForTimeout(900); // the bot check rejects forms submitted faster than a person can type
    await Promise.all([page.waitForURL(/\/account/), page.click("form button[type=submit]")]);
    await expect(page.locator("h1")).toContainText("Hi, E2E Attendee");
    // Email verification: until confirmed, guest orders with this email are not attached to the account.
    await expect(page.locator("body")).toContainText("Check your inbox to confirm your email");
    const verify = await latestLinkFor(email, "verify-email");
    expect(verify).toBeTruthy();
    await page.goto(verify!);
    await page.click('button:has-text("Confirm email")');
    await expect(page.locator("body")).toContainText("Email confirmed");
    await page.goto("/account");
    await expect(page.locator("body")).not.toContainText("Confirm your email address");
    await page.goto("/admin");
    await expect(page).toHaveURL(/dashboard\?denied=1|\/login/);

    // forgot password → link in outbox → new password → signed in
    await page.goto("/account");
    await Promise.all([page.waitForURL(/\/login/), page.click('form button:has-text("Sign out")')]);
    await page.goto("/forgot-password");
    await page.fill("#email", email);
    await page.click("form button[type=submit]");
    await expect(page.locator("body")).toContainText("a password link has been sent");
    const link = await latestLinkFor(email, "set-password");
    expect(link).toBeTruthy();
    await page.goto(link!);
    await page.fill("#password", "Another-Strong-Pass-88");
    await page.fill("#confirm", "Another-Strong-Pass-88");
    await Promise.all([page.waitForURL(/\/account/), page.click("form button[type=submit]")]);
    await page.goto(link!);
    await expect(page.locator("body")).toContainText("invalid or has expired");
  });
});
