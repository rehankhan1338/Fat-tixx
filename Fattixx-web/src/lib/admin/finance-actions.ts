'use server';

import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertPlatformRole, assertSuperAdmin } from '../auth/guard';
import { TEMPLATES, renderEmailDraft, type TemplateKey } from '../email-templates';
import { BRAND_LOGO_INLINE } from '../brand-logo-inline';
import { getActiveStripe, stripeClient, testStripeKeys } from '../payments/stripe';
import { reconcileWithStripe } from '../payments/reconcile';
import { getBranding, getStripeSettings, saveStripeKeySet, setSetting, setStripeMode, type StripeMode } from '../settings';
import { deleteUpload, saveImageUpload } from '../uploads';
import { isEmail } from '../users';

export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);
const FINANCE = ['super_admin', 'finance'] as const;

// ---------------------------------------------------------------------------
// Payouts / settlement approval
// ---------------------------------------------------------------------------
export async function approveSettlement(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole([...FINANCE]);
  const eventId = Number(fd.get('event_id'));
  const amount = Math.round(Number(str(fd, 'amount', 12)) * 100);
  if (!Number.isInteger(eventId) || !Number.isFinite(amount) || amount <= 0) return { error: 'Enter a positive amount.' };
  const ev = await queryOne<Row & { organization_id: number; currency: string; title: string }>(`SELECT organization_id, currency, title FROM events WHERE id = ?`, [eventId]);
  if (!ev) return { error: 'Event not found.' };
  const r = await execute(
    `INSERT INTO payouts (organization_id, event_id, amount_cents, currency, status, notes, approved_by) VALUES (?, ?, ?, ?, 'approved', ?, ?)`,
    [ev.organization_id, eventId, amount, ev.currency, str(fd, 'notes', 500) || null, session.user.id],
  );
  await audit('payout.approved', { actorUserId: session.user.id, targetType: 'payout', targetId: r.insertId, metadata: { eventId, amount, title: ev.title } });
  revalidatePath('/admin/payouts');
  return { ok: true, message: 'Settlement approved. Record the payout once the money has been sent.' };
}

export async function markPayoutPaid(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole([...FINANCE]);
  const id = Number(fd.get('payout_id'));
  const method = str(fd, 'method', 40);
  const reference = str(fd, 'reference', 120);
  if (!Number.isInteger(id) || !method) return { error: 'Choose how the payout was sent.' };
  const r = await execute(`UPDATE payouts SET status = 'paid', method = ?, reference = ?, paid_by = ?, paid_at = NOW(), notes = COALESCE(NULLIF(?, ''), notes) WHERE id = ? AND status = 'approved'`, [method, reference || null, session.user.id, str(fd, 'notes', 500), id]);
  if (!r.affectedRows) return { error: 'Payout not found or already paid.' };
  await audit('payout.paid', { actorUserId: session.user.id, targetType: 'payout', targetId: id, metadata: { method, reference } });
  revalidatePath('/admin/payouts');
  return { ok: true, message: 'Payout recorded.' };
}

export async function voidPayout(fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole([...FINANCE]);
  const id = Number(fd.get('payout_id'));
  const r = await execute(`UPDATE payouts SET status = 'void' WHERE id = ? AND status = 'approved'`, [id]);
  if (!r.affectedRows) return { error: 'Only approved (unpaid) payouts can be voided.' };
  await audit('payout.voided', { actorUserId: session.user.id, targetType: 'payout', targetId: id });
  revalidatePath('/admin/payouts');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------
export async function updateDispute(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole([...FINANCE]);
  const id = Number(fd.get('dispute_id'));
  const notes = str(fd, 'notes', 2000);
  const due = str(fd, 'evidence_due_at', 25);
  const close = str(fd, 'close', 10);
  const status = str(fd, 'status', 60);
  if (!Number.isInteger(id)) return { error: 'Invalid request.' };
  await execute(
    `UPDATE disputes SET notes = ?, evidence_due_at = ?, status = COALESCE(NULLIF(?, ''), status), closed_at = CASE WHEN ? = '1' THEN COALESCE(closed_at, NOW()) WHEN ? = '0' THEN NULL ELSE closed_at END WHERE id = ?`,
    [notes || null, due ? new Date(due) : null, status, close, close, id],
  );
  await audit('dispute.updated', { actorUserId: session.user.id, targetType: 'dispute', targetId: id, metadata: { status, closed: close } });
  revalidatePath('/admin/disputes');
  return { ok: true };
}

/** Pull open disputes from Stripe so the list is complete even if a webhook was missed. */
export async function syncDisputesFromStripe(): Promise<ActionState> {
  const session = await assertPlatformRole([...FINANCE]);
  const active = await getActiveStripe();
  if (!active) return { error: 'Stripe is not configured.' };
  const s = stripeClient(active.secretKey);
  let imported = 0;
  for await (const d of s.disputes.list({ limit: 100 })) {
    const piId = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id;
    if (!piId) continue;
    const order = await queryOne<Row & { id: number }>(`SELECT id FROM orders WHERE stripe_payment_intent_id = ?`, [piId]);
    if (!order) continue;
    const fee = d.balance_transactions?.reduce((n, bt) => n + Math.abs(bt.fee ?? 0), 0) ?? 0;
    const r = await execute(
      `INSERT INTO disputes (order_id, stripe_dispute_id, amount_cents, fee_cents, reason, status, evidence_due_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), fee_cents = VALUES(fee_cents), evidence_due_at = VALUES(evidence_due_at), closed_at = VALUES(closed_at)`,
      [order.id, d.id, d.amount, fee, d.reason ?? null, d.status, d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null, ['won', 'lost', 'charge_refunded'].includes(d.status) ? new Date() : null],
    );
    if (r.affectedRows) imported++;
  }
  revalidatePath('/admin/disputes');
  await audit('dispute.updated', { actorUserId: session.user.id, metadata: { sync: true, touched: imported } });
  return { ok: true, message: `Synced ${imported} dispute(s) from Stripe (${active.mode} mode).` };
}

// ---------------------------------------------------------------------------
// Reconciliation: compare Stripe payments with our orders for a date range
// ---------------------------------------------------------------------------
export async function runReconciliation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertPlatformRole([...FINANCE]);
  const r = await reconcileWithStripe(Number(str(fd, 'days', 3) || 1), session.user.id);
  if (!r) return { error: 'Stripe is not configured. Add keys under Payments → Stripe keys.' };
  await audit('reconciliation.run', { actorUserId: session.user.id, targetType: 'reconciliation', targetId: r.id, metadata: { days: r.days, discrepancies: r.discrepancies } });
  revalidatePath('/admin/payments');
  return { ok: true, message: r.discrepancies ? `${r.discrepancies} discrepancy(ies) found.` : 'Stripe and Fat Tixx agree for this range.' };
}

// ---------------------------------------------------------------------------
// Stripe keys & mode (Super Admin)
// ---------------------------------------------------------------------------
export async function saveStripeKeys(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const mode = str(fd, 'mode', 4) === 'live' ? 'live' : 'test';
  const secret = str(fd, 'secret_key', 200);
  const publishable = str(fd, 'publishable_key', 200);
  const webhook = str(fd, 'webhook_secret', 200);
  const prefix = mode === 'live' ? 'live' : 'test';
  if (secret && !new RegExp(`^(sk|rk)_${prefix}_`).test(secret)) return { error: `The secret key for ${mode} mode must start with sk_${prefix}_.` };
  if (publishable && !new RegExp(`^pk_${prefix}_`).test(publishable)) return { error: `The publishable key for ${mode} mode must start with pk_${prefix}_.` };
  if (webhook && !webhook.startsWith('whsec_')) return { error: 'The webhook secret must start with whsec_.' };
  const current = (await getStripeSettings())[mode];
  if (secret) {
    const t = await testStripeKeys(secret);
    if (!t.ok) return { error: `Stripe rejected the secret key: ${t.error}` };
    if (t.livemode !== (mode === 'live')) return { error: `That key is a ${t.livemode ? 'live' : 'test'} key; paste it in the ${t.livemode ? 'live' : 'test'} section.` };
  }
  // Blank fields keep the existing value; the literal word "clear" removes it.
  const pick = (v: string, existing: string | null) => (v === 'clear' ? '' : v || existing || '');
  await saveStripeKeySet(mode as StripeMode, { secretKey: pick(secret, current.secretKey), publishableKey: pick(publishable, current.publishableKey), webhookSecret: pick(webhook, current.webhookSecret) }, session.user.id);
  await audit('settings.stripe', { actorUserId: session.user.id, metadata: { mode, secret: !!secret, publishable: !!publishable, webhook: !!webhook } });
  revalidatePath('/admin/payments');
  return { ok: true, message: `${mode === 'live' ? 'Live' : 'Test'} keys saved${secret ? ' and verified with Stripe' : ''}.` };
}

/** Returns a saved Stripe secret in full so a Super Admin can read it after clicking the eye button. Audited. */
export async function revealStripeKey(fd: FormData): Promise<{ error?: string; value?: string }> {
  const session = await assertSuperAdmin();
  const mode: StripeMode = str(fd, 'mode', 4) === 'live' ? 'live' : 'test';
  const field = str(fd, 'field', 12);
  if (field !== 'secret' && field !== 'webhook') return { error: 'Unknown field.' };
  const set = (await getStripeSettings())[mode];
  const value = field === 'secret' ? set.secretKey : set.webhookSecret;
  if (!value) return { error: `No ${mode} ${field === 'secret' ? 'secret key' : 'webhook secret'} saved.` };
  await audit('settings.stripe', { actorUserId: session.user.id, metadata: { mode, revealed: field } });
  return { value };
}

export async function switchStripeMode(fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const mode: StripeMode = str(fd, 'mode', 4) === 'live' ? 'live' : 'test';
  const s = await getStripeSettings();
  if (!s[mode].secretKey || !s[mode].publishableKey) return { error: `Add the ${mode} secret and publishable keys before switching.` };
  await setStripeMode(mode, session.user.id);
  await audit('settings.stripe', { actorUserId: session.user.id, metadata: { switched_to: mode } });
  revalidatePath('/admin/payments');
  revalidatePath('/admin/settings');
  return { ok: true, message: mode === 'live' ? 'LIVE mode: real cards will be charged.' : 'Test mode: sandbox payments only.' };
}

export async function testStripeConnection(fd: FormData): Promise<ActionState> {
  await assertSuperAdmin();
  const mode: StripeMode = str(fd, 'mode', 4) === 'live' ? 'live' : 'test';
  const set = (await getStripeSettings())[mode];
  if (!set.secretKey) return { error: `No ${mode} secret key saved.` };
  const t = await testStripeKeys(set.secretKey);
  return t.ok ? { ok: true, message: `Connected to Stripe account “${t.account}” (${t.livemode ? 'live' : 'test'} mode).` } : { error: t.error };
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------
export async function saveBranding(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const name = str(fd, 'platform_name', 60);
  const color = str(fd, 'brand_color', 7).toLowerCase();
  const supportEmail = str(fd, 'support_email', 254);
  if (name.length < 2) return { error: 'Enter the platform name.' };
  if (!/^#[0-9a-f]{6}$/.test(color)) return { error: 'Choose a colour (hex, e.g. #f59e0b).' };
  if (!isEmail(supportEmail)) return { error: 'Enter a valid support email.' };
  const brand = await getBranding();
  let logoPath = brand.logoPath ?? '';
  const logo = fd.get('logo');
  if (logo instanceof File && logo.size > 0) {
    try { const p = await saveImageUpload(logo, 'orgs', 400); await deleteUpload(logoPath); logoPath = p; } catch (e) { return { error: (e as Error).message }; }
  } else if (fd.get('remove_logo')) { await deleteUpload(logoPath); logoPath = ''; }
  await setSetting('platform_name', name, session.user.id);
  await setSetting('brand_color', color, session.user.id);
  await setSetting('support_email', supportEmail, session.user.id);
  await setSetting('brand_logo_path', logoPath, session.user.id);
  await audit('settings.branding', { actorUserId: session.user.id, metadata: { name, color, logo: !!logoPath } });
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Branding saved. It applies to the site, panels and emails.' };
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------
function isTemplateKey(k: string): k is TemplateKey { return TEMPLATES.some((t) => t.key === k); }

export async function saveEmailTemplate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const key = str(fd, 'key', 64);
  const subject = str(fd, 'subject', 255);
  const body = String(fd.get('body_html') ?? '').trim().slice(0, 50_000);
  if (!isTemplateKey(key)) return { error: 'Unknown template.' };
  if (subject.length < 3 || body.length < 10) return { error: 'Enter a subject and a body.' };
  if (/<script|javascript:|on\w+=/i.test(body)) return { error: 'Scripts and event handlers are not allowed in templates.' };
  await execute(`INSERT INTO email_templates (\`key\`, subject, body_html, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE subject = VALUES(subject), body_html = VALUES(body_html), updated_by = VALUES(updated_by)`, [key, subject, body, session.user.id]);
  await audit('email_template.updated', { actorUserId: session.user.id, targetType: 'email_template', targetId: key });
  revalidatePath('/admin/emails/templates');
  return { ok: true, message: 'Template saved.' };
}

export async function resetEmailTemplate(fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const key = str(fd, 'key', 64);
  if (!isTemplateKey(key)) return { error: 'Unknown template.' };
  await execute(`DELETE FROM email_templates WHERE \`key\` = ?`, [key]);
  await audit('email_template.reset', { actorUserId: session.user.id, targetType: 'email_template', targetId: key });
  revalidatePath('/admin/emails/templates');
  return { ok: true, message: 'Template reset to default.' };
}

/** Live preview for the editor (renders unsaved subject/body with sample data). */
export async function previewEmailTemplate(key: string, subject: string, body: string): Promise<{ subject: string; html: string } | { error: string }> {
  await assertSuperAdmin();
  if (!isTemplateKey(key)) return { error: 'Unknown template.' };
  const brand = await getBranding();
  // The preview is shown in a sandboxed iframe on the admin origin, whose CSP only allows images from itself, data: URIs and the
  // public site (APP_URL). The default wordmark is embedded as a data: URI so the preview never depends on APP_URL being set or
  // on the public site being up; an uploaded logo (Vercel Blob / public site) is shown from its real URL, as in the sent email.
  const logo = brand.logoPath ? undefined : BRAND_LOGO_INLINE;
  const { subject: renderedSubject, html } = await renderEmailDraft(key, subject, body, { brand, logo });
  return { subject: renderedSubject, html };
}
