'use server';

import { revalidatePath } from 'next/cache';
import { audit } from '../audit';
import { assertSuperAdmin } from '../auth/guard';
import { setSetting } from '../settings';

/**
 * Super Admin → Payments → Payouts & marketplace: the Phase 3 money settings.
 *   payout_mode               manual (Admin → Payouts, as before) or connect (Stripe Connect, src/lib/payments/connect.ts)
 *   connect_payout_delay_days days Stripe holds an organizer's balance before paying it out (new accounts; 2–30)
 *   ad_cpm_cents              advertiser portal price per 1,000 impressions
 *   ad_min_impressions        smallest impression purchase
 *   sponsorship_fee_bps       Fattixx's share of a sponsorship deal
 */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const num = (fd: FormData, k: string) => Number(String(fd.get(k) ?? '').trim());

export async function saveMonetizationSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let session;
  try { session = await assertSuperAdmin(); } catch (e) { return { error: (e as Error).message }; }
  const mode = String(fd.get('payout_mode') ?? '');
  if (mode !== 'manual' && mode !== 'connect') return { error: 'Choose how organizers are paid.' };
  const delay = num(fd, 'connect_payout_delay_days');
  if (!Number.isInteger(delay) || delay < 2 || delay > 30) return { error: 'Payout delay: 2 to 30 days.' };
  const cpm = Math.round(num(fd, 'ad_cpm_dollars') * 100);
  if (!Number.isFinite(cpm) || cpm < 50 || cpm > 100_000) return { error: 'Price per 1,000 impressions: $0.50 to $1,000.' };
  const minImp = num(fd, 'ad_min_impressions');
  if (!Number.isInteger(minImp) || minImp < 1000 || minImp > 10_000_000) return { error: 'Smallest purchase: 1,000 to 10,000,000 impressions.' };
  const feePct = num(fd, 'sponsorship_fee_pct');
  if (!Number.isFinite(feePct) || feePct < 0 || feePct > 50) return { error: 'Sponsorship fee: 0% to 50%.' };
  const uid = session.user.id;
  await setSetting('payout_mode', mode, uid);
  await setSetting('connect_payout_delay_days', String(delay), uid);
  await setSetting('ad_cpm_cents', String(cpm), uid);
  await setSetting('ad_min_impressions', String(minImp), uid);
  await setSetting('sponsorship_fee_bps', String(Math.round(feePct * 100)), uid);
  await audit('settings.payouts', { actorUserId: uid, metadata: { payout_mode: mode, delay, cpm, minImp, sponsorshipFeeBps: Math.round(feePct * 100) } });
  revalidatePath('/admin/payments');
  return { ok: true, message: 'Saved.' };
}
