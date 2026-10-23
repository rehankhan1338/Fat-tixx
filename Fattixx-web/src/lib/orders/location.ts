import 'server-only';
import type Stripe from 'stripe';
import { execute } from '../db';

/**
 * Where the buyer is from, for the Pro "where attendees are from" report (plan 5.7.2): the card's billing country,
 * region, city and postal code as Stripe collected them. Usually country and postal code only; nothing for box office
 * or free orders. Best effort: never throws, because it runs after the tickets are issued.
 */
export async function recordBuyerLocation(orderId: number, charge: Stripe.Charge | string | null | undefined): Promise<void> {
  if (!charge || typeof charge === 'string') return;
  const a = charge.billing_details?.address;
  if (!a) return;
  const clean = (s: string | null | undefined, max: number) => (s ? s.trim().slice(0, max) || null : null);
  const country = a.country && /^[A-Z]{2}$/i.test(a.country) ? a.country.toUpperCase() : null;
  const postal = clean(a.postal_code, 20)?.toUpperCase() ?? null;
  if (!country && !postal) return;
  try {
    await execute(
      `UPDATE orders SET buyer_country = ?, buyer_region = ?, buyer_city = ?, buyer_postal_code = ? WHERE id = ?`,
      [country, clean(a.state, 80), clean(a.city, 120), postal, orderId],
    );
  } catch (e) {
    console.error('[orders] could not store buyer location', e);
  }
}
