import 'server-only';
import type Stripe from 'stripe';
import { execute, query, queryOne, type Row } from '../db';
import { getSettings, getStripeSettings } from '../settings';
import { getActiveStripe, getStripe, stripeClient } from './stripe';
import type { StripeMode } from '../settings';

/**
 * Stripe Connect organizer payouts (Phase 3, plan 7.2).
 *
 * Money flow: Fattixx stays seller of record (no `on_behalf_of`), so buyers keep seeing Fattixx on their statement and
 * disputes stay with Fattixx as today. Each paid order is a destination charge: the organizer's share is transferred
 * to their Express account with the payment, Fattixx keeps the fees and the tax, and Stripe pays the connected
 * balance out to the organizer's bank on a daily schedule after `connect_payout_delay_days` (setting).
 *
 *   organizer share = ticket and add-on revenue (subtotal, after discounts) − fees the organizer absorbs
 *
 * the same number the settlement statement uses for manual payouts. Refunds reverse the transfer in proportion
 * (Stripe `reverse_transfer`). Identity, business and bank checks are Stripe's onboarding (Express accounts).
 *
 * Off until a Super Admin sets Admin → Payments → Payouts to "Stripe Connect" (`payout_mode`). Even then an
 * organization keeps manual payouts until its account can receive transfers, so nothing breaks half-way.
 */
export type ConnectRow = Row & {
  organization_id: number; stripe_mode: StripeMode; account_id: string; details_submitted: number; transfers_active: number;
  payouts_enabled: number; requirements_due: string | null; disabled_reason: string | null; synced_at: Date | null;
};

export type ConnectState = 'not_started' | 'incomplete' | 'pending' | 'restricted' | 'active';

export async function payoutMode(): Promise<'manual' | 'connect'> {
  return (await getSettings()).payout_mode === 'connect' ? 'connect' : 'manual';
}

export async function getConnectAccount(orgId: number, mode: StripeMode): Promise<ConnectRow | null> {
  return queryOne<ConnectRow>(`SELECT * FROM org_stripe_accounts WHERE organization_id = ? AND stripe_mode = ?`, [orgId, mode]);
}

/** What the organizer sees: not started, details missing, Stripe checking, restricted (something due), or ready. */
export function connectState(a: Pick<ConnectRow, 'details_submitted' | 'transfers_active' | 'payouts_enabled' | 'requirements_due' | 'disabled_reason'> | null): ConnectState {
  if (!a) return 'not_started';
  const due = parseDue(a.requirements_due);
  if (Number(a.transfers_active) && Number(a.payouts_enabled) && !due.length) return 'active';
  if (!Number(a.details_submitted)) return 'incomplete';
  if (due.length || a.disabled_reason) return 'restricted';
  return 'pending';
}

export function parseDue(raw: string | null): string[] {
  try { return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
}

/** The organizer's part of an order's total. Never negative, never more than the total. */
export function organizerShareCents(o: { subtotal_cents: number; absorbed_fee_cents: number; total_cents: number }): number {
  return Math.max(0, Math.min(Number(o.total_cents), Number(o.subtotal_cents) - Number(o.absorbed_fee_cents)));
}

/** The connected account to pay an organization's share into, or null for a manual payout. */
export async function connectDestinationFor(orgId: number, mode: StripeMode): Promise<string | null> {
  if ((await payoutMode()) !== 'connect') return null;
  const a = await getConnectAccount(orgId, mode);
  return a && Number(a.transfers_active) ? a.account_id : null;
}

/**
 * Whether an organization can be paid for its ticket sales (plan 5.6.9, "live now, payouts later"): with Stripe
 * Connect, a verified account that receives transfers and pays out; with manual payouts, an organization Fattixx
 * has verified (Finance pays it through Admin → Payouts).
 */
export async function payoutsReady(orgId: number, orgVerified: boolean): Promise<boolean> {
  if ((await payoutMode()) !== 'connect') return orgVerified;
  const { mode } = await getStripeSettings();
  return connectState(await getConnectAccount(orgId, mode)) === 'active';
}

/** Mirror a Stripe account into org_stripe_accounts. */
export async function saveAccountState(acct: Stripe.Account): Promise<void> {
  const due = [...new Set([...(acct.requirements?.currently_due ?? []), ...(acct.requirements?.past_due ?? [])])];
  await execute(
    `UPDATE org_stripe_accounts SET details_submitted = ?, transfers_active = ?, payouts_enabled = ?, requirements_due = ?, disabled_reason = ?, synced_at = NOW() WHERE account_id = ?`,
    [acct.details_submitted ? 1 : 0, acct.capabilities?.transfers === 'active' ? 1 : 0, acct.payouts_enabled ? 1 : 0, JSON.stringify(due.slice(0, 50)), acct.requirements?.disabled_reason ?? null, acct.id],
  );
}

export async function syncConnectAccount(orgId: number): Promise<ConnectRow | null> {
  const active = await getActiveStripe();
  if (!active) return null;
  const row = await getConnectAccount(orgId, active.mode);
  if (!row) return null;
  try {
    await saveAccountState(await stripeClient(active.secretKey).accounts.retrieve(row.account_id));
  } catch (e) {
    console.error('[connect] account sync failed', row.account_id, (e as Error).message);
  }
  return getConnectAccount(orgId, active.mode);
}

type OrgForConnect = { id: number; name: string; contact_email: string; website: string | null; legal_name: string | null };

/** Create the organization's Express account in the active Stripe mode (once), then return its id. */
export async function ensureConnectAccount(org: OrgForConnect, userId: number): Promise<string> {
  const { stripe, active } = await getStripe();
  const existing = await getConnectAccount(org.id, active.mode);
  if (existing) return existing.account_id;
  const delay = Math.min(30, Math.max(2, Number((await getSettings()).connect_payout_delay_days) || 7));
  const acct = await stripe.accounts.create({
    type: 'express',
    country: 'US',
    email: org.contact_email,
    capabilities: { transfers: { requested: true } },
    business_profile: {
      name: org.name,
      ...(org.website ? { url: org.website } : {}),
      mcc: '7922', // theatrical producers and ticket agencies
      product_description: 'Event tickets sold through Fattixx',
    },
    settings: { payouts: { schedule: { interval: 'daily', delay_days: delay } } },
    metadata: { organization_id: String(org.id), legal_name: org.legal_name ?? '' },
  }, { idempotencyKey: `connect-account-${org.id}-${active.mode}` });
  await execute(
    `INSERT INTO org_stripe_accounts (organization_id, stripe_mode, account_id, created_by) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE account_id = account_id`,
    [org.id, active.mode, acct.id, userId],
  );
  await saveAccountState(acct);
  return (await getConnectAccount(org.id, active.mode))!.account_id;
}

/** A one-time link into Stripe's hosted onboarding (identity, business details, bank account). */
export async function onboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string> {
  const { stripe } = await getStripe();
  const link = await stripe.accountLinks.create({ account: accountId, type: 'account_onboarding', return_url: returnUrl, refresh_url: refreshUrl });
  return link.url;
}

/** A one-time sign-in link to the organizer's Stripe Express dashboard (balance, payouts, bank details). */
export async function expressDashboardLink(accountId: string): Promise<string> {
  const { stripe } = await getStripe();
  return (await stripe.accounts.createLoginLink(accountId)).url;
}

export type ConnectPayout = { id: string; amountCents: number; currency: string; status: string; arrivalDate: Date };
export type ConnectBalance = { availableCents: number; pendingCents: number; currency: string };

/** Recent payouts and the balance of a connected account, read from Stripe (nothing is stored). */
export async function connectMoney(accountId: string): Promise<{ payouts: ConnectPayout[]; balance: ConnectBalance } | null> {
  try {
    const { stripe } = await getStripe();
    const [payouts, balance] = await Promise.all([
      stripe.payouts.list({ limit: 10 }, { stripeAccount: accountId }),
      stripe.balance.retrieve({}, { stripeAccount: accountId }),
    ]);
    const sum = (l: { amount: number }[]) => l.reduce((n, b) => n + b.amount, 0);
    return {
      payouts: payouts.data.map((p) => ({ id: p.id, amountCents: p.amount, currency: p.currency.toUpperCase(), status: p.status, arrivalDate: new Date(p.arrival_date * 1000) })),
      balance: { availableCents: sum(balance.available), pendingCents: sum(balance.pending), currency: (balance.available[0]?.currency ?? 'usd').toUpperCase() },
    };
  } catch (e) {
    console.error('[connect] could not read balance / payouts', accountId, (e as Error).message);
    return null;
  }
}

/** Daily: refresh every connected account of the active mode, so a verification Stripe finished overnight shows up. */
export async function runConnectDailySync(): Promise<number> {
  const active = await getActiveStripe();
  if (!active) return 0;
  const rows = await query<Row & { account_id: string }>(`SELECT account_id FROM org_stripe_accounts WHERE stripe_mode = ?`, [active.mode]);
  const stripe = stripeClient(active.secretKey);
  let n = 0;
  for (const r of rows) {
    try { await saveAccountState(await stripe.accounts.retrieve(r.account_id)); n++; } catch (e) { console.error('[connect] daily sync', r.account_id, (e as Error).message); }
  }
  return n;
}
