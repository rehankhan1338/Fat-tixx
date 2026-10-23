import { expect, type Page } from "@playwright/test";
import { E2E } from "./db";

/**
 * Sign in through the website. Platform staff (the seeded Super Admin) use the admin console's sign-in page
 * (its homepage); everyone else the public /login. Pass `url` to force a page, e.g. to check that the wrong
 * portal turns an account away.
 */
export async function login(page: Page, email = E2E.adminEmail, password = E2E.adminPassword, url = email === E2E.adminEmail ? `${E2E.adminUrl}/` : "/login") {
  await page.goto(url);
  const start = new URL(page.url());
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.click("main form button[type=submit]")]);
  // Either we were redirected away from the sign-in page, or the form shows an error. (Avoid "networkidle": prefetching keeps the network busy.)
  await Promise.race([
    page.waitForURL((u) => u.origin + u.pathname !== start.origin + start.pathname, { timeout: 30_000 }),
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

/**
 * Creates a draft event from an organization's dashboard ("New event", the /create page embedded in the dashboard,
 * plan 5.6.10) and returns its id. The page starts every event with one free "General Admission" ticket; pass
 * `ticket` to rename it. `venue` picks a saved venue (Dashboard → Venues), otherwise the event is online.
 * `base` is the origin serving the dashboard (the admin console for the Super Admin).
 */
export async function createEventInDashboard(page: Page, base: string, orgSlug: string, o: {
  title: string; date: string; time: string; ticket?: string; price?: string; venue?: string; summary?: string; doors?: string; age?: "18+" | "21+";
}): Promise<string> {
  await page.goto(`${base}/org/${orgSlug}/events/new`);
  await page.locator("#c-name-input").fill(o.title);
  if (o.summary) {
    await page.getByRole("button", { name: "Short summary" }).click();
    await page.locator("#c-summary").fill(o.summary);
  }
  await page.locator("#c-category button").first().click();
  await page.locator("#c-sd").fill(o.date);
  await page.locator("#c-st").fill(o.time);
  const loc = page.locator("#c-location");
  if (o.venue) {
    await loc.getByRole("button", { name: "Saved venue" }).click();
    const value = await loc.locator("select option", { hasText: o.venue }).first().getAttribute("value");
    await loc.locator("select").selectOption(value!);
  } else {
    await loc.getByRole("button", { name: "Online" }).click();
    await loc.getByPlaceholder("https://").fill("https://meet.example.com/e2e");
  }
  if (o.ticket) await page.locator("#c-tickets").getByPlaceholder("e.g. General Admission").first().fill(o.ticket);
  if (o.price) await page.locator("#c-tickets").getByPlaceholder("0.00").first().fill(o.price);
  if (o.doors || o.age) {
    await page.locator("#c-settings").getByRole("button").first().click();
    if (o.doors) await page.locator("#c-doors").fill(o.doors);
    if (o.age) await page.locator("#c-settings").getByRole("button", { name: o.age }).click();
  }
  await page.getByRole("button", { name: "Save as draft" }).first().click();
  await expect(page.getByRole("heading", { name: "Your event is saved." })).toBeVisible();
  await Promise.all([page.waitForURL(/\/events\/\d+/), page.getByRole("link", { name: "Go to dashboard" }).click()]);
  return page.url().match(/events\/(\d+)/)![1];
}

/** Opens the event page's ticket pop-up (the fixed ticket button). */
export async function openTickets(page: Page) {
  const heading = page.locator("#tickets-h");
  // retried until the page has hydrated; the fixed button hides over the footer, so #tickets in the address is the fallback
  await expect(async () => {
    if (await heading.isVisible()) return;
    const pill = page.locator("button[aria-haspopup=dialog]").first();
    if (await pill.isVisible()) await pill.click({ timeout: 2_000 });
    else await page.evaluate(() => { window.location.hash = ""; window.location.hash = "tickets"; });
    await expect(heading).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/** The pop-up's main button: "Checkout", "Get free tickets", or "Register" when every ticket is free. */
export function ticketsSubmit(page: Page) {
  return page.locator("#tickets").getByRole("button", { name: /^(Checkout|Get free tickets|Register)$/ }).last();
}

/** Adds `times` of a ticket type or add-on in the ticket pop-up: "Buy / Get / Register / Add <name>", then "Add one <name> ticket". */
export async function pick(page: Page, name: string, times = 1) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let i = 0; i < times; i++) {
    await page.locator("#tickets").getByRole("button", { name: new RegExp(`^(Buy|Get|Register|Add|Add one) ${esc}( ticket)?$`) }).first().click();
  }
}
