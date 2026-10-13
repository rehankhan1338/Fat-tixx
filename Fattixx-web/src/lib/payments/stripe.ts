import 'server-only';
import Stripe from 'stripe';
import { getStripeSettings, type StripeMode } from '../settings';

/**
 * Stripe client built from the keys stored in Admin → Payments (encrypted in the database).
 * The Super Admin switches between the **test** (sandbox) and **live** key sets with one toggle.
 * Phase 1: a single Fat Tixx account (Fat Tixx is seller of record); Connect comes in Phase 2/3.
 */
export interface ActiveStripe { mode: StripeMode; secretKey: string; publishableKey: string; webhookSecret: string | null }

export async function getActiveStripe(): Promise<ActiveStripe | null> {
  const s = await getStripeSettings();
  const set = s[s.mode];
  if (!set.secretKey || !set.publishableKey) return null;
  return { mode: s.mode, secretKey: set.secretKey, publishableKey: set.publishableKey, webhookSecret: set.webhookSecret };
}

export async function isStripeConfigured(): Promise<boolean> {
  return (await getActiveStripe()) !== null;
}

const clients = new Map<string, Stripe>();
export function stripeClient(secretKey: string): Stripe {
  let c = clients.get(secretKey);
  if (!c) { c = new Stripe(secretKey, { appInfo: { name: 'Fat Tixx', version: '0.1.0' } }); clients.set(secretKey, c); }
  return c;
}

/** Client for the active mode; throws when Stripe is not configured. */
export async function getStripe(): Promise<{ stripe: Stripe; active: ActiveStripe }> {
  const active = await getActiveStripe();
  if (!active) throw new Error('Stripe is not configured. Add your keys under Admin → Payments.');
  return { stripe: stripeClient(active.secretKey), active };
}

/** Verify a key set by calling Stripe. Returns the account name / id or an error message. */
export async function testStripeKeys(secretKey: string): Promise<{ ok: true; account: string; livemode: boolean } | { ok: false; error: string }> {
  try {
    const s = stripeClient(secretKey);
    // Reading the balance proves the key is valid and tells us whether it is a live or test key.
    const bal = await s.balance.retrieve();
    const available = bal.available.reduce((n, b) => n + b.amount, 0);
    const currency = bal.available[0]?.currency?.toUpperCase() ?? 'USD';
    return { ok: true, account: `Stripe account (available balance ${(available / 100).toFixed(2)} ${currency})`, livemode: bal.livemode };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
