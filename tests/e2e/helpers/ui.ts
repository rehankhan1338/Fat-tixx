import { expect, type Page } from "@playwright/test";
import { E2E } from "./db";

export async function login(page: Page, email = E2E.adminEmail, password = E2E.adminPassword) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.click("form button[type=submit]")]);
  // Either we were redirected away from /login, or the form shows an error. (Avoid "networkidle": prefetching keeps the network busy.)
  await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }),
    page.waitForSelector("form [role=alert]", { timeout: 30_000 }),
  ]);
  await page.waitForLoadState("domcontentloaded");
}

export async function logout(page: Page) {
  await page.goto("/account");
  const btn = page.locator('form button:has-text("Sign out")');
  if (await btn.count()) { await Promise.all([page.waitForURL(/\/login/), btn.first().click()]); }
}

/** Collects console errors; call `assertClean()` at the end of a test. */
export function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  // Record failed requests with their URL (the console message alone does not say which resource 404'd).
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  return {
    errors,
    // "Router action dispatched before initialization" is emitted by the Next.js dev server when a hot reload
    // lands mid-navigation (e.g. a file saved while the test runs); it never occurs in production builds.
    assertClean: () => expect(errors.filter((e) => !/DevTools|preload|favicon|Router action dispatched before initialization/.test(e)), "console errors").toEqual([]),
  };
}

export const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
