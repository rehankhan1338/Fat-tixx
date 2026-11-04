/**
 * Stripe Connect inside organizer verification (docs/Stripe_Onboarding_Manual_Test_Guide.docx) against the
 * `fattixx_test` database, with Stripe replaced by a fake that records every call: the Individual / sole proprietor
 * type, embedded onboarding (account sessions, business type, manual payouts), sending a verification only after
 * Stripe, approval blocked until Stripe verifies, the four statuses staff see, payouts released once per event after
 * it ends (less refunds, never for cancelled events) and nothing of this while payouts are manual.
 *   Create the DB once:  DB_NAME=fattixx_test node scripts/db-setup.mjs
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, has: () => false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// The signed-in organizer (Organization Admin of whichever org the action names) and the reviewing staff member.
const who = vi.hoisted(() => ({ userId: 0, reviewerId: 0 }));
vi.mock("@/lib/authz", async (original) => {
  const real = await original<typeof import("@/lib/authz")>();
  const { queryOne } = await import("@/lib/db");
  return {
    ...real,
    assertOrg: async (slug: string) => {
      const org = await queryOne(`SELECT * FROM organizations WHERE slug = ?`, [slug]);
      if (!org) throw new Error("Organization not found");
      return { session: { id: "s", user: { id: who.userId, roles: [] } }, org, role: "org_admin", isOrgAdmin: true, isSuperAdmin: false, perms: {} };
    },
  };
});
vi.mock("@/lib/auth/guard", async (original) => ({
  ...(await original<typeof import("@/lib/auth/guard")>()),
  assertPlatformRole: async () => ({ user: { id: who.reviewerId, roles: ["support"] } }),
}));

// Fake Stripe: connected accounts kept in memory, balances per account, payouts recorded.
type FakeAccount = { id: string; business_type?: string; details_submitted: boolean; payouts_enabled: boolean; capabilities: { transfers?: string }; requirements: { currently_due: string[]; past_due: string[]; disabled_reason: string | null }; settings: { payouts: { schedule: { interval: string } } } };
const fake = vi.hoisted(() => ({
  on: true,
  accounts: new Map<string, FakeAccount>(),
  created: [] as Record<string, unknown>[],
  updates: [] as { id: string; params: Record<string, unknown> }[],
  sessions: [] as Record<string, unknown>[],
  balance: new Map<string, { available: number; pending: number }>(),
  payouts: [] as { account: string; amount: number; key?: string }[],
  n: 0,
}));
vi.mock("@/lib/payments/stripe", () => {
  const client = {
    accounts: {
      create: async (p: Record<string, unknown>) => {
        fake.created.push(p);
        const id = `acct_fake_${++fake.n}_${Date.now()}`;
        const a: FakeAccount = { id, business_type: p.business_type as string | undefined, details_submitted: false, payouts_enabled: false, capabilities: {}, requirements: { currently_due: ["individual.dob.day"], past_due: [], disabled_reason: null }, settings: { payouts: { schedule: { interval: (p.settings as { payouts: { schedule: { interval: string } } }).payouts.schedule.interval } } } };
        fake.accounts.set(id, a);
        return a;
      },
      retrieve: async (id: string) => { const a = fake.accounts.get(id); if (!a) throw new Error("No such account"); return a; },
      update: async (id: string, params: Record<string, unknown>) => {
        fake.updates.push({ id, params });
        const a = fake.accounts.get(id)!;
        if (params.business_type) a.business_type = params.business_type as string;
        const interval = (params.settings as { payouts?: { schedule?: { interval?: string } } } | undefined)?.payouts?.schedule?.interval;
        if (interval) a.settings.payouts.schedule.interval = interval;
        return a;
      },
    },
    accountSessions: { create: async (p: Record<string, unknown>) => { fake.sessions.push(p); return { client_secret: `accs_secret_${fake.sessions.length}` }; } },
    balance: {
      retrieve: async (_p: unknown, o: { stripeAccount: string }) => {
        const b = fake.balance.get(o.stripeAccount) ?? { available: 0, pending: 0 };
        return { available: [{ currency: "usd", amount: b.available }], pending: [{ currency: "usd", amount: b.pending }] };
      },
    },
    payouts: {
      create: async (p: { amount: number }, o: { stripeAccount: string; idempotencyKey?: string }) => {
        const dup = fake.payouts.find((x) => x.key && x.key === o.idempotencyKey);
        if (dup) return { id: `po_dup` };
        fake.payouts.push({ account: o.stripeAccount, amount: p.amount, key: o.idempotencyKey });
        const b = fake.balance.get(o.stripeAccount);
        if (b) b.available -= p.amount;
        return { id: `po_fake_${fake.payouts.length}` };
      },
    },
  };
  const active = { mode: "test" as const, secretKey: "sk_test_fake", publishableKey: "pk_test_fake", webhookSecret: null };
  return {
    getActiveStripe: async () => (fake.on ? active : null),
    isStripeConfigured: async () => fake.on,
    stripeClient: () => client,
    getStripe: async () => ({ stripe: client, active }),
  };
});

/** Stripe finishing its checks on an account (what the organizer completing Stripe's form leads to). */
function stripeVerifies(accountId: string, ok = true) {
  const a = fake.accounts.get(accountId)!;
  a.details_submitted = true;
  a.capabilities.transfers = ok ? "active" : "inactive";
  a.payouts_enabled = ok;
  a.requirements = ok ? { currently_due: [], past_due: [], disabled_reason: null } : { currently_due: ["individual.id_number"], past_due: [], disabled_reason: "requirements.past_due" };
}

import { db, execute, query, queryOne, type Row } from "@/lib/db";
import { approveApplication, submitOrgVerification } from "@/lib/applications/actions";
import { startEmbeddedOnboarding } from "@/lib/payments/connect-actions";
import { STRIPE_STATUS, connectState, runConnectDailySync, runConnectEventPayouts, stripeBusinessType } from "@/lib/payments/connect";
import { stripeStep } from "@/lib/orgs/verification";
import { listOrganizations } from "@/lib/admin/queries";

const tag = randomUUID().slice(0, 8);
const orgIds: number[] = [];
const userIds: number[] = [];
let savedSettings: Row[] = [];

async function user(name: string): Promise<number> {
  const e = `sv-${name}-${tag}@test.local`;
  const id = (await execute(`INSERT INTO users (public_id, email, email_normalized, name, password_hash) VALUES (?, ?, ?, ?, 'x')`, [randomUUID(), e, e, name])).insertId;
  userIds.push(id);
  return id;
}

async function org(name: string, adminId: number): Promise<{ id: number; slug: string }> {
  const slug = `sv-${name}-${tag}`;
  const id = (await execute(`INSERT INTO organizations (slug, name, contact_email) VALUES (?, ?, ?)`, [slug, `${name} ${tag}`, `sv-${name}-${tag}@test.local`])).insertId;
  orgIds.push(id);
  await execute(`INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'org_admin')`, [id, adminId]);
  return { id, slug };
}

async function event(orgId: number, opts: { status?: string; daysFromNow: number }): Promise<number> {
  const id = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, ends_at, timezone, status, visibility, fee_mode)
     VALUES (?, ?, 'Stripe test night', NOW() + INTERVAL ? DAY, NOW() + INTERVAL ? DAY + INTERVAL 3 HOUR, 'America/New_York', ?, 'public', 'buyer_pays')`,
    [orgId, `sv-ev-${randomUUID().slice(0, 8)}`, opts.daysFromNow, opts.daysFromNow, opts.status ?? "published"],
  )).insertId;
  await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'GA', 2500, 100)`, [id]);
  return id;
}

/** A paid order whose organizer share went to the connected account with the payment. */
async function order(orgId: number, eventId: number, accountId: string, share: number, total: number, refunded = 0) {
  await execute(
    `INSERT INTO orders (code, access_token_hash, organization_id, event_id, buyer_email, fee_mode, status, subtotal_cents, total_cents, refunded_cents, connect_account_id, connect_transfer_cents, currency)
     VALUES (?, ?, ?, ?, 'buyer@test.local', 'buyer_pays', ?, ?, ?, ?, ?, ?, 'USD')`,
    [randomUUID().slice(0, 10), randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), orgId, eventId, refunded ? (refunded >= total ? "refunded" : "partially_refunded") : "paid", share, total, refunded, accountId, share],
  );
}

/** The verification form as the organizer sends it. */
function form(slug: string, over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const v = { org: slug, contact_name: "Jordan Lee", contact_email: `jordan-${tag}@test.local`, legal_name: "Jordan Lee", business_type: "individual", tax_id_last4: "", address: "100 Congress Ave, Austin, TX 78701", agree: "1", ...over };
  for (const [k, val] of Object.entries(v)) fd.set(k, val);
  return fd;
}

const setting = (key: string, value: string) => execute("INSERT INTO platform_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)", [key, value]);
const accountOf = async (orgId: number) => (await queryOne<Row & { account_id: string }>(`SELECT account_id FROM org_stripe_accounts WHERE organization_id = ?`, [orgId]))?.account_id ?? null;
const appOf = async (orgId: number) => queryOne<Row & { id: number; status: string; business_type: string; tax_id_last4: string | null }>(`SELECT id, status, business_type, tax_id_last4 FROM organizer_applications WHERE organization_id = ? ORDER BY id DESC LIMIT 1`, [orgId]);
const approve = (appId: number) => { const fd = new FormData(); fd.set("id", String(appId)); return approveApplication(fd); };

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  savedSettings = await query<Row>("SELECT `key`, `value` FROM platform_settings WHERE `key` IN ('payout_mode','connect_payout_delay_days','stripe_mode')");
  await setting("payout_mode", "connect");
  await setting("connect_payout_delay_days", "0");
  await setting("stripe_mode", "test");
  who.reviewerId = await user("reviewer");
});

beforeEach(() => { fake.on = true; });

afterAll(async () => {
  for (const s of savedSettings) await setting(String(s.key), String(s.value));
  if (!savedSettings.some((s) => s.key === "connect_payout_delay_days")) await execute("DELETE FROM platform_settings WHERE `key` = 'connect_payout_delay_days'");
  if (orgIds.length) {
    await execute(`DELETE FROM organizer_applications WHERE organization_id IN (${orgIds.map(() => "?").join(",")})`, orgIds);
    await execute(`DELETE FROM email_outbox WHERE related_type = 'organization' AND related_id IN (${orgIds.map(() => "?").join(",")})`, orgIds.map(String));
  }
  for (const id of orgIds) await execute(`DELETE FROM organizations WHERE id = ?`, [id]);
  for (const id of userIds) await execute(`DELETE FROM users WHERE id = ?`, [id]);
  await db.end();
});

describe("statuses and business types", () => {
  it("maps Stripe's account state to the four statuses staff see", () => {
    const base = { details_submitted: 0, transfers_active: 0, payouts_enabled: 0, requirements_due: null, disabled_reason: null };
    expect(STRIPE_STATUS[connectState(null)]).toBe("Not started");
    expect(STRIPE_STATUS[connectState(base)]).toBe("In progress");
    expect(STRIPE_STATUS[connectState({ ...base, details_submitted: 1 })]).toBe("In progress");
    expect(STRIPE_STATUS[connectState({ ...base, details_submitted: 1, requirements_due: '["individual.id_number"]' })]).toBe("Action required");
    expect(STRIPE_STATUS[connectState({ ...base, details_submitted: 1, transfers_active: 1, payouts_enabled: 1, requirements_due: "[]" })]).toBe("Verified");
  });

  it("creates individuals / sole proprietors as Stripe individuals, nonprofits as non-profits, the rest as companies", () => {
    expect(stripeBusinessType("individual")).toBe("individual");
    expect(stripeBusinessType("nonprofit")).toBe("non_profit");
    expect(stripeBusinessType("company")).toBe("company");
    expect(stripeBusinessType("venue")).toBe("company");
  });
});

describe("organizer A: individual / sole proprietor (guide tests 1–5, 8)", () => {
  let a: { id: number; slug: string };
  let heldEvent: number;

  beforeAll(async () => {
    who.userId = await user("a");
    a = await org("a", who.userId);
    heldEvent = await event(a.id, { status: "in_review", daysFromNow: 14 });
  });

  it("the Stripe step is required and not started", async () => {
    const step = await stripeStep(a.id);
    expect(step).toMatchObject({ required: true, state: "not_started", publishableKey: "pk_test_fake" });
  });

  it("can't send the verification before Stripe", async () => {
    const r = await submitOrgVerification(undefined, form(a.slug));
    expect(r?.error).toBe("Finish the payouts setup with Stripe (step 2) before sending your verification.");
    expect(await appOf(a.id)).toBeNull();
  });

  it("starts embedded onboarding: an individual Express account with manual payouts, and a session for the onboarding component", async () => {
    const r = await startEmbeddedOnboarding(a.slug, "individual");
    expect(r.clientSecret).toMatch(/^accs_secret_/);
    const created = fake.created.at(-1)!;
    expect(created).toMatchObject({ type: "express", country: "US", business_type: "individual", settings: { payouts: { schedule: { interval: "manual" } } } });
    const acct = await accountOf(a.id);
    expect(acct).toBeTruthy();
    expect(fake.sessions.at(-1)).toEqual({ account: acct, components: { account_onboarding: { enabled: true, features: { external_account_collection: true } } } });
    // Coming back reuses the same account
    await startEmbeddedOnboarding(a.slug, "individual");
    expect(fake.created.filter((c) => (c.metadata as Record<string, string>).organization_id === String(a.id))).toHaveLength(1);
    expect((await stripeStep(a.id, true)).state).toBe("incomplete");
  });

  it("switching the type before the details are sent updates the Stripe account", async () => {
    const acct = (await accountOf(a.id))!;
    await startEmbeddedOnboarding(a.slug, "company");
    expect(fake.accounts.get(acct)!.business_type).toBe("company");
    await startEmbeddedOnboarding(a.slug, "individual");
    expect(fake.accounts.get(acct)!.business_type).toBe("individual");
  });

  it("sends the verification once Stripe has the details; individuals give no EIN", async () => {
    const acct = (await accountOf(a.id))!;
    Object.assign(fake.accounts.get(acct)!, { details_submitted: true, requirements: { currently_due: [], past_due: [], disabled_reason: null } }); // organizer finished Stripe's form; Stripe still checking
    const r = await submitOrgVerification(undefined, form(a.slug, { tax_id_last4: "9999" }));
    expect(r?.ok).toBe(true);
    const app = await appOf(a.id);
    expect(app).toMatchObject({ status: "pending", business_type: "individual", tax_id_last4: null });
    expect(STRIPE_STATUS[(await stripeStep(a.id, true)).state]).toBe("In progress");
  });

  it("staff can't approve while Stripe is still verifying", async () => {
    const r = await approve(Number((await appOf(a.id))!.id));
    expect(r?.error).toMatch(/^Stripe setup isn't complete \(status: In progress\)\. .+ must finish it before you can approve\.$/);
    expect((await appOf(a.id))!.status).toBe("pending");
    expect((await queryOne<Row & { status: string }>(`SELECT status FROM events WHERE id = ?`, [heldEvent]))!.status).toBe("in_review");
  });

  it("approves once Stripe has verified: the organization is verified and its held paid event goes live", async () => {
    stripeVerifies((await accountOf(a.id))!);
    const r = await approve(Number((await appOf(a.id))!.id));
    expect(r?.ok).toBe(true);
    expect(r?.message).toMatch(/is verified and 1 held event is now live/);
    expect((await queryOne<Row & { verified_at: Date | null }>(`SELECT verified_at FROM organizations WHERE id = ?`, [a.id]))!.verified_at).not.toBeNull();
    expect((await queryOne<Row & { status: string }>(`SELECT status FROM events WHERE id = ?`, [heldEvent]))!.status).toBe("published");
  });
});

describe("organizer B: company, Stripe needs more (guide tests 6–7)", () => {
  let b: { id: number; slug: string };

  beforeAll(async () => {
    who.userId = await user("b");
    b = await org("b", who.userId);
    await event(b.id, { status: "in_review", daysFromNow: 14 });
  });

  it("a half-finished Stripe setup still blocks sending", async () => {
    await startEmbeddedOnboarding(b.slug, "company");
    expect(fake.created.at(-1)).toMatchObject({ business_type: "company" });
    const r = await submitOrgVerification(undefined, form(b.slug, { business_type: "company", legal_name: "Harbor Live LLC", tax_id_last4: "0000" }));
    expect(r?.error).toMatch(/Finish the payouts setup with Stripe/);
  });

  it("Action required blocks approval with the status in the message, and staff see it in the organizations list", async () => {
    const acct = (await accountOf(b.id))!;
    stripeVerifies(acct, false); // details sent, but Stripe couldn't verify the SSN
    const sent = await submitOrgVerification(undefined, form(b.slug, { business_type: "company", legal_name: "Harbor Live LLC", tax_id_last4: "0000" }));
    expect(sent?.ok).toBe(true);
    expect((await appOf(b.id))!.tax_id_last4).toBe("0000");

    const step = await stripeStep(b.id, true);
    expect(STRIPE_STATUS[step.state]).toBe("Action required");
    expect(step.due).toContain("individual.id_number");

    const r = await approve(Number((await appOf(b.id))!.id));
    expect(r?.error).toMatch(/status: Action required/);
    expect(r?.error).toMatch(/must finish it before you can approve/);

    const row = (await listOrganizations(`sv-b-${tag}`, 10, 0))[0];
    expect(row.stripe_account).toBe(acct);
    expect(STRIPE_STATUS[connectState({ details_submitted: Number(row.details_submitted), transfers_active: Number(row.transfers_active), payouts_enabled: Number(row.payouts_enabled), requirements_due: row.requirements_due, disabled_reason: row.disabled_reason })]).toBe("Action required");
  });

  it("approves after the organizer fixes it with Stripe", async () => {
    stripeVerifies((await accountOf(b.id))!);
    const r = await approve(Number((await appOf(b.id))!.id));
    expect(r?.ok).toBe(true);
  });
});

describe("payouts after the event (guide tests 9–11)", () => {
  let p: { id: number; slug: string };
  let acct: string;

  beforeAll(async () => {
    const u = await user("p");
    p = await org("p", u);
    acct = `acct_fake_payout_${tag}`;
    fake.accounts.set(acct, { id: acct, details_submitted: true, payouts_enabled: true, capabilities: { transfers: "active" }, requirements: { currently_due: [], past_due: [], disabled_reason: null }, settings: { payouts: { schedule: { interval: "daily" } } } });
    await execute(`INSERT INTO org_stripe_accounts (organization_id, stripe_mode, account_id, details_submitted, transfers_active, payouts_enabled) VALUES (?, 'test', ?, 1, 1, 1)`, [p.id, acct]);
  });

  it("the daily sync moves older accounts onto held (manual) payouts", async () => {
    await runConnectDailySync();
    expect(fake.accounts.get(acct)!.settings.payouts.schedule.interval).toBe("manual");
  });

  it("holds the money while the event is upcoming, pays it out once after it ends, less refunds", async () => {
    const upcoming = await event(p.id, { daysFromNow: 10 });
    await order(p.id, upcoming, acct, 5000, 5400);
    const past = await event(p.id, { daysFromNow: -2 });
    await order(p.id, past, acct, 5000, 5400); // 2 × $25
    await order(p.id, past, acct, 5000, 5400, 2700); // half refunded: half the share was taken back
    fake.balance.set(acct, { available: 20000, pending: 0 });

    await runConnectEventPayouts();
    const mine = fake.payouts.filter((x) => x.account === acct);
    expect(mine).toHaveLength(1);
    expect(mine[0].amount).toBe(7500);
    const row = await queryOne<Row & { amount_cents: number; stripe_payout_id: string }>(`SELECT amount_cents, stripe_payout_id FROM connect_event_payouts WHERE event_id = ?`, [past]);
    expect(row).toMatchObject({ amount_cents: 7500 });
    expect(row!.stripe_payout_id).toMatch(/^po_/);
    expect(await queryOne(`SELECT 1 FROM connect_event_payouts WHERE event_id = ?`, [upcoming])).toBeNull();

    // the next run pays nothing twice
    await runConnectEventPayouts();
    expect(fake.payouts.filter((x) => x.account === acct)).toHaveLength(1);
  });

  it("waits while the money is still pending, then pays it", async () => {
    const ev = await event(p.id, { daysFromNow: -1 });
    await order(p.id, ev, acct, 3000, 3300);
    fake.balance.set(acct, { available: 0, pending: 3000 });
    await runConnectEventPayouts();
    expect(await queryOne(`SELECT 1 FROM connect_event_payouts WHERE event_id = ?`, [ev])).toBeNull();
    fake.balance.set(acct, { available: 3000, pending: 0 });
    await runConnectEventPayouts();
    expect((await queryOne<Row & { amount_cents: number }>(`SELECT amount_cents FROM connect_event_payouts WHERE event_id = ?`, [ev]))!.amount_cents).toBe(3000);
  });

  it("never pays out a cancelled event", async () => {
    const ev = await event(p.id, { daysFromNow: -3, status: "cancelled" });
    await order(p.id, ev, acct, 4000, 4400);
    fake.balance.set(acct, { available: 10000, pending: 0 });
    const before = fake.payouts.length;
    await runConnectEventPayouts();
    expect(fake.payouts.length).toBe(before);
    expect(await queryOne(`SELECT 1 FROM connect_event_payouts WHERE event_id = ?`, [ev])).toBeNull();
  });

  it("waits the configured days after the event", async () => {
    await setting("connect_payout_delay_days", "5");
    const ev = await event(p.id, { daysFromNow: -2 });
    await order(p.id, ev, acct, 1000, 1100);
    fake.balance.set(acct, { available: 10000, pending: 0 });
    await runConnectEventPayouts();
    expect(await queryOne(`SELECT 1 FROM connect_event_payouts WHERE event_id = ?`, [ev])).toBeNull();
    await setting("connect_payout_delay_days", "0");
  });
});

describe("Stripe Connect switched off (guide test 12)", () => {
  it("no Stripe step, and verification and approval work without it", async () => {
    await setting("payout_mode", "manual");
    try {
      who.userId = await user("c");
      const c = await org("c", who.userId);
      expect((await stripeStep(c.id)).required).toBe(false);
      expect((await startEmbeddedOnboarding(c.slug, "individual")).error).toMatch(/not switched on/);
      const sent = await submitOrgVerification(undefined, form(c.slug));
      expect(sent?.ok).toBe(true);
      expect((await approve(Number((await appOf(c.id))!.id)))?.ok).toBe(true);
    } finally {
      await setting("payout_mode", "connect");
    }
  });
});
