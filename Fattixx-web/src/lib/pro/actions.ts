'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertSuperAdmin } from '../auth/guard';
import { assertOrg } from '../authz';
import { isStripeConfigured } from '../payments/stripe';
import { createProCheckout, getSubscription, onProEnded, paymentMethodUrl, recomputeProUntil, setCancelAtPeriodEnd, switchInterval } from './subscription';
import { removeDomain } from './domains';
import { isProActive } from './status';
import type { BillingInterval } from './status';

/** Fattixx Pro plan actions: Organization Admins manage billing; Super Admins grant complimentary Pro. */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? '').trim().slice(0, max);
const intervalOf = (fd: FormData): BillingInterval => (str(fd, 'interval', 10) === 'year' ? 'year' : 'month');

function refresh(slug: string) {
  revalidatePath(`/org/${slug}/pro`);
  revalidatePath(`/admin/organizations/${slug}`);
}

export async function startProCheckout(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  const sub = await getSubscription(ctx.org.id);
  if (sub && ['active', 'trialing', 'past_due'].includes(sub.status)) return { error: 'This organization already has a Pro subscription. Manage it below.' };
  if (!(await isStripeConfigured())) return { error: 'Payments are not set up yet. Please contact support.' };
  const interval = intervalOf(fd);
  let url: string;
  try {
    url = await createProCheckout(ctx.org, interval, ctx.session.user.id);
  } catch (e) {
    return { error: `Could not open checkout: ${(e as Error).message}` };
  }
  await audit('pro.checkout.started', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { interval } });
  redirect(url);
}

export async function cancelPro(fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  try { await setCancelAtPeriodEnd(ctx.org.id, true); } catch (e) { return { error: (e as Error).message }; }
  await audit('pro.subscription.canceled', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id });
  refresh(ctx.org.slug);
  return { ok: true };
}

export async function resumePro(fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  try { await setCancelAtPeriodEnd(ctx.org.id, false); } catch (e) { return { error: (e as Error).message }; }
  await audit('pro.subscription.resumed', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id });
  refresh(ctx.org.slug);
  return { ok: true };
}

export async function switchProInterval(fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  const interval = intervalOf(fd);
  try { await switchInterval(ctx.org.id, interval); } catch (e) { return { error: (e as Error).message }; }
  await audit('pro.subscription.switched', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { interval } });
  refresh(ctx.org.slug);
  return { ok: true };
}

export async function updateProCard(fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  let url: string;
  try { url = await paymentMethodUrl(ctx.org); } catch (e) { return { error: (e as Error).message }; }
  redirect(url);
}

/** Super Admin: take a custom domain away from an organization (e.g. a domain dispute reported to support). */
export async function adminReleaseDomain(fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const slug = str(fd, 'org', 64);
  const org = await queryOne<Row & { id: number }>(`SELECT id FROM organizations WHERE slug = ?`, [slug]);
  if (!org) return { error: 'Organization not found.' };
  const host = await removeDomain(Number(org.id));
  if (host) await audit('pro.domain.released', { actorUserId: session.user.id, targetType: 'organization', targetId: org.id, metadata: { host, by: 'staff' } });
  refresh(slug);
  return { ok: true };
}

/** Super Admin: complimentary Pro until a date (blank removes it). Billing is not touched. */
export async function setProComp(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const slug = str(fd, 'org', 64);
  const org = await queryOne<Row & { id: number; pro_until: Date | null }>(`SELECT id, pro_until FROM organizations WHERE slug = ?`, [slug]);
  if (!org) return { error: 'Organization not found.' };
  const raw = str(fd, 'until', 10);
  let until: Date | null = null;
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: 'Choose a date.' };
    until = new Date(`${raw}T23:59:59Z`);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) return { error: 'The date must be in the future.' };
  }
  const wasPro = isProActive(org.pro_until);
  await execute(`UPDATE organizations SET pro_comp_until = ? WHERE id = ?`, [until, org.id]);
  const now = await recomputeProUntil(Number(org.id));
  if (wasPro && !isProActive(now)) await onProEnded(Number(org.id));
  await audit('pro.comp.granted', { actorUserId: session.user.id, targetType: 'organization', targetId: org.id, metadata: { until: raw || null } });
  refresh(slug);
  return { ok: true, message: until ? `Complimentary Pro until ${raw}.` : 'Complimentary Pro removed.' };
}
