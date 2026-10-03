'use server';

import { revalidatePath } from 'next/cache';
import { execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertOrg, canAccessEvent, type OrgContext } from '../authz';
import { getEvent, type EventListRow } from '../events/queries';
import { parseDollarsToCents } from '../money';
import { randomToken } from '../security/crypto';
import { wallClockToUtc } from '../tz';
import { deleteUpload, saveImageUpload } from '../uploads';

/**
 * Organizer marketing tools (plan 5.2 "Sales & Money" / "Marketing & Sponsors"):
 * promo codes, event sponsors, promoter / UTM tracking links and the organization's tracking pixels.
 * Organizers and Organization Admins only; door staff have no access.
 */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);

async function loadEvent(fd: FormData): Promise<{ ctx: OrgContext; event: EventListRow }> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const event = await getEvent(ctx.org.id, Number(fd.get('event_id')));
  if (!event || !(await canAccessEvent(ctx, event))) throw new Error('Event not found');
  return { ctx, event };
}

function refresh(orgSlug: string, event?: { id: number; slug: string }) {
  if (event) { revalidatePath(`/org/${orgSlug}/events/${event.id}`); revalidatePath(`/events/${event.slug}`); }
  revalidatePath(`/org/${orgSlug}/marketing`);
}

function when(fd: FormData, k: string, tz: string): Date | null {
  const v = str(fd, k, 20);
  return v ? wallClockToUtc(v, tz) : null;
}

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------
function promoFields(fd: FormData, tz: string, currency: string) {
  const code = str(fd, 'code', 40).toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) return { error: 'Codes use 2–40 letters, numbers, dashes or underscores.' } as const;
  const kind = str(fd, 'kind', 10) === 'amount' ? 'amount' : 'percent';
  let value: number;
  if (kind === 'percent') {
    const pct = Number(str(fd, 'value', 10));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { error: 'Percent off must be between 0 and 100.' } as const;
    value = Math.round(pct * 100);
  } else {
    const cents = parseDollarsToCents(str(fd, 'value', 20));
    if (!cents) return { error: `Enter the amount off per ticket in ${currency}.` } as const;
    value = cents;
  }
  const maxUsesRaw = str(fd, 'max_uses', 10);
  const maxUses = maxUsesRaw ? Number(maxUsesRaw) : null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) return { error: 'Max uses must be a whole number (blank = unlimited).' } as const;
  const ids = fd.getAll('ticket_type_ids').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const startsAt = when(fd, 'starts_at', tz), endsAt = when(fd, 'ends_at', tz);
  if (startsAt && endsAt && endsAt <= startsAt) return { error: 'The end must be after the start.' } as const;
  return { values: { code, kind, value, maxUses, ids: ids.length ? ids.join(',') : null, startsAt, endsAt, active: fd.get('active') ? 1 : 0 } };
}

export async function savePromoCode(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadEvent(fd); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, event } = loaded;
  const f = promoFields(fd, event.timezone, event.currency);
  if ('error' in f) return { error: f.error };
  const v = f.values;
  const id = Number(fd.get('promo_id')) || null;
  const clash = await queryOne<Row & { id: number }>(`SELECT id FROM promo_codes WHERE event_id = ? AND code = ?`, [event.id, v.code]);
  if (clash && Number(clash.id) !== id) return { error: `The code ${v.code} already exists for this event.` };
  if (v.ids) {
    const n = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM ticket_types WHERE event_id = ? AND id IN (${v.ids.split(',').map(() => '?').join(',')})`, [event.id, ...v.ids.split(',').map(Number)]);
    if (Number(n?.n) !== v.ids.split(',').length) return { error: 'Choose ticket types from this event.' };
  }
  if (id) {
    const r = await execute(
      `UPDATE promo_codes SET code = ?, kind = ?, value = ?, ticket_type_ids = ?, max_uses = ?, starts_at = ?, ends_at = ?, active = ? WHERE id = ? AND event_id = ?`,
      [v.code, v.kind, v.value, v.ids, v.maxUses, v.startsAt, v.endsAt, v.active, id, event.id],
    );
    if (!r.affectedRows) return { error: 'Promo code not found.' };
    await audit('promo.updated', { actorUserId: ctx.session.user.id, targetType: 'promo_code', targetId: id, metadata: { eventId: event.id, code: v.code } });
  } else {
    const r = await execute(
      `INSERT INTO promo_codes (event_id, code, kind, value, ticket_type_ids, max_uses, starts_at, ends_at, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.id, v.code, v.kind, v.value, v.ids, v.maxUses, v.startsAt, v.endsAt, v.active, ctx.session.user.id],
    );
    await audit('promo.created', { actorUserId: ctx.session.user.id, targetType: 'promo_code', targetId: r.insertId, metadata: { eventId: event.id, code: v.code } });
  }
  refresh(ctx.org.slug, event);
  return { ok: true, message: 'Promo code saved.' };
}

export async function deletePromoCode(fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadEvent(fd); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, event } = loaded;
  const id = Number(fd.get('promo_id'));
  const used = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE promo_code_id = ? AND status IN ('paid','partially_refunded','refunded')`, [id]);
  if (Number(used?.n) > 0) {
    // Keep the record for reporting; just stop it from working.
    await execute(`UPDATE promo_codes SET active = 0 WHERE id = ? AND event_id = ?`, [id, event.id]);
    refresh(ctx.org.slug, event);
    return { ok: true, message: 'This code has been used, so it was deactivated instead of deleted (kept for reporting).' };
  }
  await execute(`DELETE FROM promo_codes WHERE id = ? AND event_id = ?`, [id, event.id]);
  await audit('promo.deleted', { actorUserId: ctx.session.user.id, targetType: 'promo_code', targetId: id, metadata: { eventId: event.id } });
  refresh(ctx.org.slug, event);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Event sponsors
// ---------------------------------------------------------------------------
export async function saveSponsor(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadEvent(fd); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, event } = loaded;
  const name = str(fd, 'name', 160);
  if (name.length < 2) return { error: 'Enter the sponsor name.' };
  const url = str(fd, 'url', 500);
  if (url && !/^https?:\/\/\S+$/i.test(url)) return { error: 'The sponsor link must start with http:// or https://' };
  const from = when(fd, 'visible_from', event.timezone), until = when(fd, 'visible_until', event.timezone);
  if (from && until && until <= from) return { error: 'The visibility end must be after the start.' };
  const id = Number(fd.get('sponsor_id')) || null;
  const existing = id ? await queryOne<Row & { logo_path: string | null }>(`SELECT logo_path FROM event_sponsors WHERE id = ? AND event_id = ?`, [id, event.id]) : null;
  if (id && !existing) return { error: 'Sponsor not found.' };
  let logo = existing?.logo_path ?? null;
  const file = fd.get('logo');
  if (file instanceof File && file.size > 0) {
    try { logo = await saveImageUpload(file, 'sponsors', 600); } catch (e) { return { error: (e as Error).message }; }
    if (existing?.logo_path) await deleteUpload(existing.logo_path);
  }
  const vals = [name, logo, url || null, str(fd, 'tier', 40) || null, from, until, Number(str(fd, 'sort_order', 4)) || 0];
  if (id) {
    await execute(`UPDATE event_sponsors SET name = ?, logo_path = ?, url = ?, tier = ?, visible_from = ?, visible_until = ?, sort_order = ? WHERE id = ? AND event_id = ?`, [...vals, id, event.id]);
    await audit('sponsor.updated', { actorUserId: ctx.session.user.id, targetType: 'sponsor', targetId: id, metadata: { eventId: event.id } });
  } else {
    const r = await execute(`INSERT INTO event_sponsors (name, logo_path, url, tier, visible_from, visible_until, sort_order, event_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [...vals, event.id]);
    await audit('sponsor.created', { actorUserId: ctx.session.user.id, targetType: 'sponsor', targetId: r.insertId, metadata: { eventId: event.id } });
  }
  refresh(ctx.org.slug, event);
  return { ok: true, message: 'Sponsor saved.' };
}

export async function deleteSponsor(fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadEvent(fd); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, event } = loaded;
  const id = Number(fd.get('sponsor_id'));
  const s = await queryOne<Row & { logo_path: string | null }>(`SELECT logo_path FROM event_sponsors WHERE id = ? AND event_id = ?`, [id, event.id]);
  if (!s) return { error: 'Sponsor not found.' };
  await execute(`DELETE FROM event_sponsors WHERE id = ? AND event_id = ?`, [id, event.id]);
  await deleteUpload(s.logo_path);
  await audit('sponsor.deleted', { actorUserId: ctx.session.user.id, targetType: 'sponsor', targetId: id, metadata: { eventId: event.id } });
  refresh(ctx.org.slug, event);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Promoter / UTM tracking links (organization level, optionally tied to one event)
// ---------------------------------------------------------------------------
const utm = (s: string) => s.replace(/[^\w.-]/g, '_').slice(0, 80) || null;

export async function saveTrackingLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const name = str(fd, 'name', 120);
  if (name.length < 2) return { error: 'Name the promoter or channel (e.g. “Instagram bio”, “DJ Kay”).' };
  const eventId = Number(fd.get('event_id')) || null;
  if (eventId) {
    const ev = await getEvent(ctx.org.id, eventId);
    if (!ev || !(await canAccessEvent(ctx, ev))) return { error: 'Event not found.' };
  }
  const id = Number(fd.get('link_id')) || null;
  const source = utm(str(fd, 'utm_source', 80)) ?? utm(name.toLowerCase());
  const vals = [name, eventId, source, utm(str(fd, 'utm_medium', 80)) ?? 'referral', utm(str(fd, 'utm_campaign', 120)), fd.get('active') || !id ? 1 : 0];
  if (id) {
    const r = await execute(`UPDATE tracking_links SET name = ?, event_id = ?, utm_source = ?, utm_medium = ?, utm_campaign = ?, active = ? WHERE id = ? AND organization_id = ?`, [...vals, id, ctx.org.id]);
    if (!r.affectedRows) return { error: 'Link not found.' };
    await audit('tracking_link.updated', { actorUserId: ctx.session.user.id, targetType: 'tracking_link', targetId: id });
  } else {
    let code = '';
    for (let i = 0; i < 5 && !code; i++) {
      const c = randomToken(6).replace(/[^A-Za-z0-9]/g, '').slice(0, 7);
      if (c.length >= 6 && !(await queryOne(`SELECT 1 FROM tracking_links WHERE code = ?`, [c]))) code = c;
    }
    if (!code) return { error: 'Could not create a link code. Try again.' };
    const r = await execute(
      `INSERT INTO tracking_links (name, event_id, utm_source, utm_medium, utm_campaign, active, organization_id, code, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...vals, ctx.org.id, code, ctx.session.user.id],
    );
    await audit('tracking_link.created', { actorUserId: ctx.session.user.id, targetType: 'tracking_link', targetId: r.insertId, metadata: { code } });
  }
  revalidatePath(`/org/${ctx.org.slug}/marketing`);
  return { ok: true, message: 'Link saved.' };
}

export async function deleteTrackingLink(fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'organizer');
  const id = Number(fd.get('link_id'));
  const used = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE tracking_link_id = ?`, [id]);
  if (Number(used?.n) > 0) {
    await execute(`UPDATE tracking_links SET active = 0 WHERE id = ? AND organization_id = ?`, [id, ctx.org.id]);
    revalidatePath(`/org/${ctx.org.slug}/marketing`);
    return { ok: true, message: 'This link has orders, so it was deactivated instead of deleted (kept for reporting).' };
  }
  await execute(`DELETE FROM tracking_links WHERE id = ? AND organization_id = ?`, [id, ctx.org.id]);
  await audit('tracking_link.deleted', { actorUserId: ctx.session.user.id, targetType: 'tracking_link', targetId: id });
  revalidatePath(`/org/${ctx.org.slug}/marketing`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// High-demand on-sale: virtual waiting room (plan 6.2)
// ---------------------------------------------------------------------------
export async function saveOnSaleSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadEvent(fd); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, event } = loaded;
  const enabled = fd.get('queue_enabled') ? 1 : 0;
  const rate = Number(str(fd, 'queue_rate_per_min', 6));
  if (!Number.isInteger(rate) || rate < 1 || rate > 100_000) return { error: 'People per minute must be a whole number between 1 and 100,000.' };
  await execute(`UPDATE events SET queue_enabled = ?, queue_rate_per_min = ? WHERE id = ?`, [enabled, rate, event.id]);
  await audit('event.updated', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { queue_enabled: enabled, queue_rate_per_min: rate } });
  refresh(ctx.org.slug, event);
  return { ok: true, message: enabled ? `Waiting room on: ${rate} people per minute.` : 'Waiting room off.' };
}

// ---------------------------------------------------------------------------
// Organization tracking pixels (Phase 2 organizer marketing). Loaded only on public event pages,
// only after the visitor consents, and never on checkout or payment pages (plan 11.4).
// ---------------------------------------------------------------------------
export async function savePixels(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await assertOrg(str(fd, 'org', 64), 'org_admin');
  const meta = str(fd, 'meta_pixel_id', 30);
  const ga = str(fd, 'ga4_id', 30).toUpperCase();
  if (meta && !/^\d{5,20}$/.test(meta)) return { error: 'A Meta Pixel ID is a number, e.g. 123456789012345.' };
  if (ga && !/^G-[A-Z0-9]{4,20}$/.test(ga)) return { error: 'A Google Analytics 4 ID looks like G-XXXXXXXXXX.' };
  await execute(`UPDATE organizations SET meta_pixel_id = ?, ga4_id = ? WHERE id = ?`, [meta || null, ga || null, ctx.org.id]);
  await audit('org.updated', { actorUserId: ctx.session.user.id, targetType: 'organization', targetId: ctx.org.id, metadata: { pixels: { meta: !!meta, ga4: !!ga } } });
  revalidatePath(`/org/${ctx.org.slug}/marketing`);
  return { ok: true, message: 'Tracking settings saved.' };
}
