'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { audit } from '../audit';
import { assertOrg } from '../authz';
import { env } from '../env';
import { getActiveStripe } from './stripe';
import { ensureConnectAccount, expressDashboardLink, getConnectAccount, onboardingLink, payoutMode, syncConnectAccount } from './connect';

/**
 * Organization Admin: set up or finish Stripe Connect payouts (Dashboard → Payouts) and open the Stripe Express
 * dashboard. Both end with a redirect to Stripe; the one-time links are never stored or shown.
 */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const slugOf = (fd: FormData) => String(fd.get('org') ?? '').slice(0, 64);

export async function startPayoutSetup(fd: FormData): Promise<ActionState> {
  let ctx;
  try { ctx = await assertOrg(slugOf(fd), 'org_admin'); } catch (e) { return { error: (e as Error).message }; }
  if ((await payoutMode()) !== 'connect') return { error: 'Automatic payouts are not switched on yet. Fattixx pays you after each event as before.' };
  if (!(await getActiveStripe())) return { error: 'Payments are not configured yet. Contact Fattixx support.' };
  const base = `${env.APP_URL}/org/${ctx.org.slug}/payouts`;
  let url: string;
  try {
    const accountId = await ensureConnectAccount(ctx.org, ctx.session.user.id);
    url = await onboardingLink(accountId, `${base}?stripe=return`, `${base}?stripe=refresh`);
  } catch (e) {
    console.error('[connect] onboarding failed', e);
    return { error: `Stripe could not start the setup: ${(e as Error).message}` };
  }
  await audit('connect.onboarding.started', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id });
  redirect(url);
}

export async function openStripeDashboard(fd: FormData): Promise<ActionState> {
  let ctx;
  try { ctx = await assertOrg(slugOf(fd), 'org_admin'); } catch (e) { return { error: (e as Error).message }; }
  const active = await getActiveStripe();
  const acct = active ? await getConnectAccount(ctx.org.id, active.mode) : null;
  if (!acct) return { error: 'Set up payouts first.' };
  let url: string;
  try {
    url = await expressDashboardLink(acct.account_id);
  } catch (e) {
    return { error: `Stripe could not open your dashboard: ${(e as Error).message}. Finish the setup first.` };
  }
  await audit('connect.dashboard.opened', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id });
  redirect(url);
}

export async function refreshPayoutStatus(fd: FormData): Promise<ActionState> {
  let ctx;
  try { ctx = await assertOrg(slugOf(fd), 'org_admin'); } catch (e) { return { error: (e as Error).message }; }
  await syncConnectAccount(ctx.org.id);
  revalidatePath(`/org/${ctx.org.slug}/payouts`);
  return { ok: true, message: 'Status updated from Stripe.' };
}
