'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { BOT_MESSAGE, CAPTCHA_MESSAGE, humanCheck, rateLimited } from '../security/bot';
import { findTrackingLink } from '../marketing/queries';
import { isAdmitted } from '../queue';
import { revalidatePath } from 'next/cache';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { env } from '../env';
import { assertOrg, canAccessEvent, listMemberships } from '../authz';
import { eventUnlocked } from '../events/password';
import { getSession } from '../auth/session';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { formatCents } from '../money';
import { clientIp } from '../request';
import { ipIsThrottled } from '../security/rate-limit';
import { formatEventDate, wallClockToUtc } from '../tz';
import { createOneTimeToken } from '../tokens';
import { isEmail } from '../users';
import { getEvent, getPublicEventBySlug, listQuestions, questionOptions } from '../events/queries';
import { getActiveStripe, getStripe } from '../payments/stripe';
import { CheckoutError, attendeeMayRequestRefund, createPendingOrder, finalizePaidOrder, returnAddonInventory, sendOrderConfirmation, type AnswerInput, type Attribution } from './checkout';
import { completeFreeOrderNow, confirmPaidOrderWithStripe, createPaymentIntentForOrder } from './payment';
import { getOrderByCode, getTicketByCode, type OrderRow } from './queries';
import { TransferError, heldByRecipient, holderMayTransfer, listTransferHolders, sendTransferEmail, transferTicket } from './transfer';
import { returnInventoryForTickets } from './manage-actions';
import { orgMail, withOrgMail } from '../pro/white-label';
import { canAccessOrder, rememberOrderAccess } from './access';

export type ActionState = { error?: string; ok?: boolean; message?: string; checkoutUrl?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);

/** Promoter link / UTM attribution carried by the event page (hidden fields) or the /r/<code> cookie. */
async function attributionFrom(fd: FormData, organizationId: number, eventId: number): Promise<Attribution> {
  const store = await cookies();
  let ref = str(fd, 'ref', 40) || null;
  let utm = { utmSource: str(fd, 'utm_source', 80) || null, utmMedium: str(fd, 'utm_medium', 80) || null, utmCampaign: str(fd, 'utm_campaign', 120) || null };
  if (!ref && !utm.utmSource) {
    try {
      const c = JSON.parse(store.get('fx_ref')?.value ?? 'null') as { ref?: string; s?: string; m?: string; c?: string } | null;
      if (c) { ref = c.ref ?? null; utm = { utmSource: c.s ?? null, utmMedium: c.m ?? null, utmCampaign: c.c ?? null }; }
    } catch { /* ignore */ }
  }
  let trackingLinkId: number | null = null;
  if (ref) {
    const link = await findTrackingLink(ref);
    // Only this organization's active links, and only for their event (or any event when the link has none).
    if (link && link.active && Number(link.organization_id) === organizationId && (!link.event_id || Number(link.event_id) === eventId)) {
      trackingLinkId = Number(link.id);
      utm = { utmSource: utm.utmSource ?? link.utm_source, utmMedium: utm.utmMedium ?? link.utm_medium, utmCampaign: utm.utmCampaign ?? link.utm_campaign };
    }
  }
  return { trackingLinkId, ...utm, channel: str(fd, 'channel', 10) === 'embed' ? 'embed' : 'web' };
}

// ---------------------------------------------------------------------------
// Public checkout
// ---------------------------------------------------------------------------
export async function startCheckout(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const eventSlug = str(fd, 'event', 120);
  const ip = await clientIp();
  if (await ipIsThrottled(ip) || rateLimited(`checkout:${ip}`, 30, 10 * 60_000)) return { error: 'Too many attempts from this network. Please try again later.' };
  const bot = await humanCheck(fd, ip);
  if (bot) return { error: bot === 'captcha' ? CAPTCHA_MESSAGE : BOT_MESSAGE };
  const lines: { ticketTypeId: number; quantity: number }[] = [];
  const addons: { addonId: number; quantity: number }[] = [];
  for (const [k, v] of fd.entries()) {
    const m = k.match(/^qty_(\d+)$/);
    if (m) { const q = Number(v); if (Number.isInteger(q) && q > 0) lines.push({ ticketTypeId: Number(m[1]), quantity: Math.min(q, 100) }); }
    const a = k.match(/^addon_(\d+)$/);
    if (a) { const q = Number(v); if (Number.isInteger(q) && q > 0) addons.push({ addonId: Number(a[1]), quantity: Math.min(q, 100) }); }
  }
  // Reserved seating: one `seat` field per seat picked on the map.
  const seatIds = fd.getAll('seat').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (lines.length === 0 && seatIds.length === 0) return { error: 'Choose at least one ticket.' };
  const email = str(fd, 'email', 254);
  const name = str(fd, 'name', 160);
  if (!isEmail(email)) return { error: 'Enter a valid email address so we can send your tickets.' };
  if (name.length < 2) return { error: 'Enter your name.' };

  // Checkout questions: validate required ones and snapshot the labels.
  const event = await getPublicEventBySlug(eventSlug);
  if (!event) return { error: 'Event not found.' };
  const session = await getSession();
  // Event password (plan 5.6): enforced here too, not only on the page. The organizer's team is exempt, as on the page.
  if (event.access_password && !(await eventUnlocked(event))) {
    const isTeam = !!session && (await listMemberships(session.user.id)).some((m) => Number(m.organization_id) === Number(event.organization_id));
    if (!isTeam) return { error: 'This event is password protected. Reload the page and enter the password.' };
  }
  if (event.queue_enabled && !(await isAdmitted(event.id))) return { error: 'Your turn in the waiting room has expired. Reload the page to rejoin the line.' };
  const answers: AnswerInput[] = [];
  for (const q of await listQuestions(event.id)) {
    const raw = str(fd, `q_${q.id}`, 1000);
    const value = q.kind === 'checkbox' ? (raw ? 'Yes' : '') : raw;
    if (q.kind === 'select' && value && !questionOptions(q).includes(value)) return { error: `Choose one of the options for “${q.label}”.` };
    if (q.required && !value) return { error: q.kind === 'checkbox' ? `Please confirm “${q.label}”.` : `Please answer “${q.label}”.` };
    if (value) answers.push({ questionId: Number(q.id), label: q.label, answer: value });
  }

  const attribution = await attributionFrom(fd, Number(event.organization_id), event.id);
  let r: Awaited<ReturnType<typeof createPendingOrder>>;
  try {
    r = await createPendingOrder({
      eventSlug, lines, seatIds, addons, answers, accessCode: str(fd, 'access_code', 40) || null, promoCode: str(fd, 'promo_code', 40) || null,
      email, name, phone: str(fd, 'phone', 40), marketingOptIn: !!fd.get('marketing'), smsOptIn: !!fd.get('sms'), userId: session?.user.id ?? null, ip, attribution,
    });
  } catch (e) {
    if (e instanceof CheckoutError) return { error: e.message };
    throw e;
  }
  await audit('order.created', { actorUserId: session?.user.id ?? null, targetType: 'order', targetId: r.orderId, metadata: { code: r.code, total: r.totalCents, discount: r.discountCents, channel: attribution.channel } });
  // Embedded widget: checkout continues in a new top-level tab (cookies set inside a third-party iframe are usually blocked).
  if (attribution.channel === 'embed') return { ok: true, checkoutUrl: `/api/embed/continue?code=${encodeURIComponent(r.code)}&t=${encodeURIComponent(r.accessToken)}` };
  await rememberOrderAccess(r.code, r.accessToken);
  redirect(`/checkout/${r.code}`);
}

/** Free orders (total 0) complete without Stripe. */
export async function completeFreeOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const code = str(fd, 'code', 12);
  const order = await getOrderByCode(code);
  if (!order || !(await canAccessOrder(order))) return { error: 'Order not found.' };
  if (order.status !== 'pending') redirect(`/orders/${order.code}`);
  const r = await completeFreeOrderNow(order);
  if (!r.ok) return { error: r.error };
  redirect(`/orders/${order.code}`);
}

/** Create (or reuse) the Stripe PaymentIntent for a pending order. Returns the client secret. */
export async function createPaymentIntent(code: string): Promise<{ clientSecret?: string; error?: string; publishableKey?: string }> {
  const order = await getOrderByCode(code);
  if (!order || !(await canAccessOrder(order))) return { error: 'Order not found.' };
  return createPaymentIntentForOrder(order);
}

/** Called by the client right after Stripe confirms; verifies with Stripe (webhook also does this). */
export async function confirmPaymentClientSide(code: string): Promise<{ ok: boolean; error?: string }> {
  const order = await getOrderByCode(code);
  if (!order || !(await canAccessOrder(order))) return { ok: false, error: 'Order not found.' };
  return confirmPaidOrderWithStripe(order);
}

// ---------------------------------------------------------------------------
// Find my tickets (magic link by email)
// ---------------------------------------------------------------------------
export async function requestTicketsLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = str(fd, 'email', 254);
  const ip = await clientIp();
  if (await ipIsThrottled(ip)) return { error: 'Too many attempts from this network. Please try again later.' };
  const done: ActionState = { ok: true, message: 'If we have tickets for that email, a link is on its way.' };
  if (!isEmail(email)) return done;
  const has = await queryOne(
    `SELECT 1 FROM orders WHERE buyer_email = ? AND status IN ('paid','partially_refunded')
     UNION ALL SELECT 1 FROM tickets WHERE attendee_email = ? AND transferred_from_id IS NOT NULL AND status IN ('valid','used') LIMIT 1`,
    [email.toLowerCase(), email.toLowerCase()],
  );
  if (!has) return done;
  const token = await createOneTimeToken('find_tickets', email, null, null);
  const url = `${env.APP_URL}/tickets/list?token=${token}`;
  const mail = await renderEmail('tickets_link', { url });
  await sendEmail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
  return done;
}

// ---------------------------------------------------------------------------
// Attendee: refund request, name edit
// ---------------------------------------------------------------------------
export async function requestRefund(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const order = await getOrderByCode(str(fd, 'code', 12));
  if (!order || !(await canAccessOrder(order, str(fd, 'token', 200) || null))) return { error: 'Order not found.' };
  if (!attendeeMayRequestRefund(order)) return { error: 'This order is not eligible for a refund under the event’s policy.' };
  if (order.total_cents === 0) {
    // Nothing to refund: release the free tickets so others can take them.
    const live = (await query<Row & { id: number }>(`SELECT id FROM tickets WHERE order_id = ? AND status IN ('valid','used')`, [order.id])).map((r) => Number(r.id));
    await execute(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [order.id]);
    await execute(`UPDATE tickets SET status = 'cancelled' WHERE order_id = ? AND status IN ('valid','used')`, [order.id]);
    await returnInventoryForTickets(live);
    await audit('order.cancelled', { actorUserId: order.user_id, targetType: 'order', targetId: order.id, metadata: { by: 'attendee', free: true } });
    revalidatePath(`/orders/${order.code}`);
    return { ok: true, message: 'Your free tickets have been released.' };
  }
  const r = await refundOrderInternal(order, order.total_cents, 'Attendee refund request (policy allows)', order.user_id, 'full');
  if (r.error) return { error: r.error };
  await audit('order.refunded', { actorUserId: order.user_id, targetType: 'order', targetId: order.id, metadata: { by: 'attendee', amount: order.total_cents } });
  revalidatePath(`/orders/${order.code}`);
  return { ok: true, message: 'Your refund has been issued. It can take 5–10 business days to appear on your statement.' };
}

export async function updateAttendeeName(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const order = await getOrderByCode(str(fd, 'code', 12));
  if (!order || !(await canAccessOrder(order, str(fd, 'token', 200) || null))) return { error: 'Order not found.' };
  const ticketId = Number(fd.get('ticket_id'));
  const name = str(fd, 'attendee_name', 160);
  if (name.length < 2) return { error: 'Enter the attendee name.' };
  // A ticket the buyer transferred away belongs to its recipient now; the buyer cannot rename it.
  const r = await execute(
    `UPDATE tickets SET attendee_name = ? WHERE id = ? AND order_id = ? AND status = 'valid' AND NOT (transferred_from_id IS NOT NULL AND LOWER(COALESCE(attendee_email, '')) <> LOWER(?))`,
    [name, ticketId, order.id, order.buyer_email],
  );
  if (!r.affectedRows) return { error: 'Ticket not found or already used.' };
  await audit('order.attendee_updated', { actorUserId: order.user_id, targetType: 'ticket', targetId: ticketId });
  revalidatePath(`/orders/${order.code}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ticket transfers (holder-initiated: event must allow it; staff can always transfer)
// ---------------------------------------------------------------------------
function transferRecipient(fd: FormData): { toName: string; toEmail: string; note: string } | { error: string } {
  const toName = str(fd, 'to_name', 160), toEmail = str(fd, 'to_email', 254).toLowerCase(), note = str(fd, 'note', 300);
  if (toName.length < 2) return { error: 'Enter the recipient’s name.' };
  if (!isEmail(toEmail)) return { error: 'Enter a valid email address for the recipient.' };
  return { toName, toEmail, note };
}

async function runTransfer(input: Parameters<typeof transferTicket>[0], auditMeta: Record<string, unknown>): Promise<ActionState> {
  try {
    const r = await transferTicket(input);
    await audit('ticket.transferred', { actorUserId: input.actorUserId, targetType: 'ticket', targetId: input.ticketId, metadata: { ...auditMeta, by: input.initiatedBy, newTicketId: r.newTicketId, to: input.toEmail } });
    return { ok: true, message: `Ticket sent to ${input.toEmail}. The old QR code no longer works.` };
  } catch (e) {
    if (e instanceof TransferError) return { error: e.message };
    throw e;
  }
}

/** Buyer transfers a ticket from their order page. */
export async function transferTicketFromOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (await ipIsThrottled(await clientIp())) return { error: 'Too many attempts from this network. Please try again later.' };
  const order = await getOrderByCode(str(fd, 'code', 12));
  if (!order || !(await canAccessOrder(order, str(fd, 'token', 200) || null))) return { error: 'Order not found.' };
  const blocked = holderMayTransfer(order);
  if (blocked) return { error: blocked };
  const rcpt = transferRecipient(fd);
  if ('error' in rcpt) return rcpt;
  const ticketId = Number(fd.get('ticket_id'));
  const t = await queryOne<Row & { transferred_from_id: number | null; attendee_email: string | null }>(`SELECT transferred_from_id, attendee_email FROM tickets WHERE id = ? AND order_id = ?`, [ticketId, order.id]);
  if (!t) return { error: 'Ticket not found.' };
  if (heldByRecipient(t, order.buyer_email)) return { error: 'This ticket now belongs to the person you sent it to.' };
  const r = await runTransfer({ ticketId, orderId: order.id, ...rcpt, initiatedBy: 'holder', actorUserId: order.user_id }, { order: order.code });
  if (r?.ok) { revalidatePath(`/orders/${order.code}`); revalidatePath(`/org/${order.org_slug}/events/${order.event_id}`); }
  return r;
}

/** Current holder transfers from the full-screen ticket page (proves possession with the ticket link key). */
export async function transferTicketFromLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (await ipIsThrottled(await clientIp())) return { error: 'Too many attempts from this network. Please try again later.' };
  const key = str(fd, 'k', 64);
  const t = await getTicketByCode(str(fd, 'ticket', 12).toUpperCase());
  if (!t || key.length < 12 || !t.secret.startsWith(key)) return { error: 'Ticket not found.' };
  const blocked = holderMayTransfer({ allow_transfers: t.allow_transfers, status: t.status, event_status: t.event_status, event_starts_at: t.event_starts_at });
  if (blocked) return { error: blocked };
  const rcpt = transferRecipient(fd);
  if ('error' in rcpt) return rcpt;
  const r = await runTransfer({ ticketId: t.ticket_id, orderId: t.ticket_order_id, ...rcpt, initiatedBy: 'holder', actorUserId: null }, { order: t.order_code, via: 'ticket_link' });
  if (r?.ok) { revalidatePath(`/t/${t.ticket_code}`); revalidatePath(`/org/${t.org_slug}/events/${t.event_id}`); }
  return r;
}

/** Organizer transfers a ticket (any event, regardless of the attendee transfer setting). */
export async function staffTransferTicket(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadOrderForStaff(fd); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, order } = loaded;
  if (!['paid', 'partially_refunded'].includes(order.status)) return { error: 'Only tickets on a paid order can be transferred.' };
  const rcpt = transferRecipient(fd);
  if ('error' in rcpt) return rcpt;
  const r = await runTransfer({ ticketId: Number(fd.get('ticket_id')), orderId: order.id, ...rcpt, initiatedBy: 'staff', actorUserId: ctx.session.user.id }, { order: order.code });
  if (r?.ok) {
    revalidatePath(`/org/${ctx.org.slug}/orders/${order.code}`);
    revalidatePath(`/org/${ctx.org.slug}/events/${order.event_id}`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Organizer / admin: refunds, resend, attendee edits, comps & box office
// ---------------------------------------------------------------------------
async function refundOrderInternal(order: OrderRow, amountCents: number, reason: string, initiatedBy: number | null, kind: 'full' | 'partial' | 'bulk_cancellation'): Promise<{ error?: string; refundId?: number }> {
  if (!['paid', 'partially_refunded'].includes(order.status)) return { error: 'Only paid orders can be refunded.' };
  const remaining = order.total_cents - order.refunded_cents;
  if (amountCents <= 0 || amountCents > remaining) return { error: `Refund must be between $0.01 and ${formatCents(remaining, order.currency)}.` };
  const r = await execute(`INSERT INTO refunds (order_id, amount_cents, reason, initiated_by, kind) VALUES (?, ?, ?, ?, ?)`, [order.id, amountCents, reason, initiatedBy, kind]);
  const refundId = r.insertId;
  let stripeRefundId: string | null = null;
  if (order.stripe_payment_intent_id && order.total_cents > 0) {
    const active = await getActiveStripe();
    if (!active) { await execute(`UPDATE refunds SET status = 'failed' WHERE id = ?`, [refundId]); return { error: 'Stripe is not configured; cannot refund card payments.' }; }
    try {
      const { stripe: s } = await getStripe();
      // Stripe Connect orders: take the organizer's share of the refund back from their account (in proportion).
      const sr = await s.refunds.create({ payment_intent: order.stripe_payment_intent_id, amount: amountCents, ...(order.connect_account_id ? { reverse_transfer: true } : {}), metadata: { order_code: order.code, refund_id: String(refundId) } }, { idempotencyKey: `refund-${refundId}` });
      stripeRefundId = sr.id;
    } catch (e) {
      await execute(`UPDATE refunds SET status = 'failed' WHERE id = ?`, [refundId]);
      return { error: `Stripe refused the refund: ${(e as Error).message}` };
    }
  }
  const fullyRefunded = order.refunded_cents + amountCents >= order.total_cents;
  await execute(`UPDATE refunds SET status = 'succeeded', stripe_refund_id = ? WHERE id = ?`, [stripeRefundId, refundId]);
  await execute(`UPDATE orders SET refunded_cents = refunded_cents + ?, status = ? WHERE id = ?`, [amountCents, fullyRefunded ? 'refunded' : 'partially_refunded', order.id]);
  if (fullyRefunded) {
    // Void the tickets that were still live and give their seats back.
    const live = (await query<Row & { id: number }>(`SELECT id FROM tickets WHERE order_id = ? AND status IN ('valid','used')`, [order.id])).map((r) => Number(r.id));
    await execute(`UPDATE tickets SET status = 'refunded' WHERE order_id = ? AND status IN ('valid','used')`, [order.id]);
    await returnInventoryForTickets(live);
    await returnAddonInventory(order.id);
  }
  const when = formatEventDate(new Date(order.event_starts_at), order.event_timezone);
  const wl = await orgMail(Number(order.organization_id));
  const mail = await renderEmail('refund_issued', { amount: formatCents(amountCents, order.currency), order_code: order.code, event_title: order.event_title, event_when: when, reason, tickets_note: fullyRefunded ? 'The tickets on this order are no longer valid.' : 'Your remaining tickets stay valid.' }, withOrgMail({}, wl));
  await sendEmail({ to: order.buyer_email, toName: order.buyer_name, subject: mail.subject, text: mail.text, html: mail.html, envelope: wl?.envelope, related: { type: 'order', id: order.id } });
  return { refundId };
}

async function loadOrderForStaff(fd: FormData, needRefund = false) {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'organizer');
  const order = await getOrderByCode(str(fd, 'code', 12));
  if (!order || order.organization_id !== ctx.org.id) throw new Error('Order not found');
  const event = await getEvent(ctx.org.id, order.event_id);
  if (!event || !(await canAccessEvent(ctx, event))) throw new Error('Order not found');
  if (needRefund && !ctx.perms.canRefund) throw new Error('You are not allowed to issue refunds.');
  return { ctx, order, event };
}

export async function refundOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadOrderForStaff(fd, true); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, order } = loaded;
  const reason = str(fd, 'reason', 300);
  if (reason.length < 3) return { error: 'Enter a reason for the refund.' };
  const full = str(fd, 'mode', 10) !== 'partial';
  const amount = full ? order.total_cents - order.refunded_cents : Math.round(Number(str(fd, 'amount', 12)) * 100);
  const r = await refundOrderInternal(order, amount, reason, ctx.session.user.id, full ? 'full' : 'partial');
  if (r.error) return { error: r.error };
  await audit('order.refunded', { actorUserId: ctx.session.user.id, targetType: 'order', targetId: order.id, metadata: { amount, full, reason } });
  revalidatePath(`/org/${ctx.org.slug}/orders/${order.code}`);
  revalidatePath(`/org/${ctx.org.slug}/events/${order.event_id}`);
  return { ok: true, message: `Refunded ${formatCents(amount, order.currency)}.` };
}

export async function resendOrderTickets(fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadOrderForStaff(fd); } catch (e) { return { error: (e as Error).message }; }
  if (!['paid', 'partially_refunded'].includes(loaded.order.status)) return { error: 'Only paid orders have tickets to send.' };
  await sendOrderConfirmation(loaded.order.id, { resend: true });
  // Tickets transferred to someone else go to their current holder, not the buyer.
  const received = await query<Row & { id: number; attendee_email: string }>(
    `SELECT id, attendee_email FROM tickets WHERE order_id = ? AND status = 'valid' AND transferred_from_id IS NOT NULL AND attendee_email IS NOT NULL AND LOWER(attendee_email) <> LOWER(?)`,
    [loaded.order.id, loaded.order.buyer_email],
  );
  for (const t of received) await sendTransferEmail(Number(t.id), null);
  await audit('order.tickets_resent', { actorUserId: loaded.ctx.session.user.id, targetType: 'order', targetId: loaded.order.id, metadata: { recipients: received.map((t) => t.attendee_email) } });
  const others = new Set(received.map((t) => t.attendee_email.toLowerCase()));
  return { ok: true, message: `Tickets re-sent to ${loaded.order.buyer_email}${others.size ? ` and ${others.size} transfer recipient${others.size === 1 ? '' : 's'}` : ''}.` };
}

export async function staffUpdateAttendee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadOrderForStaff(fd); } catch (e) { return { error: (e as Error).message }; }
  const ticketId = Number(fd.get('ticket_id'));
  const name = str(fd, 'attendee_name', 160);
  const email = str(fd, 'attendee_email', 254);
  if (email && !isEmail(email)) return { error: 'Invalid attendee email.' };
  const r = await execute(`UPDATE tickets SET attendee_name = ?, attendee_email = ? WHERE id = ? AND order_id = ?`, [name || null, email || null, ticketId, loaded.order.id]);
  if (!r.affectedRows) return { error: 'Ticket not found.' };
  if (fd.get('buyer_email')) {
    const be = str(fd, 'buyer_email', 254);
    if (!isEmail(be)) return { error: 'Invalid buyer email.' };
    await execute(`UPDATE orders SET buyer_email = ?, buyer_name = ? WHERE id = ?`, [be.toLowerCase(), str(fd, 'buyer_name', 160) || null, loaded.order.id]);
  }
  await audit('order.attendee_updated', { actorUserId: loaded.ctx.session.user.id, targetType: 'ticket', targetId: ticketId });
  revalidatePath(`/org/${loaded.ctx.org.slug}/orders/${loaded.order.code}`);
  revalidatePath(`/org/${loaded.ctx.org.slug}/events/${loaded.order.event_id}`);
  return { ok: true };
}

/** Complimentary tickets or a box-office (door) sale, issued by staff without online payment. */
export async function issueStaffOrder(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'organizer');
  const event = await getEvent(ctx.org.id, Number(fd.get('event_id')));
  if (!event || !(await canAccessEvent(ctx, event))) return { error: 'Event not found.' };
  const source = str(fd, 'source', 20) === 'box_office' ? 'box_office' : 'complimentary';
  const email = str(fd, 'email', 254), name = str(fd, 'name', 160);
  if (!isEmail(email)) return { error: 'Enter the attendee’s email.' };
  if (name.length < 2) return { error: 'Enter the attendee’s name.' };
  const ticketTypeId = Number(fd.get('ticket_type_id')); const qty = Number(fd.get('quantity'));
  if (!Number.isInteger(ticketTypeId) || !Number.isInteger(qty) || qty < 1 || qty > 50) return { error: 'Choose a ticket type and quantity (1–50).' };
  try {
    const r = await createPendingOrder({ eventSlug: event.slug, lines: [{ ticketTypeId, quantity: qty }], email, name, marketingOptIn: false, userId: null, ip: await clientIp(), source, createdBy: ctx.session.user.id, bypassSalesWindow: true });
    await finalizePaidOrder(r.orderId, {});
    if (source === 'box_office') await execute(`UPDATE orders SET paid_at = NOW() WHERE id = ?`, [r.orderId]);
    await audit(source === 'box_office' ? 'order.box_office' : 'order.comp_issued', { actorUserId: ctx.session.user.id, targetType: 'order', targetId: r.orderId, metadata: { qty, ticketTypeId, email } });
    revalidatePath(`/org/${orgSlug}/events/${event.id}`);
    return { ok: true, message: `${qty} ticket(s) issued to ${email}. Order ${r.code}.` };
  } catch (e) {
    if (e instanceof CheckoutError) return { error: e.message };
    if ((e as Error).message === 'OVERSOLD') return { error: 'Not enough inventory left.' };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Cancel / postpone event (bulk refund + bulk notification)
// ---------------------------------------------------------------------------
export async function cancelEvent(fd: FormData): Promise<ActionState> {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'org_admin');
  const event = await getEvent(ctx.org.id, Number(fd.get('event_id')));
  if (!event) return { error: 'Event not found.' };
  const reason = str(fd, 'reason', 500);
  if (reason.length < 5) return { error: 'Enter the reason shown to attendees.' };
  await execute(`UPDATE events SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = ? WHERE id = ?`, [reason, event.id]);
  await execute(`UPDATE orders SET status = 'expired' WHERE event_id = ? AND status = 'pending'`, [event.id]);
  const orders = await query<Row & { code: string }>(`SELECT code FROM orders WHERE event_id = ? AND status IN ('paid','partially_refunded')`, [event.id]);
  const holders = await listTransferHolders(event.id); // read before their tickets are cancelled below
  let refunded = 0, failed = 0;
  for (const o of orders) {
    const order = await getOrderByCode(o.code);
    if (!order) continue;
    const remaining = order.total_cents - order.refunded_cents;
    if (remaining > 0) {
      const r = await refundOrderInternal(order, remaining, `Event cancelled: ${reason}`, ctx.session.user.id, 'bulk_cancellation');
      if (r.error) failed++; else refunded++;
    } else {
      const live = (await query<Row & { id: number }>(`SELECT id FROM tickets WHERE order_id = ? AND status IN ('valid','used')`, [order.id])).map((r) => Number(r.id));
      await execute(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [order.id]);
      await execute(`UPDATE tickets SET status = 'cancelled' WHERE order_id = ? AND status IN ('valid','used')`, [order.id]);
      await returnInventoryForTickets(live);
      await returnAddonInventory(order.id);
      const mail = await renderEmail('event_cancelled', { event_title: order.event_title, reason });
      await sendEmail({ to: order.buyer_email, toName: order.buyer_name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'order', id: order.id } });
    }
  }
  if (holders.length) {
    const mail = await renderEmail('event_cancelled', { event_title: event.title, reason });
    for (const h of holders) await sendEmail({ to: h.email, toName: h.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'event', id: event.id } });
  }
  await audit('event.cancelled', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { orders: orders.length, refunded, failed, reason, transferHolders: holders.length } });
  revalidatePath(`/org/${orgSlug}/events/${event.id}`); revalidatePath(`/org/${orgSlug}/events`); revalidatePath(`/events/${event.slug}`); revalidatePath('/');
  return failed ? { error: `Event cancelled. ${refunded} refunds issued, ${failed} failed (see Orders).` } : { ok: true, message: `Event cancelled. ${refunded} orders refunded.` };
}

export async function postponeEvent(fd: FormData): Promise<ActionState> {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'org_admin');
  const event = await getEvent(ctx.org.id, Number(fd.get('event_id')));
  if (!event) return { error: 'Event not found.' };
  const message = str(fd, 'message', 2000);
  if (message.length < 5) return { error: 'Enter the message sent to attendees.' };
  const newStartRaw = str(fd, 'new_starts_at', 25);
  const newStart = newStartRaw ? wallClockToUtc(newStartRaw, event.timezone) : null;
  if (newStartRaw && !newStart) return { error: 'The new date is invalid.' };
  if (newStart) {
    const shift = newStart.getTime() - new Date(event.starts_at).getTime();
    await execute(`UPDATE events SET status = 'published', starts_at = ?, ends_at = CASE WHEN ends_at IS NULL THEN NULL ELSE ends_at + INTERVAL ? SECOND END, doors_at = CASE WHEN doors_at IS NULL THEN NULL ELSE doors_at + INTERVAL ? SECOND END WHERE id = ?`, [newStart, Math.round(shift / 1000), Math.round(shift / 1000), event.id]);
  } else {
    await execute(`UPDATE events SET status = 'postponed' WHERE id = ?`, [event.id]);
  }
  const buyers = await query<Row & { buyer_email: string; buyer_name: string | null; id: number }>(`SELECT id, buyer_email, buyer_name FROM orders WHERE event_id = ? AND status IN ('paid','partially_refunded')`, [event.id]);
  const whenText = newStart ? `New date: ${formatEventDate(newStart, event.timezone)}. Your existing tickets remain valid.` : 'A new date will be announced. Your existing tickets remain valid.';
  const mail = await renderEmail('event_postponed', { event_title: event.title, message, when_text: whenText });
  for (const b of buyers) {
    await sendEmail({ to: b.buyer_email, toName: b.buyer_name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'order', id: b.id } });
  }
  const holders = await listTransferHolders(event.id);
  for (const h of holders) await sendEmail({ to: h.email, toName: h.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'event', id: event.id } });
  await audit('event.postponed', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { newStart: newStart?.toISOString() ?? null, notified: buyers.length + holders.length } });
  revalidatePath(`/org/${orgSlug}/events/${event.id}`); revalidatePath(`/events/${event.slug}`); revalidatePath('/');
  return { ok: true, message: `${buyers.length + holders.length} ticket holders notified.` };
}

/** Organizer broadcast to all ticket holders (transactional event update, not marketing). */
export async function emailAttendees(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'organizer');
  const event = await getEvent(ctx.org.id, Number(fd.get('event_id')));
  if (!event || !(await canAccessEvent(ctx, event))) return { error: 'Event not found.' };
  const subject = str(fd, 'subject', 200), body = str(fd, 'body', 5000);
  if (subject.length < 3 || body.length < 10) return { error: 'Enter a subject and a message.' };
  const buyers = await query<Row & { buyer_email: string; buyer_name: string | null; id: number }>(`SELECT id, buyer_email, buyer_name FROM orders WHERE event_id = ? AND status IN ('paid','partially_refunded')`, [event.id]);
  const mail = await renderEmail('organizer_update', { event_title: event.title, subject, body_html: body.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string).replace(/\n/g, '<br>') });
  for (const b of buyers) await sendEmail({ to: b.buyer_email, toName: b.buyer_name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'event', id: event.id } });
  const holders = await listTransferHolders(event.id);
  for (const h of holders) await sendEmail({ to: h.email, toName: h.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'event', id: event.id } });
  await audit('event.updated', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { broadcast: subject, recipients: buyers.length + holders.length } });
  return { ok: true, message: `Sent to ${buyers.length + holders.length} ticket holder(s).` };
}

