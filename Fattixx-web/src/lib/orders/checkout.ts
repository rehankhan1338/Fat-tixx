import 'server-only';
import { randomBytes } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { db, execute, query, queryOne, type Row } from '../db';
import { env } from '../env';
import { escapeHtml, sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { priceOrder, formatCents, type FeeConfig, type PriceLine } from '../money';
import { randomToken, sha256 } from '../security/crypto';
import { feeConfigForOrg, getSettings } from '../settings';
import { humanCode } from '../slug';
import { formatEventDate } from '../tz';
import { ticketUrl } from '../tickets';
import { adHtmlForEmail } from '../ads/serve';
import { sendSms } from '../sms';
import {
  accessCodeMatches, addonAvailable, getPublicEventBySlug, listTicketTypes, ticketTypeAvailable, ticketTypeOnSale,
  type AddonRow, type PublicEventRow, type TicketTypeRow,
} from '../events/queries';
import { getOrderById, listOrderAddons, listOrderItems, listOrderTickets, type OrderRow } from './queries';
import { promoTicketTypeIds, unitDiscount, type PromoRow } from '../marketing/queries';

export interface CartLine { ticketTypeId: number; quantity: number }
export interface AddonLine { addonId: number; quantity: number }
export interface AnswerInput { questionId: number; label: string; answer: string }

/** Mark stale pending orders as expired so their inventory is released. Cheap; call opportunistically. */
export async function expireStaleHolds(): Promise<void> {
  await execute(`UPDATE orders SET status = 'expired' WHERE status = 'pending' AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW()`);
}

export function effectiveTaxBps(event: PublicEventRow): number {
  return event.tax_bps != null ? Number(event.tax_bps) : Number(event.venue_tax_bps ?? 0);
}

export async function feeConfigForEvent(event: PublicEventRow): Promise<FeeConfig> {
  return feeConfigForOrg({ fee_bps_override: event.fee_bps_override, fee_fixed_cents_override: event.fee_fixed_cents_override });
}

/** All-in price a buyer sees for one ticket of a type (price + buyer-paid platform fee + tax). Processing fee is per order and shown at checkout. */
export function allInUnitCents(price: number, fees: FeeConfig, taxBps: number, feeMode: PublicEventRow['fee_mode']): number {
  const p = priceOrder([{ unitPriceCents: price, quantity: 1 }], fees, taxBps, feeMode);
  return p.subtotalCents + p.platformFeeCents + p.taxCents;
}

/** All-in price of one add-on unit (no fixed per-ticket fee). */
export function allInAddonCents(price: number, fees: FeeConfig, taxBps: number, feeMode: PublicEventRow['fee_mode']): number {
  const p = priceOrder([{ unitPriceCents: price, quantity: 1, fixedFee: false }], fees, taxBps, feeMode);
  return p.subtotalCents + p.platformFeeCents + p.taxCents;
}

export class CheckoutError extends Error {}

/**
 * Create a pending order that holds inventory. Runs in one transaction with row locks on the
 * ticket types (and add-ons), so concurrent buyers can never oversell. Returns the order code + access token.
 */
export interface Attribution { trackingLinkId?: number | null; utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null; channel?: 'web' | 'embed' }

export async function createPendingOrder(input: {
  eventSlug: string; lines: CartLine[]; addons?: AddonLine[]; answers?: AnswerInput[]; accessCode?: string | null; promoCode?: string | null;
  email: string; name: string; phone?: string; answer?: string; marketingOptIn: boolean; smsOptIn?: boolean; userId: number | null; ip: string;
  source?: 'online' | 'box_office' | 'complimentary'; createdBy?: number | null; bypassSalesWindow?: boolean; attribution?: Attribution;
}): Promise<{ orderId: number; code: string; accessToken: string; totalCents: number; discountCents: number }> {
  await expireStaleHolds();
  const event = await getPublicEventBySlug(input.eventSlug);
  if (!event) throw new CheckoutError('Event not found.');
  const staffSource = input.source && input.source !== 'online';
  if (!staffSource && !['published', 'postponed'].includes(event.status)) throw new CheckoutError('Tickets are not on sale for this event.');
  if (event.org_status !== 'active') throw new CheckoutError('Tickets are not on sale for this event.');
  const lines = input.lines.filter((l) => Number.isInteger(l.quantity) && l.quantity > 0);
  if (lines.length === 0) throw new CheckoutError('Choose at least one ticket.');
  const addonLines = (input.addons ?? []).filter((l) => Number.isInteger(l.quantity) && l.quantity > 0);

  const settings = await getSettings();
  const fees = await feeConfigForEvent(event);
  const taxBps = effectiveTaxBps(event);
  const holdMinutes = Number(settings.hold_minutes);

  const conn: PoolConnection = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Lock the ticket type rows for this event.
    const [ttRows] = await conn.query<TicketTypeRow[]>(
      `SELECT t.*, 0 AS held FROM ticket_types t WHERE t.event_id = ? AND t.id IN (${lines.map(() => '?').join(',')}) FOR UPDATE`,
      [event.id, ...lines.map((l) => l.ticketTypeId)],
    );
    if (ttRows.length !== lines.length) throw new CheckoutError('One of the selected tickets no longer exists.');
    // Live holds (pending, unexpired) computed inside the transaction.
    const [heldRows] = await conn.query<(Row & { ticket_type_id: number; held: number })[]>(
      `SELECT oi.ticket_type_id, COALESCE(SUM(oi.quantity),0) AS held FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'pending' AND o.hold_expires_at > NOW() AND oi.ticket_type_id IN (${lines.map(() => '?').join(',')}) GROUP BY oi.ticket_type_id`,
      lines.map((l) => l.ticketTypeId),
    );
    const heldBy = new Map(heldRows.map((r) => [Number(r.ticket_type_id), Number(r.held)]));

    const priced: { tt: TicketTypeRow; qty: number }[] = [];
    for (const line of lines) {
      const tt = ttRows.find((t) => Number(t.id) === line.ticketTypeId)!;
      tt.held = heldBy.get(Number(tt.id)) ?? 0;
      if (!staffSource || !input.bypassSalesWindow) {
        const sale = ticketTypeOnSale(tt);
        const unlocked = sale.reason === 'hidden' && accessCodeMatches(tt, input.accessCode);
        if (unlocked) {
          // A presale type unlocked by its code still respects its own sales window and inventory.
          const inner = ticketTypeOnSale({ ...tt, hidden: 0 } as TicketTypeRow);
          if (!inner.onSale) throw new CheckoutError(inner.reason === 'sold_out' ? `${tt.name} is sold out.` : `${tt.name} is not on sale right now.`);
        } else if (!sale.onSale && !(staffSource && sale.reason === 'hidden')) {
          throw new CheckoutError(sale.reason === 'sold_out' ? `${tt.name} is sold out.` : sale.reason === 'hidden' ? `${tt.name} requires an access code.` : `${tt.name} is not on sale right now.`);
        }
      }
      if (!staffSource && (line.quantity < Number(tt.min_per_order) || line.quantity > Number(tt.max_per_order))) {
        throw new CheckoutError(`${tt.name}: choose between ${tt.min_per_order} and ${tt.max_per_order} per order.`);
      }
      if (line.quantity > ticketTypeAvailable(tt)) throw new CheckoutError(`Only ${ticketTypeAvailable(tt)} × ${tt.name} left.`);
      // Per-account limit (plan 6.2): tickets of this type already bought or held by the same email / account.
      if (!staffSource && tt.max_per_account != null) {
        const [[mine]] = await conn.query<(Row & { n: number })[]>(
          `SELECT COALESCE(SUM(oi.quantity),0) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE oi.ticket_type_id = ? AND (o.buyer_email = ? ${input.userId ? 'OR o.user_id = ?' : ''})
              AND (o.status IN ('paid','partially_refunded') OR (o.status = 'pending' AND o.hold_expires_at > NOW()))`,
          input.userId ? [tt.id, input.email.toLowerCase(), input.userId] : [tt.id, input.email.toLowerCase()],
        );
        const left = Number(tt.max_per_account) - Number(mine.n);
        if (line.quantity > left) throw new CheckoutError(left <= 0 ? `You have reached the limit of ${tt.max_per_account} × ${tt.name} per person.` : `${tt.name} is limited to ${tt.max_per_account} per person; you can add ${left} more.`);
      }
      priced.push({ tt, qty: line.quantity });
    }

    // Promo code: locked with the order so max_uses holds under concurrent checkouts.
    const discountBy = new Map<number, number>();
    let promoId: number | null = null;
    if (input.promoCode && input.promoCode.trim() && !staffSource) {
      const code = input.promoCode.trim().toUpperCase();
      const [[promo]] = await conn.query<PromoRow[]>(`SELECT p.*, 0 AS used, 0 AS discount_total FROM promo_codes p WHERE p.event_id = ? AND p.code = ? FOR UPDATE`, [event.id, code]);
      const now = Date.now();
      if (!promo || !promo.active || (promo.starts_at && new Date(promo.starts_at).getTime() > now) || (promo.ends_at && new Date(promo.ends_at).getTime() < now)) {
        throw new CheckoutError('That promo code is not valid for this event right now.');
      }
      const only = promoTicketTypeIds(promo);
      const eligible = priced.filter((p) => Number(p.tt.price_cents) > 0 && (!only || only.includes(Number(p.tt.id))));
      if (!eligible.length) throw new CheckoutError(`The code ${code} does not apply to the selected tickets.`);
      if (promo.max_uses != null) {
        const [[u]] = await conn.query<(Row & { n: number })[]>(
          `SELECT COALESCE(SUM(oi.quantity),0) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE o.promo_code_id = ? AND oi.unit_discount_cents > 0 AND (o.status IN ('paid','partially_refunded') OR (o.status = 'pending' AND o.hold_expires_at > NOW()))`, [promo.id],
        );
        const left = Number(promo.max_uses) - Number(u.n);
        const want = eligible.reduce((n, p) => n + p.qty, 0);
        if (left <= 0) throw new CheckoutError(`The code ${code} has been fully used.`);
        if (want > left) throw new CheckoutError(`The code ${code} has only ${left} use${left === 1 ? '' : 's'} left; reduce the number of discounted tickets.`);
      }
      for (const p of eligible) discountBy.set(Number(p.tt.id), unitDiscount(promo, Number(p.tt.price_cents)));
      promoId = Number(promo.id);
    }

    // Overall event capacity (sum of sold + held + this order, in seats).
    if (event.capacity) {
      const [[cap]] = await conn.query<(Row & { seats: number })[]>(
        `SELECT COALESCE(SUM(oi.quantity * t.seats_per_unit),0) AS seats FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN ticket_types t ON t.id = oi.ticket_type_id
          WHERE o.event_id = ? AND (o.status IN ('paid','partially_refunded') OR (o.status = 'pending' AND o.hold_expires_at > NOW()))`, [event.id],
      );
      const wanted = priced.reduce((n, p) => n + p.qty * Number(p.tt.seats_per_unit), 0);
      if (Number(cap.seats) + wanted > Number(event.capacity)) throw new CheckoutError('Not enough capacity left for that many tickets.');
    }

    // Add-ons: lock, check availability and per-order limits.
    const pricedAddons: { addon: AddonRow; qty: number }[] = [];
    if (addonLines.length) {
      const [addonRows] = await conn.query<AddonRow[]>(
        `SELECT a.*, 0 AS held FROM event_addons a WHERE a.event_id = ? AND a.id IN (${addonLines.map(() => '?').join(',')}) FOR UPDATE`,
        [event.id, ...addonLines.map((l) => l.addonId)],
      );
      if (addonRows.length !== addonLines.length) throw new CheckoutError('One of the selected add-ons no longer exists.');
      const [addonHeld] = await conn.query<(Row & { addon_id: number; held: number })[]>(
        `SELECT oa.addon_id, COALESCE(SUM(oa.quantity),0) AS held FROM order_addons oa JOIN orders o ON o.id = oa.order_id
          WHERE o.status = 'pending' AND o.hold_expires_at > NOW() AND oa.addon_id IN (${addonLines.map(() => '?').join(',')}) GROUP BY oa.addon_id`,
        addonLines.map((l) => l.addonId),
      );
      const addonHeldBy = new Map(addonHeld.map((r) => [Number(r.addon_id), Number(r.held)]));
      for (const line of addonLines) {
        const addon = addonRows.find((a) => Number(a.id) === line.addonId)!;
        addon.held = addonHeldBy.get(Number(addon.id)) ?? 0;
        if (!addon.active && !staffSource) throw new CheckoutError(`${addon.name} is no longer available.`);
        if (!staffSource && line.quantity > Number(addon.max_per_order)) throw new CheckoutError(`${addon.name}: at most ${addon.max_per_order} per order.`);
        const avail = addonAvailable(addon);
        if (avail !== null && line.quantity > avail) throw new CheckoutError(avail === 0 ? `${addon.name} is sold out.` : `Only ${avail} × ${addon.name} left.`);
        pricedAddons.push({ addon, qty: line.quantity });
      }
    }

    const isComp = input.source === 'complimentary';
    // Fees and tax are computed on the discounted price; unit_price_cents records what was actually charged.
    const charged = (p: { tt: TicketTypeRow }) => (isComp ? 0 : Number(p.tt.price_cents) - (discountBy.get(Number(p.tt.id)) ?? 0));
    const priceLines: PriceLine[] = [
      ...priced.map((p) => ({ unitPriceCents: charged(p), quantity: p.qty })),
      ...pricedAddons.map((p) => ({ unitPriceCents: isComp ? 0 : Number(p.addon.price_cents), quantity: p.qty, fixedFee: false })),
    ];
    const pricing = priceOrder(priceLines, fees, taxBps, event.fee_mode);
    const discountCents = isComp ? 0 : priced.reduce((n, p) => n + (discountBy.get(Number(p.tt.id)) ?? 0) * p.qty, 0);
    const code = await uniqueOrderCode(conn);
    const accessToken = randomToken(24);
    const att = input.attribution ?? {};
    const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);
    const [res] = await conn.query<import('mysql2').ResultSetHeader>(
      `INSERT INTO orders (code, access_token_hash, organization_id, event_id, user_id, buyer_email, buyer_name, buyer_phone, checkout_answer, marketing_opt_in, sms_opt_in, status, source, currency,
         subtotal_cents, discount_cents, platform_fee_cents, processing_fee_cents, tax_cents, total_cents, absorbed_fee_cents, fee_mode, hold_expires_at, ip, created_by,
         promo_code_id, tracking_link_id, utm_source, utm_medium, utm_campaign, channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL ? MINUTE, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, sha256(accessToken), event.organization_id, event.id, input.userId, input.email.toLowerCase(), input.name || null, input.phone || null, input.answer || null, input.marketingOptIn ? 1 : 0, input.smsOptIn && input.phone ? 1 : 0,
        input.source ?? 'online', event.currency, pricing.subtotalCents, discountCents, pricing.platformFeeCents, pricing.processingFeeCents, pricing.taxCents, pricing.totalCents, pricing.absorbedFeeCents,
        event.fee_mode, holdMinutes, input.ip, input.createdBy ?? null,
        promoId, att.trackingLinkId ?? null, clip(att.utmSource, 80), clip(att.utmMedium, 80), clip(att.utmCampaign, 120), att.channel === 'embed' ? 'embed' : 'web'],
    );
    const orderId = res.insertId;
    for (let i = 0; i < priced.length; i++) {
      const p = priced[i];
      await conn.query(
        `INSERT INTO order_items (order_id, ticket_type_id, ticket_type_name, quantity, unit_price_cents, unit_discount_cents, unit_platform_fee_cents, unit_tax_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, p.tt.id, p.tt.name, p.qty, charged(p), isComp ? 0 : (discountBy.get(Number(p.tt.id)) ?? 0), pricing.perUnitPlatformFee[i], pricing.perUnitTax[i]],
      );
    }
    for (let i = 0; i < pricedAddons.length; i++) {
      const p = pricedAddons[i]; const j = priced.length + i;
      await conn.query(
        `INSERT INTO order_addons (order_id, addon_id, addon_name, quantity, unit_price_cents, unit_platform_fee_cents, unit_tax_cents) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, p.addon.id, p.addon.name, p.qty, isComp ? 0 : Number(p.addon.price_cents), pricing.perUnitPlatformFee[j], pricing.perUnitTax[j]],
      );
    }
    for (const a of input.answers ?? []) {
      if (!a.answer) continue;
      await conn.query(`INSERT INTO order_answers (order_id, question_id, question_label, answer) VALUES (?, ?, ?, ?)`, [orderId, a.questionId || null, a.label.slice(0, 200), a.answer.slice(0, 1000)]);
    }
    await conn.commit();
    return { orderId, code, accessToken, totalCents: pricing.totalCents, discountCents };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function uniqueOrderCode(conn: PoolConnection): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = humanCode(6, 'FTX-');
    const [rows] = await conn.query<Row[]>(`SELECT 1 FROM orders WHERE code = ?`, [code]);
    if (rows.length === 0) return code;
  }
  throw new Error('Could not allocate an order code');
}

/**
 * Mark an order paid and issue its tickets. Idempotent: a second call (e.g. webhook after the
 * client already confirmed) is a no-op. Increments ticket_types.sold under the same lock discipline.
 */
export async function finalizePaidOrder(orderId: number, payment: { paymentIntentId?: string | null; chargeId?: string | null }): Promise<boolean> {
  const conn = await db.getConnection();
  let buyerEmail = '';
  let eventId = 0;
  try {
    await conn.beginTransaction();
    const [[order]] = await conn.query<(Row & { id: number; status: string; event_id: number; buyer_email: string; buyer_name: string | null })[]>(
      `SELECT id, status, event_id, buyer_email, buyer_name FROM orders WHERE id = ? FOR UPDATE`, [orderId],
    );
    if (!order) throw new Error('Order not found');
    if (order.status !== 'pending' && order.status !== 'expired') { await conn.rollback(); return false; }
    buyerEmail = order.buyer_email; eventId = Number(order.event_id);
    // An expired hold that nevertheless got paid (slow payment) is honoured if inventory still allows; otherwise refund is handled by caller.
    const [items] = await conn.query<(Row & { id: number; ticket_type_id: number; quantity: number })[]>(`SELECT id, ticket_type_id, quantity FROM order_items WHERE order_id = ?`, [orderId]);
    for (const it of items) {
      const [r] = await conn.query<import('mysql2').ResultSetHeader>(
        `UPDATE ticket_types SET sold = sold + ? WHERE id = ? AND sold + ? <= quantity`, [it.quantity, it.ticket_type_id, it.quantity],
      );
      if (!r.affectedRows) throw new Error('OVERSOLD');
    }
    const [addons] = await conn.query<(Row & { addon_id: number; quantity: number })[]>(`SELECT addon_id, quantity FROM order_addons WHERE order_id = ?`, [orderId]);
    for (const a of addons) {
      const [r] = await conn.query<import('mysql2').ResultSetHeader>(
        `UPDATE event_addons SET sold = sold + ? WHERE id = ? AND (quantity IS NULL OR sold + ? <= quantity)`, [a.quantity, a.addon_id, a.quantity],
      );
      if (!r.affectedRows) throw new Error('OVERSOLD');
    }
    await conn.query(
      `UPDATE orders SET status = 'paid', paid_at = NOW(), hold_expires_at = NULL, stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id), stripe_charge_id = COALESCE(?, stripe_charge_id) WHERE id = ?`,
      [payment.paymentIntentId ?? null, payment.chargeId ?? null, orderId],
    );
    // Issue one ticket per seat.
    for (const it of items) {
      const [[tt]] = await conn.query<(Row & { seats_per_unit: number; kind: string })[]>(`SELECT seats_per_unit, kind FROM ticket_types WHERE id = ?`, [it.ticket_type_id]);
      const seats = Number(tt.seats_per_unit) || 1;
      for (let unit = 1; unit <= Number(it.quantity); unit++) {
        for (let seat = 1; seat <= seats; seat++) {
          const label = seats > 1 ? `Table ${unit} · Seat ${seat}` : null;
          await conn.query(
            `INSERT INTO tickets (code, secret, order_id, order_item_id, event_id, ticket_type_id, attendee_name, attendee_email, seat_label)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [humanCode(12), randomBytes(16).toString('hex'), orderId, it.id, order.event_id, it.ticket_type_id, order.buyer_name, order.buyer_email, label],
          );
        }
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  // A waitlisted buyer who bought is no longer waiting.
  await execute(`UPDATE waitlist_entries SET status = 'converted' WHERE event_id = ? AND email = ? AND status IN ('waiting','notified')`, [eventId, buyerEmail.toLowerCase()]);
  await sendOrderConfirmation(orderId);
  return true;
}

/** Give an order's add-on units back to inventory (full refund / cancellation / deletion). Idempotent per call site: callers only invoke it when the order leaves the paid state. */
export async function returnAddonInventory(orderId: number): Promise<void> {
  const rows = await query<Row & { addon_id: number; quantity: number }>(`SELECT addon_id, quantity FROM order_addons WHERE order_id = ?`, [orderId]);
  for (const r of rows) {
    await execute(`UPDATE event_addons SET sold = GREATEST(0, CAST(sold AS SIGNED) - ?) WHERE id = ?`, [Number(r.quantity), r.addon_id]);
  }
}

export function orderAccessUrl(order: { code: string }, accessToken: string): string {
  return `${env.APP_URL}/orders/${order.code}?t=${accessToken}`;
}

/** Email the buyer their receipt and tickets (links + QR pages). Also used by "resend tickets". */
export async function sendOrderConfirmation(orderId: number, opts: { resend?: boolean } = {}): Promise<void> {
  const order = await getOrderById(orderId);
  if (!order) return;
  const [items, addons, tickets] = await Promise.all([listOrderItems(order.id), listOrderAddons(order.id), listOrderTickets(order.id)]);
  const when = formatEventDate(new Date(order.event_starts_at), order.event_timezone);
  const ticketsUrl = `${env.APP_URL}/tickets/find`;
  const c = (n: number) => formatCents(n, order.currency);
  const receiptRows = [
    ...items.map((i) => `<tr><td>${i.quantity} × ${escapeHtml(i.ticket_type_name)}</td><td align="right">${c((Number(i.unit_price_cents) + Number(i.unit_discount_cents ?? 0)) * i.quantity)}</td></tr>`),
    order.discount_cents ? `<tr><td>Promo discount</td><td align="right">−${c(Number(order.discount_cents))}</td></tr>` : '',
    ...addons.map((a) => `<tr><td>${a.quantity} × ${escapeHtml(a.addon_name)} <span class="muted">(add-on)</span></td><td align="right">${c(a.unit_price_cents * a.quantity)}</td></tr>`),
    order.platform_fee_cents ? `<tr><td>Service fee</td><td align="right">${c(order.platform_fee_cents)}</td></tr>` : '',
    order.processing_fee_cents ? `<tr><td>Processing fee</td><td align="right">${c(order.processing_fee_cents)}</td></tr>` : '',
    order.tax_cents ? `<tr><td>Tax</td><td align="right">${c(order.tax_cents)}</td></tr>` : '',
    `<tr><td><strong>Total paid</strong></td><td align="right"><strong>${c(order.total_cents)}</strong></td></tr>`,
  ].join('');
  // Only live tickets; ones transferred to someone else are listed without their link (the recipient has it).
  const live = tickets.filter((t) => t.status === 'valid' || t.status === 'used');
  const mine = live.filter((t) => !(t.transferred_from_id != null && (t.attendee_email ?? '').toLowerCase() !== order.buyer_email.toLowerCase()));
  const given = live.filter((t) => !mine.includes(t));
  const ticketsHtml = mine.map((t) => `<p><a href="${ticketUrl(t.code, t.secret)}" class="btn">Open ticket</a> &nbsp; ${escapeHtml(t.ticket_type_name)}${t.day_label ? ` · ${escapeHtml(t.day_label)}` : ''}${t.seat_label ? ` · ${escapeHtml(t.seat_label)}` : ''}${t.attendee_name ? ` · ${escapeHtml(t.attendee_name)}` : ''} <code>${t.code}</code></p>`).join('')
    + (given.length ? `<p class="muted">Transferred: ${given.map((t) => `${escapeHtml(t.ticket_type_name)} → ${escapeHtml(t.attendee_name ?? t.attendee_email ?? '')}`).join(', ')}. The recipient has the ticket link.</p>` : '')
    + (addons.length ? `<p class="muted">Add-ons on this order: ${addons.map((a) => `${a.quantity} × ${escapeHtml(a.addon_name)}`).join(', ')}. Show your order number at the venue.</p>` : '');
  const mail = await renderEmail(opts.resend ? 'tickets_resent' : 'order_confirmation', {
    event_title: order.event_title, event_when: when, venue_line: order.venue_name ?? '', order_code: order.code, total: c(order.total_cents),
    receipt_rows: receiptRows, tickets_html: ticketsHtml, age_notice: order.age_restriction ? `This event is ${order.age_restriction}+. Bring a valid photo ID.` : '', find_tickets_url: ticketsUrl,
  }, { appendHtml: opts.resend ? '' : await adHtmlForEmail(Number(order.event_id)).catch(() => '') });
  await sendEmail({ to: order.buyer_email, toName: order.buyer_name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'order', id: order.id } });
  // SMS ticket delivery (Phase 2) for buyers who asked for it at checkout.
  if (!opts.resend && order.sms_opt_in && order.buyer_phone && mine.length) {
    const link = mine.length === 1 ? ticketUrl(mine[0].code, mine[0].secret) : `${env.APP_URL}/tickets/find`;
    await sendSms(order.buyer_phone, `Fattixx: ${mine.length} ticket${mine.length === 1 ? '' : 's'} for ${order.event_title} (${when}). Order ${order.code}. ${mine.length === 1 ? 'Your ticket' : 'Find your tickets'}: ${link}`, { type: 'order', id: order.id });
  }
}

/** Refund policy check for attendee-initiated requests. */
export function attendeeMayRequestRefund(order: OrderRow): boolean {
  if (order.status !== 'paid') return false;
  const start = new Date(order.event_starts_at).getTime();
  if (order.refund_policy === 'until_event_start') return Date.now() < start;
  if (order.refund_policy === 'days_before') return Date.now() < start - Number(order.refund_days_before ?? 0) * 86_400_000;
  return false;
}

export async function ticketTypesForEvent(eventId: number) {
  return listTicketTypes(eventId);
}

export async function pendingHoldsCount(eventId: number): Promise<number> {
  const r = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE event_id = ? AND status = 'pending' AND hold_expires_at > NOW()`, [eventId]);
  return Number(r?.n ?? 0);
}

/** True when a pending order's reservation window has passed. */
export function holdExpired(order: { status: string; hold_expires_at: Date | string | null }): boolean {
  if (order.status === 'expired') return true;
  return !!order.hold_expires_at && new Date(order.hold_expires_at).getTime() < Date.now();
}
