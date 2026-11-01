'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { audit } from '../audit';
import { assertOrg } from '../authz';
import { stripeReturnUrl } from '../return-url';
import { getActiveStripe } from './stripe';
import { ensureConnectAccount, expressDashboardLink, getConnectAccount, onboardingClientSecret, onboardingLink, payoutMode, stripeBusinessType, syncConnectAccount } from './connect';

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
  const base = `/org/${ctx.org.slug}/payouts`;
  let url: string;
  try {
    const accountId = await ensureConnectAccount(ctx.org, ctx.session.user.id);
    url = await onboardingLink(accountId, stripeReturnUrl(`${base}?stripe=return`), stripeReturnUrl(`${base}?stripe=refresh`));
  } catch (e) {
    console.error('[connect] onboarding failed', e);
    return { error: `Stripe could not start the setup: ${(e as Error).message}` };
  }
  await audit('connect.onboarding.started', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id });
  redirect(url);
}

/**
 * Embedded onboarding (verification step on /org/<slug>/verify): create the Express account for the organizer type
 * chosen in the form and return a client secret for Stripe's onboarding component. Nothing leaves the page.
 */
export async function startEmbeddedOnboarding(org: string, type: string): Promise<{ clientSecret?: string; error?: string }> {
  let ctx;
  try { ctx = await assertOrg(String(org).slice(0, 64), 'org_admin'); } catch (e) { return { error: (e as Error).message }; }
  if ((await payoutMode()) !== 'connect') return { error: 'Payouts with Stripe are not switched on yet.' };
  if (!(await getActiveStripe())) return { error: 'Payments are not configured yet. Contact Fattixx support.' };
  try {
    const accountId = await ensureConnectAccount(ctx.org, ctx.session.user.id, stripeBusinessType(type));
    const clientSecret = await onboardingClientSecret(accountId);
    await audit('connect.onboarding.started', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { embedded: true, type } });
    return { clientSecret };
  } catch (e) {
    console.error('[connect] embedded onboarding failed', e);
    return { error: `Stripe could not start the setup: ${(e as Error).message}` };
  }
}

/** After the embedded onboarding closes: read the account's state from Stripe. */
export async function finishEmbeddedOnboarding(org: string): Promise<void> {
  const ctx = await assertOrg(String(org).slice(0, 64), 'org_admin');
  await syncConnectAccount(ctx.org.id);
  revalidatePath(`/org/${ctx.org.slug}`, 'layout');
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
