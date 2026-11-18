import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E, latestLinkFor, testDb } from "./helpers/db";
import { login, openTickets, pick, uniq, watchConsole } from "./helpers/ui";

/**
 * Social & Community (plan section 11) end to end in the browser, following the acceptance checklist (11.15):
 * profiles and privacy, Who's Going, following organizers and attendees, blocking, the event feed with moderation and
 * reports, sharing, referral rewards (public and invite-only), the organizer's Social tab, Audience and settings,
 * "For you", the admin console's Reports and Referral payouts, and account deletion.
 *
 * Attendees are signed in by seeding a session (their cookie) so the tests don't depend on the sign-in UI, which
 * auth.spec.ts covers. Every row is tagged e2e-… and removed by global setup.
 */
// several signed-in people per test on a dev server that compiles pages on first visit
test.describe.configure({ mode: "serial", timeout: 240_000 });

const id = uniq();
const orgSlug = `e2e-soc-${id}`;
const eventSlug = `e2e-soc-ev-${id}`;
const privateSlug = `e2e-soc-priv-${id}`;
const PRIVATE_KEY = randomBytes(8).toString("hex");
let orgId = 0, eventId = 0, gaId = 0;
type Person = { id: number; email: string; name: string; username: string | null; token: string; orderCode?: string; orderToken?: string };
const P: Record<string, Person> = {};

const q = async <T = import("mysql2").RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> => {
  const conn = await testDb();
  try { const [rows] = await conn.query(sql, params); return rows as T[]; } finally { await conn.end(); }
};

const ins = async (sql: string, params: unknown[] = []): Promise<number> => {
  const conn = await testDb();
  try { const [r] = await conn.query<import("mysql2").ResultSetHeader>(sql, params); return r.insertId; } finally { await conn.end(); }
};

async function seedPerson(key: string, o: { profile?: boolean; guestList?: boolean; ticket?: boolean; orgAdmin?: boolean } = {}) {
  const email = `e2e-soc-${key}-${id}@fattixx.local`;
  const name = `${key[0].toUpperCase()}${key.slice(1)} Tester`;
  const username = o.profile === false ? null : `${key}_${id}`.slice(0, 30);
  const conn = await testDb();
  try {
    const [u] = await conn.query<import("mysql2").ResultSetHeader>(
      `INSERT INTO users (public_id, email, email_normalized, name, email_verified_at, username, age_confirmed_at, show_on_guest_lists, show_events_on_profile, profile_public, city)
       VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, 1, 1, 'Charleston, SC')`,
      [randomUUID(), email, email, name, username, username ? new Date() : null, o.guestList === false ? 0 : 1],
    );
    const token = randomBytes(32).toString("base64url");
    await conn.query(`INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, NOW() + INTERVAL 12 HOUR, '127.0.0.1', 'e2e')`, [createHash("sha256").update(token).digest("hex"), u.insertId]);
    const p: Person = { id: u.insertId, email, name, username, token };
    if (o.orgAdmin) await conn.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'org_admin')`, [orgId, u.insertId]);
    if (o.ticket) {
      const code = `FTX-${randomBytes(4).toString("hex").toUpperCase()}`.slice(0, 10);
      const orderToken = randomBytes(24).toString("base64url");
      const [ord] = await conn.query<import("mysql2").ResultSetHeader>(
        `INSERT INTO orders (code, access_token_hash, organization_id, event_id, user_id, buyer_email, buyer_name, status, currency, subtotal_cents, total_cents, fee_mode, paid_at, marketing_opt_in)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', 'USD', 2000, 2000, 'organizer_absorbs', NOW(), ?)`,
        [code, createHash("sha256").update(orderToken).digest("hex"), orgId, eventId, u.insertId, email, name, key === "ann" ? 1 : 0],
      );
      const [item] = await conn.query<import("mysql2").ResultSetHeader>(`INSERT INTO order_items (order_id, ticket_type_id, ticket_type_name, quantity, unit_price_cents) VALUES (?, ?, 'General Admission', 1, 2000)`, [ord.insertId, gaId]);
      await conn.query(
        `INSERT INTO tickets (code, secret, order_id, order_item_id, event_id, ticket_type_id, attendee_name, attendee_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomBytes(6).toString("hex").toUpperCase(), randomBytes(16).toString("hex"), ord.insertId, item.insertId, eventId, gaId, name, email],
      );
      await conn.query(`UPDATE ticket_types SET sold = sold + 1 WHERE id = ?`, [gaId]);
      p.orderCode = code; p.orderToken = orderToken;
    }
    P[key] = p;
  } finally {
    await conn.end();
  }
}

/** A browser context signed in as `key` (public site cookie). */
async function as(browser: Browser, key: string, opts: { mobile?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(opts.mobile ? { viewport: { width: 390, height: 844 } } : {});
  const base = test.info().project.use.baseURL!;
  await ctx.addCookies([{ name: "fx_session", value: P[key].token, url: base }]);
  // keep the seeded session from idling out across a long serial run
  await q(`UPDATE sessions SET last_seen_at = NOW() WHERE user_id = ?`, [P[key].id]);
  return { ctx, page: await ctx.newPage() };
}

async function anon(browser: Browser) {
  const ctx = await browser.newContext();
  return { ctx, page: await ctx.newPage() };
}

test.beforeAll(async () => {
  const conn = await testDb();
  try {
    const [org] = await conn.query<import("mysql2").ResultSetHeader>(`INSERT INTO organizations (slug, name, contact_email, verified_at) VALUES (?, ?, ?, NOW())`, [orgSlug, `E2E Social ${id}`, `e2e-soc-org-${id}@fattixx.local`]);
    orgId = org.insertId;
    const [venue] = await conn.query<import("mysql2").ResultSetHeader>(`INSERT INTO venues (organization_id, name, city, region) VALUES (?, 'E2E Hall', 'Charleston', 'SC')`, [orgId]);
    const [ev] = await conn.query<import("mysql2").ResultSetHeader>(
      `INSERT INTO events (organization_id, venue_id, slug, title, starts_at, timezone, status, visibility, fee_mode, guest_list_mode, feed_enabled, category, followers_notified_at)
       VALUES (?, ?, ?, ?, NOW() + INTERVAL 20 DAY, 'America/New_York', 'published', 'public', 'organizer_absorbs', 'faces_total', 1, 'Music', NOW())`,
      [orgId, venue.insertId, eventSlug, `E2E Social Night ${id}`],
    );
    eventId = ev.insertId;
    const [ga] = await conn.query<import("mysql2").ResultSetHeader>(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'General Admission', 2000, 100)`, [eventId]);
    gaId = ga.insertId;
    const [priv] = await conn.query<import("mysql2").ResultSetHeader>(
      `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, private_key, fee_mode, guest_list_mode, followers_notified_at)
       VALUES (?, ?, 'E2E Private', NOW() + INTERVAL 20 DAY, 'America/New_York', 'published', 'private', ?, 'buyer_pays', 'faces', NOW())`,
      [orgId, privateSlug, PRIVATE_KEY],
    );
    await conn.query(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'GA', 0, 10)`, [priv.insertId]);
  } finally {
    await conn.end();
  }
  await seedPerson("ann", { ticket: true });           // ticket holder, on the guest list, opted in to organizer email
  await seedPerson("bob", { ticket: true });           // ticket holder
  await seedPerson("cara", { ticket: true, guestList: false }); // ticket holder, off the guest list
  await seedPerson("dev", { ticket: false });          // has a profile, no ticket
  await seedPerson("newbie", { ticket: true, profile: false }); // ticket holder without a profile
  await seedPerson("promo", { ticket: true, guestList: false }); // will be a referrer
  await seedPerson("boss", { profile: false, orgAdmin: true });  // Organization Admin
  await seedPerson("leaver", { ticket: true });
});

// ---------------------------------------------------------------------------
test("signed out: Who's Going shows holders who allow it, the feed is for ticket holders, Follow asks to sign in", async ({ browser }) => {
  const { page } = await anon(browser);
  const con = watchConsole(page);
  await page.goto(`/events/${eventSlug}`);
  const going = page.locator("section[aria-labelledby=going-h]");
  await expect(going).toContainText("are going");
  // faces and total: 6 tickets out, 2 names shown
  await expect(going).toContainText(/and 4 others are going/);
  await expect(page.locator("#feed")).toContainText("Ticket holders can see the event feed");
  await expect(page.locator("#feed")).not.toContainText("Doors");
  await page.goto(`/events/${eventSlug}/going`);
  const names = page.locator("main li");
  await expect(names.filter({ hasText: P.ann.name })).toHaveCount(1);
  await expect(names.filter({ hasText: P.cara.name })).toHaveCount(0);   // chose not to show
  await expect(names.filter({ hasText: P.newbie.name })).toHaveCount(0); // no profile
  await expect(names.filter({ hasText: P.dev.name })).toHaveCount(0);    // no ticket
  await expect(page.locator("body")).not.toContainText(/General Admission|\$20|FTX-/); // never ticket types, prices or orders
  await page.goto(`/o/${orgSlug}`);
  await page.getByRole("button", { name: /^Follow E2E Social/ }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fo%2Fe2e-soc-/);
  con.assertClean();
});

test("following an organizer: follow, count, mute, unfollow; one notice on the next public event", async ({ browser }) => {
  const { page } = await as(browser, "dev");
  const con = watchConsole(page);
  await page.goto(`/o/${orgSlug}`);
  await page.getByRole("button", { name: /^Follow E2E Social/ }).click();
  await expect(page.getByRole("button", { name: /^Following E2E Social/ })).toBeVisible();
  await expect(page.getByText("1 follower")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /^Following E2E Social/ })).toBeVisible();
  // the Follow button on the event page shows the same state
  await page.goto(`/events/${eventSlug}`);
  await expect(page.locator("#organizer").getByRole("button", { name: /^Following/ })).toBeVisible();
  await page.goto("/account/following");
  await expect(page.getByRole("link", { name: `E2E Social ${id}` })).toBeVisible();
  await page.getByRole("button", { name: "Mute" }).click();
  await expect(page.getByRole("button", { name: "Unmute" })).toBeVisible();
  expect((await q<{ muted: number }>(`SELECT muted FROM org_follows WHERE user_id = ? AND organization_id = ?`, [P.dev.id, orgId]))[0].muted).toBe(1);
  await page.getByRole("button", { name: "Unmute" }).click();
  await expect(page.getByRole("button", { name: "Mute" })).toBeVisible();
  con.assertClean();
});

test("organizer publishes a new event from the dashboard: followers get one email, muted followers none", async ({ browser }) => {
  const newId = await ins(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, ?, NOW() + INTERVAL 40 DAY, 'America/New_York', 'draft', 'public', 'buyer_pays')`,
    [orgId, `e2e-soc-new-${id}`, `E2E Next Show ${id}`],
  );
  await q(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'Free', 0, 10)`, [newId]);
  await q(`INSERT INTO org_follows (user_id, organization_id, muted) VALUES (?, ?, 1)`, [P.bob.id, orgId]);
  const { page } = await as(browser, "boss");
  await page.goto(`/org/${orgSlug}/events/${newId}`);
  await page.getByRole("button", { name: /^Publish/ }).first().click();
  const confirm = page.getByRole("alertdialog").getByRole("button", { name: /Publish/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect.poll(async () => (await q(`SELECT 1 FROM email_outbox WHERE to_email = ? AND subject LIKE 'New from E2E Social%Next Show%'`, [P.dev.email])).length, { timeout: 20_000 }).toBe(1);
  expect(await q(`SELECT 1 FROM email_outbox WHERE to_email = ? AND subject LIKE 'New from E2E Social%Next Show%'`, [P.bob.email])).toHaveLength(0);
  // unpublish and publish again: still only one notice
  await q(`UPDATE events SET status = 'draft' WHERE id = ?`, [newId]);
  await page.reload();
  await page.getByRole("button", { name: /^Publish/ }).first().click();
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await page.waitForTimeout(2000);
  expect(await q(`SELECT 1 FROM email_outbox WHERE to_email = ? AND subject LIKE 'New from E2E Social%Next Show%'`, [P.dev.email])).toHaveLength(1);
  await q(`DELETE FROM org_follows WHERE user_id = ?`, [P.bob.id]);
});

test("profile: create with validation, 18+ confirmation, then it shows on /u/<username>", async ({ browser }) => {
  const { page } = await as(browser, "newbie");
  const con = watchConsole(page);
  await page.goto("/account/profile");
  await page.fill("#pf-username", P.ann.username!); // taken
  await page.locator("input[name=adult]").check();
  await page.getByRole("button", { name: "Create my profile" }).click();
  await expect(page.locator("#f-pf-username-fx-error")).toHaveText("That username is taken.");
  const username = `newbie_${id}`.slice(0, 30);
  await page.fill("#pf-username", username);
  await page.fill("#pf-bio", "First time at a Fattixx show");
  await page.fill("#pf-ig", "@newbie.ig");
  await page.getByRole("button", { name: "Create my profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  P.newbie.username = username;
  await page.goto(`/u/${username}`);
  await expect(page.getByRole("heading", { name: P.newbie.name })).toBeVisible();
  await expect(page.getByText("First time at a Fattixx show")).toBeVisible();
  await expect(page.getByRole("link", { name: /Instagram · @newbie.ig/ })).toHaveAttribute("href", "https://instagram.com/newbie.ig");
  // the guest list switch now works for them on the event page
  await page.goto(`/events/${eventSlug}`);
  await expect(page.getByRole("switch")).toBeChecked(); // account default: on
  con.assertClean();
});

test("Who's Going: a holder hides themselves for one event; the organizer turns the list off for everyone", async ({ browser }) => {
  const { page } = await as(browser, "ann");
  await page.goto(`/events/${eventSlug}`);
  await page.getByRole("switch").uncheck();
  await expect.poll(async () => (await q<{ visible: number }>(`SELECT visible FROM event_guest_prefs WHERE event_id = ? AND user_id = ?`, [eventId, P.ann.id]))[0]?.visible).toBe(0);
  const viewer = await anon(browser);
  await viewer.page.goto(`/events/${eventSlug}/going`);
  await expect(viewer.page.locator("main li").filter({ hasText: P.ann.name })).toHaveCount(0);
  await page.getByRole("switch").check();
  await expect.poll(async () => (await q<{ visible: number }>(`SELECT visible FROM event_guest_prefs WHERE event_id = ? AND user_id = ?`, [eventId, P.ann.id]))[0]?.visible).toBe(1);

  const org = await as(browser, "boss");
  await org.page.goto(`/org/${orgSlug}/events/${eventId}?tab=social`);
  await org.page.locator("#sp-mode").selectOption("off");
  await org.page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(org.page.getByText("Saved.")).toBeVisible();
  await viewer.page.goto(`/events/${eventSlug}`);
  await expect(viewer.page.locator("section[aria-labelledby=going-h]")).toHaveCount(0);
  expect((await viewer.page.goto(`/events/${eventSlug}/going`))?.status()).toBe(404);
  await org.page.locator("#sp-mode").selectOption("faces_total");
  await org.page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(org.page.getByText("Saved.")).toBeVisible();
});

test("private events: the guest list needs the link key", async ({ browser }) => {
  const { page } = await anon(browser);
  expect((await page.goto(`/events/${privateSlug}/going`))?.status()).toBe(404);
  expect((await page.goto(`/api/share/${privateSlug}/story`))?.status()).toBe(404);
  expect((await page.goto(`/api/share/${privateSlug}/story?key=${PRIVATE_KEY}`))?.status()).toBe(200);
});

test("following attendees: friends, requests for private profiles, search, Who's Going puts people you follow first", async ({ browser }) => {
  // bob only lets approved people follow him, and makes his profile private
  const bob = await as(browser, "bob");
  await bob.page.goto("/account/profile");
  await bob.page.locator("input[name=profile_public]").uncheck();
  await bob.page.locator("input[name=who_can_follow][value=approved]").check();
  await bob.page.getByRole("button", { name: "Save privacy settings" }).click();
  await expect(bob.page.getByText("Privacy settings saved.")).toBeVisible();

  const dev = await as(browser, "dev");
  const con = watchConsole(dev.page);
  await dev.page.goto(`/u/${P.bob.username}`);
  await expect(dev.page.getByText("This profile is private.")).toBeVisible();
  await dev.page.getByRole("button", { name: "Follow", exact: true }).click();
  await expect(dev.page.getByRole("button", { name: "Requested" })).toBeVisible();

  await bob.page.goto("/account/friends");
  await expect(bob.page.getByText("Follow requests (1)")).toBeVisible();
  await bob.page.getByRole("button", { name: "Approve" }).click();
  await expect(bob.page.getByText("Follow requests")).toHaveCount(0);

  await dev.page.reload();
  await expect(dev.page.getByText("This profile is private.")).toHaveCount(0);
  await expect(dev.page.getByRole("heading", { name: "Going to" })).toBeVisible();

  // search by username and follow back → friends
  await bob.page.goto(`/account/friends?q=${encodeURIComponent(P.dev.username!)}`);
  await bob.page.getByRole("listitem").filter({ hasText: P.dev.name }).getByRole("button", { name: /^Follow/ }).first().click(); // search result (also listed under Followers)
  await bob.page.goto("/account/friends");
  await expect(bob.page.getByText("Friends (1)")).toBeVisible();

  // the full list puts people you follow first
  await dev.page.goto(`/events/${eventSlug}/going`);
  await expect(dev.page.locator("main li").first()).toContainText(P.bob.name);
  con.assertClean();

  // restore bob
  await bob.page.goto("/account/profile");
  await bob.page.locator("input[name=profile_public]").check();
  await bob.page.locator("input[name=who_can_follow][value=anyone]").check();
  await bob.page.getByRole("button", { name: "Save privacy settings" }).click();
  await expect(bob.page.getByText("Privacy settings saved.")).toBeVisible();
});

test("For you and 'friends going' on the events page", async ({ browser }) => {
  // dev and bob are friends (previous test) and bob is going; dev follows the organizer
  const { page } = await as(browser, "dev");
  await page.goto("/events");
  const forYou = page.locator("section[aria-labelledby=for-you-h]");
  await expect(forYou).toBeVisible();
  const tile = forYou.locator("a", { hasText: `E2E Social Night ${id}` });
  await expect(tile).toBeVisible();
  await expect(tile).toContainText("1 friend going");
});

test("blocking hides profiles both ways and removes follows", async ({ browser }) => {
  const ann = await as(browser, "ann");
  await ann.page.goto(`/u/${P.dev.username}`);
  await ann.page.getByRole("button", { name: /More options for/ }).click();
  await ann.page.getByRole("button", { name: /^Block / }).click();
  await expect(ann.page.getByText(/You blocked/)).toBeVisible();
  const dev = await as(browser, "dev");
  expect((await dev.page.goto(`/u/${P.ann.username}`))?.status()).toBe(404);
  await dev.page.goto(`/events/${eventSlug}/going`);
  await expect(dev.page.locator("main li").filter({ hasText: P.ann.name })).toHaveCount(0);
  await ann.page.goto("/account/friends");
  await ann.page.getByRole("button", { name: "Unblock" }).click();
  await expect(ann.page.getByRole("button", { name: "Unblock" })).toHaveCount(0);
  expect((await dev.page.goto(`/u/${P.ann.username}`))?.status()).toBe(200);
});

test("event feed: post, reply, react, report; organizer alert, pin, remove; mute a person", async ({ browser }) => {
  const ann = await as(browser, "ann");
  const con = watchConsole(ann.page);
  await ann.page.goto(`/events/${eventSlug}`);
  await ann.page.locator("#body-top").fill("Anyone driving from Summerville?");
  await ann.page.getByRole("button", { name: "Post", exact: true }).click();
  const annPost = ann.page.locator("#feed article").filter({ hasText: "Anyone driving from Summerville?" });
  await expect(annPost).toBeVisible();
  // links are not allowed for attendees
  await ann.page.locator("#body-top").fill("tickets cheaper at www.scam.example");
  await ann.page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(ann.page.getByText("Links aren’t allowed in posts.")).toBeVisible();

  const bob = await as(browser, "bob");
  await bob.page.goto(`/events/${eventSlug}`);
  const post = bob.page.locator("#feed article").filter({ hasText: "Anyone driving from Summerville?" }).first();
  await post.getByRole("button", { name: "Reply" }).click();
  const replyForm = bob.page.locator("#feed form:has(input[name=parent_id])");
  await replyForm.locator("textarea").fill("I am, I can give a ride");
  await replyForm.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(post).toContainText("I can give a ride");
  await post.getByRole("button", { name: "React 🙌" }).first().click();
  await expect(post.getByRole("button", { name: "React 🙌", pressed: true }).first()).toBeVisible();
  await expect.poll(async () => (await q(`SELECT 1 FROM email_outbox WHERE to_email = ? AND subject LIKE 'New reply in%'`, [P.ann.email])).length, { timeout: 15_000 }).toBeGreaterThan(0);

  // cara reports ann's post
  const cara = await as(browser, "cara");
  await cara.page.goto(`/events/${eventSlug}`);
  const target = cara.page.locator("#feed article").filter({ hasText: "Anyone driving from Summerville?" }).first();
  await target.getByRole("button", { name: "Post options" }).first().click();
  await target.getByRole("button", { name: "Report" }).click();
  await target.locator("textarea").last().fill("Off-topic spam");
  await target.getByRole("button", { name: "Send report" }).click();
  await expect(cara.page.getByText("Thanks. We’ll take a look.")).toBeVisible();

  // organizer: alert, sees the report, removes the post, mutes bob
  const boss = await as(browser, "boss");
  await boss.page.goto(`/events/${eventSlug}`);
  await boss.page.locator("#body-top").fill("Doors now open at 8pm");
  await boss.page.getByLabel(/Alert \(pinned/).check();
  await boss.page.getByRole("button", { name: "Post", exact: true }).click();
  const alert = boss.page.locator("#feed > ol > li").first();
  await expect(alert).toContainText("Doors now open at 8pm");
  await expect(alert).toContainText("Organizer");
  await expect.poll(async () => (await q(`SELECT 1 FROM email_outbox WHERE to_email = ? AND subject LIKE 'Alert from E2E Social%'`, [P.cara.email])).length, { timeout: 15_000 }).toBeGreaterThan(0);

  await boss.page.goto(`/org/${orgSlug}/audience?tab=reports`);
  const row = boss.page.locator("tbody tr").filter({ hasText: "Off-topic spam" });
  await expect(row).toContainText("Anyone driving from Summerville?");
  await row.getByRole("button", { name: "Remove post" }).click();
  await expect(row.getByText("resolved")).toBeVisible();
  await ann.page.reload();
  await expect(ann.page.locator("#feed")).not.toContainText("Anyone driving from Summerville?");

  // mute bob from his own post menu
  await bob.page.locator("#body-top").fill("Bob was here");
  await bob.page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(bob.page.locator("#feed")).toContainText("Bob was here");
  await boss.page.goto(`/events/${eventSlug}`);
  const bobPost = boss.page.locator("#feed article").filter({ hasText: "Bob was here" }).first();
  await bobPost.getByRole("button", { name: "Post options" }).first().click();
  await bobPost.getByRole("button", { name: /^Mute Bob/ }).click();
  await bob.page.reload();
  await expect(bob.page.getByText("The organizer turned off posting for you in this feed.")).toBeVisible();
  await expect(bob.page.locator("#body-top")).toHaveCount(0);
  await q(`UPDATE event_feed_members SET state = 'ok' WHERE user_id = ?`, [P.bob.id]);

  // someone without a ticket only sees the notice
  const dev = await as(browser, "dev");
  await dev.page.goto(`/events/${eventSlug}`);
  await expect(dev.page.locator("#feed")).toContainText("The event feed is for ticket holders.");
  await expect(dev.page.locator("#feed")).not.toContainText("Doors now open");
  con.assertClean();
});

test("sharing: order page share card, story and post images, ?via= attribution", async ({ browser }) => {
  const { page } = await as(browser, "ann");
  const con = watchConsole(page);
  await page.goto(`/orders/${P.ann.orderCode}`);
  await expect(page.getByText("Share that you’re going")).toBeVisible();
  await expect(page.getByRole("button", { name: "Instagram Story" })).toBeVisible();
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", new RegExp(`via%3D${P.ann.username}`));
  await expect(page.getByRole("button", { name: /^Follow E2E Social|^Following E2E Social/ })).toBeVisible();
  for (const [fmt, w, h] of [["story", 1080, 1920], ["post", 1200, 630]] as const) {
    const res = await page.request.get(`/api/share/${eventSlug}/${fmt}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    const buf = await res.body();
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([w, h]);
  }
  await page.getByRole("button", { name: "Copy link" }).first().click();
  await expect.poll(async () => (await q(`SELECT 1 FROM event_shares WHERE event_id = ? AND user_id = ? AND channel = 'copy'`, [eventId, P.ann.id])).length).toBe(1);
  con.assertClean();

  // a friend arrives through the shared link and starts checkout: the order remembers who shared it
  const friend = await anon(browser);
  await friend.page.goto(`/events/${eventSlug}?via=${P.ann.username}`);
  await openTickets(friend.page);
  await pick(friend.page, "General Admission");
  await friend.page.fill("#tk-name", "Shared Friend");
  await friend.page.fill("#tk-email", `e2e-soc-sharedfriend-${id}@fattixx.local`);
  await Promise.all([friend.page.waitForURL(/\/checkout\//), friend.page.locator("#tickets").getByRole("button", { name: "Checkout" }).click()]);
  const [o] = await q<{ shared_by_user_id: number }>(`SELECT shared_by_user_id FROM orders WHERE buyer_email = ?`, [`e2e-soc-sharedfriend-${id}@fattixx.local`]);
  expect(Number(o.shared_by_user_id)).toBe(P.ann.id);
});

test("signed-out buyer on the order page is offered 'See who else is going' with their email", async ({ browser }) => {
  const { page } = await anon(browser);
  await page.goto(`/orders/${P.cara.orderCode}?t=${P.cara.orderToken}`);
  const link = page.getByRole("link", { name: "Create my account" });
  await expect(link).toHaveAttribute("href", new RegExp(`email=${encodeURIComponent(P.cara.email).replace(/[.]/g, "\\.")}`));
  await link.click();
  await expect(page.locator("#email")).toHaveValue(P.cara.email);
});

test("referral rewards: organizer sets a public offer, a ticket holder gets a link, a sale through it is credited", async ({ browser }) => {
  const boss = await as(browser, "boss");
  await boss.page.goto(`/org/${orgSlug}/events/${eventId}?tab=social`);
  const pub = boss.page.locator("form").filter({ hasText: "Public offer" });
  await pub.locator("select[name=reward_type]").selectOption("fixed");
  await pub.locator("select[name=reward_basis]").selectOption("ticket");
  await pub.locator("input[name=reward_value]").fill("3");
  await pub.getByRole("button", { name: "Save offer" }).click();
  await expect(pub.getByText("Referral rewards are on.")).toBeVisible();

  const promo = await as(browser, "promo");
  const con = watchConsole(promo.page);
  await promo.page.goto(`/events/${eventSlug}`);
  const earn = promo.page.locator("section[aria-labelledby=earn-h]");
  await expect(earn).toContainText("Earn $3.00 per ticket");
  await earn.getByRole("checkbox").check();
  await earn.getByRole("button", { name: "Get my link" }).click();
  const code = (await earn.locator("code").textContent())!.match(/\/r\/(x[a-z0-9]+)/)![1];
  con.assertClean();

  // a buyer follows the link and starts checkout: the order is attributed to the referrer's link
  const buyer = await anon(browser);
  await buyer.page.goto(`/r/${code}`);
  await expect(buyer.page).toHaveURL(new RegExp(`ref=${code}`));
  await openTickets(buyer.page);
  await pick(buyer.page, "General Admission");
  await buyer.page.fill("#tk-name", "Referred Buyer");
  await buyer.page.fill("#tk-email", `e2e-soc-referred-${id}@fattixx.local`);
  await Promise.all([buyer.page.waitForURL(/\/checkout\//), buyer.page.locator("#tickets").getByRole("button", { name: "Checkout" }).click()]);
  const [o] = await q<{ id: number; link_code: string }>(`SELECT o.id, tl.code AS link_code FROM orders o JOIN tracking_links tl ON tl.id = o.tracking_link_id WHERE o.buyer_email = ?`, [`e2e-soc-referred-${id}@fattixx.local`]);
  expect(o.link_code).toBe(code);

  // the referrer's dashboard shows the link and the click
  await promo.page.goto("/account/referrals");
  const row = promo.page.locator("tbody tr").filter({ hasText: `E2E Social Night ${id}` });
  await expect(row).toContainText(code);
  await expect(row.locator("td").nth(3)).toHaveText("1");
  // payout details (manual payouts)
  await promo.page.locator("#po-method").selectOption("venmo");
  await promo.page.fill("#po-handle", "@promo-venmo");
  await promo.page.getByRole("button", { name: "Save payout details" }).click();
  await expect(promo.page.getByText("Payout details saved.")).toBeVisible();

  // organizer sees the referrer in "Sales by referrer"
  await boss.page.reload();
  await expect(boss.page.locator("tbody tr").filter({ hasText: P.promo.name })).toContainText(code);
});

test("referral rewards: invite-only offer, invitation email, accept with the terms", async ({ browser }) => {
  const boss = await as(browser, "boss");
  await boss.page.goto(`/org/${orgSlug}/events/${eventId}?tab=social`);
  const inv = boss.page.locator("form").filter({ hasText: "Invite-only offer" });
  await inv.locator("select[name=reward_type]").selectOption("percent");
  await inv.locator("input[name=reward_value]").fill("10");
  await inv.getByRole("button", { name: "Save offer" }).click();
  await expect(inv.getByText("Referral rewards are on.")).toBeVisible();
  await boss.page.fill("#ref-contacts", `${P.dev.email}\nnot an address`);
  await boss.page.getByRole("button", { name: "Send invitations" }).click();
  await expect(boss.page.getByText("1 invitation(s) sent. Not an email or phone number: not an address")).toBeVisible();

  const url = await latestLinkFor(P.dev.email, "/referrals/accept/");
  expect(url).toBeTruthy();
  const path = new URL(url!).pathname;
  const signedOut = await anon(browser);
  await signedOut.page.goto(path);
  await expect(signedOut.page.getByText(/10% of each sale/)).toBeVisible();
  // (the shared Button gives links role="button", so find the <a> itself)
  await expect(signedOut.page.locator("main a", { hasText: "Create an account" })).toHaveAttribute("href", /email=e2e-soc-dev/);

  const dev = await as(browser, "dev");
  await dev.page.goto(path);
  await dev.page.getByRole("checkbox").check();
  await dev.page.getByRole("button", { name: "Accept and get my link" }).click();
  await expect(dev.page.getByText("Your personal link:")).toBeVisible();
  await dev.page.goto("/account/referrals");
  await expect(dev.page.locator("tbody tr").filter({ hasText: `E2E Social Night ${id}` })).toContainText("invited");
});

test("organizer audience: people, message with unsubscribe, growth; settings: social links and hidden count", async ({ browser }) => {
  const boss = await as(browser, "boss");
  const con = watchConsole(boss.page);
  await boss.page.goto(`/org/${orgSlug}/audience`);
  const rows = boss.page.locator("tbody tr");
  await expect(rows.filter({ hasText: P.ann.email })).toHaveCount(1);
  // dev follows but never bought: name only, email hidden
  await expect(rows.filter({ hasText: P.dev.name })).toContainText("hidden");
  await boss.page.getByLabel("Who").selectOption("followers");
  await boss.page.getByRole("button", { name: "Filter" }).click();
  await expect(rows.filter({ hasText: P.ann.email })).toHaveCount(0);

  await boss.page.goto(`/org/${orgSlug}/audience?tab=message`);
  await boss.page.fill("#am-subject", "Thank you");
  await boss.page.fill("#am-body", "Thanks for coming out, more soon!");
  boss.page.once("dialog", (d) => d.accept());
  await boss.page.getByRole("button", { name: /^Send to/ }).click();
  await expect(boss.page.getByText(/Sent \d+ email/)).toBeVisible();
  const sent = await q<{ to_email: string; text_body: string; html_body: string }>(`SELECT to_email, text_body, html_body FROM email_outbox WHERE subject = ?`, [`E2E Social ${id}: Thank you`]);
  const to = sent.map((s) => s.to_email);
  expect(to).toContain(P.dev.email);   // follower
  expect(to).toContain(P.ann.email);   // opted in at checkout
  expect(to).not.toContain(P.bob.email); // neither
  const unsub = sent.find((s) => s.to_email === P.ann.email)!.html_body.match(/\/unsubscribe\/org\/[^"]+/)![0];
  const visitor = await anon(browser);
  await visitor.page.goto(unsub);
  await visitor.page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(visitor.page.getByText("You’re unsubscribed.")).toBeVisible();

  await boss.page.goto(`/org/${orgSlug}/audience?tab=analytics`);
  await expect(boss.page.getByText("New followers per week")).toBeVisible();

  await boss.page.goto(`/org/${orgSlug}/settings`);
  await boss.page.fill("#soc-instagram", "instagram.com/e2esocial");
  await boss.page.locator("#soc-hide").check();
  await boss.page.locator("form").filter({ has: boss.page.locator("#soc-instagram") }).getByRole("button", { name: "Save" }).click();
  await expect(boss.page.getByText("Saved.").first()).toBeVisible();
  const pub = await anon(browser);
  await pub.page.goto(`/o/${orgSlug}`);
  await expect(pub.page.getByRole("link", { name: /on Instagram/ })).toHaveAttribute("href", "https://instagram.com/e2esocial");
  await expect(pub.page.getByText(/\d+ followers?$/)).toHaveCount(0);
  con.assertClean();
});

test("admin console: Reports (remove profile content, suspend) and Referral payouts (share, owed referrers)", async ({ browser }) => {
  const cara = await as(browser, "cara");
  await cara.page.goto(`/u/${P.bob.username}`);
  await cara.page.getByRole("button", { name: /More options for/ }).click();
  await cara.page.getByRole("button", { name: "Report profile" }).click();
  await cara.page.locator("textarea").fill("Impersonating someone");
  await cara.page.getByRole("button", { name: "Send report" }).click();
  await expect(cara.page.getByText("Thanks. We’ll take a look.")).toBeVisible();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page);
  await page.goto(`${E2E.adminUrl}/admin/reports`);
  const row = page.locator("tbody tr").filter({ hasText: "Impersonating someone" });
  await expect(row).toContainText(P.bob.username!);
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Remove content" }).click();
  await expect(page.locator("tbody tr").filter({ hasText: "Impersonating someone" })).toHaveCount(0);
  expect(await q(`SELECT 1 FROM audit_log WHERE action = 'social.profile.removed' AND target_id = ?`, [String(P.bob.id)])).toHaveLength(1);

  await page.goto(`${E2E.adminUrl}/admin/referrals`);
  await expect(page.getByRole("heading", { name: "Referral payouts" })).toBeVisible();
  await page.fill("#rs-pct", "20");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. It applies to new rewards.")).toBeVisible();
  await page.fill("#rs-pct", "0");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. It applies to new rewards.")).toBeVisible();
});

test("phone width: profile, event page and account pages don't scroll sideways", async ({ browser }) => {
  const { page } = await as(browser, "ann", { mobile: true });
  for (const path of [`/u/${P.ann.username}`, `/events/${eventSlug}`, `/events/${eventSlug}/going`, "/account/profile", "/account/friends", "/account/referrals", `/orders/${P.ann.orderCode}`]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});

test("deleting an account removes the profile, follows and posts", async ({ browser }) => {
  const { page } = await as(browser, "leaver");
  await page.goto(`/events/${eventSlug}`);
  await page.locator("#body-top").fill("Leaving soon");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.locator("#feed")).toContainText("Leaving soon");
  await q(`INSERT INTO org_follows (user_id, organization_id) VALUES (?, ?)`, [P.leaver.id, orgId]);
  await page.goto("/account");
  await page.getByRole("button", { name: "Delete my account" }).first().click();
  await page.fill("#del-confirm", "DELETE");
  await Promise.all([page.waitForURL(/account=deleted/), page.getByRole("dialog").getByRole("button", { name: "Delete my account" }).click()]);
  const anonP = await anon(browser);
  expect((await anonP.page.goto(`/u/${P.leaver.username}`))?.status()).toBe(404);
  expect(await q(`SELECT 1 FROM event_posts WHERE user_id = ?`, [P.leaver.id])).toHaveLength(0);
  expect(await q(`SELECT 1 FROM org_follows WHERE user_id = ?`, [P.leaver.id])).toHaveLength(0);
});
