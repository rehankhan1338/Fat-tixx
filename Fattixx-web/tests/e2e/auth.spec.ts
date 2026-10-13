import { test, expect } from "@playwright/test";
import { ADMIN_LOGIN_RE, E2E, latestLinkFor } from "./helpers/db";
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
    // The console has its own cookie; the public site's cookie is never set by a console sign-in.
    const cookie = (await context.cookies()).find((k) => k.name === "fx_admin" || k.name === "__Host-fx_admin");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");
    expect((await context.cookies()).find((k) => k.name === "fx_session" || k.name === "__Host-fx_session")).toBeUndefined();
    // Signed in to the console, the public site still shows a signed-out visitor (no "Admin" account link).
    await page.goto("/");
    await expect(page.locator("header")).not.toContainText("Admin");
    await page.goto("/account");
    await expect(page).toHaveURL(/\/login/);
    await page.click("header [data-slot=dropdown-menu-trigger]");
    await expect(page.locator("[data-slot=dropdown-menu-content]")).toContainText(E2E.adminEmail);
    await Promise.all([page.waitForURL(ADMIN_LOGIN_RE), page.click("[data-slot=dropdown-menu-content] >> text=Sign out")]);
    await page.goto("/admin");
    await expect(page).toHaveURL(ADMIN_LOGIN_RE);
    c.assertClean();
  });

  test("super admin cannot sign in from the public /login page", async ({ page, context }) => {
    await login(page, E2E.adminEmail, E2E.adminPassword, "/login");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("form [role=alert]")).toHaveText(/^\s*Something went wrong\s*$/);
    expect((await context.cookies()).filter((k) => /fx_session|fx_admin/.test(k.name))).toEqual([]);
    // Signed out, every admin link on the public site ends on the console's sign-in page, not the public one.
    await page.goto("/admin/users");
    await expect(page).toHaveURL(ADMIN_LOGIN_RE);
    const res = await page.goto("/admin/login");
    expect(res!.status()).toBe(200);
    await expect(page).toHaveURL(ADMIN_LOGIN_RE);
    await expect(page.locator("body")).not.toContainText("Create an account");
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
    await Promise.all([page.waitForURL(/\/account/), page.click("main form button[type=submit]")]);
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
    // The public site's cookie means nothing to the console: an attendee following /admin meets the console sign-in.
    await page.goto("/admin");
    await expect(page).toHaveURL(ADMIN_LOGIN_RE);

    // forgot password → link in outbox → new password → signed in
    await page.goto("/account");
    await Promise.all([page.waitForURL(/\/login/), page.click('form button:has-text("Sign out")')]);
    await page.goto("/forgot-password");
    await page.fill("#email", email);
    await page.click("main form button[type=submit]");
    await expect(page.locator("body")).toContainText("a password link has been sent");
    const link = await latestLinkFor(email, "set-password");
    expect(link).toBeTruthy();
    await page.goto(link!);
    await page.fill("#password", "Another-Strong-Pass-88");
    await page.fill("#confirm", "Another-Strong-Pass-88");
    await Promise.all([page.waitForURL(/\/account/), page.click("main form button[type=submit]")]);
    await page.goto(link!);
    await expect(page.locator("body")).toContainText("invalid or has expired");

    // The staff sign-in page turns a non-staff account away even with the right password.
    await page.goto("/account");
    await Promise.all([page.waitForURL(/\/login$/), page.click('form button:has-text("Sign out")')]);
    await login(page, email, "Another-Strong-Pass-88", `${E2E.adminUrl}/`);
    await expect(page).toHaveURL(ADMIN_LOGIN_RE);
    await expect(page.locator("form [role=alert]")).toContainText("platform staff");
  });
});
