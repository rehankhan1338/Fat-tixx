import 'server-only';
import { query, queryOne, type Row, type SqlParam } from '../db';
import { hmacHex, safeEqual } from '../security/crypto';

/**
 * Organizer audience (11.10): followers and past attendees across all the organization's events, with filters by
 * event, city and date. Contact details follow Section 9: organizers already see their buyers' emails (orders), so
 * past attendees show their email; followers who never bought show their name and city only, and are reached through
 * Fattixx messages. Messages go to followers (who haven't muted the organizer) and to past attendees who opted in to the
 * organizer's updates at checkout and haven't unsubscribed (marketing_contacts, the same consent Pro email uses).
 */
export type AudienceFilters = { kind: 'all' | 'followers' | 'attendees'; eventId: number | null; city: string; from: string | null; to: string | null; q: string };

export function parseAudienceFilters(sp: Record<string, string | string[] | undefined>): AudienceFilters {
  const s = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string).trim() : '');
  const kind = s('kind');
  const date = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  return {
    kind: kind === 'followers' || kind === 'attendees' ? kind : 'all',
    eventId: Number(s('event')) || null, city: s('city').slice(0, 80), from: date(s('from')), to: date(s('to')), q: s('q').slice(0, 80),
  };
}

export type AudienceRow = {
  key: string; name: string; email: string | null; city: string | null; follower: boolean; followedAt: Date | null;
  events: number; lastEventAt: Date | null; optedIn: boolean; username: string | null;
};

type Built = { sql: string; params: SqlParam[] };

/** Past attendees: one row per buyer email with a paid order for one of the organization's events. */
function attendeesSql(orgId: number, f: AudienceFilters): Built {
  const conds = [`o.organization_id = ?`, `o.status IN ('paid','partially_refunded')`];
  const params: SqlParam[] = [orgId];
  if (f.eventId) { conds.push('o.event_id = ?'); params.push(f.eventId); }
  if (f.from) { conds.push('e.starts_at >= ?'); params.push(`${f.from} 00:00:00`); }
  if (f.to) { conds.push('e.starts_at < ? + INTERVAL 1 DAY'); params.push(`${f.to} 00:00:00`); }
  if (f.city) { conds.push('(o.buyer_city LIKE ? OR v.city LIKE ?)'); params.push(`%${f.city}%`, `%${f.city}%`); }
  return {
    sql: `SELECT LOWER(o.buyer_email) AS email, MAX(o.buyer_name) AS name, MAX(COALESCE(o.buyer_city, v.city)) AS city,
                 COUNT(DISTINCT o.event_id) AS events, MAX(e.starts_at) AS last_event_at, MAX(o.user_id) AS user_id
            FROM orders o JOIN events e ON e.id = o.event_id LEFT JOIN venues v ON v.id = e.venue_id
           WHERE ${conds.join(' AND ')} GROUP BY LOWER(o.buyer_email)`,
    params,
  };
}

/** Followers (active accounts). Event and date filters mean "followers who attended that event / in that period". */
function followersSql(orgId: number, f: AudienceFilters): Built {
  const conds = [`f.organization_id = ?`, `u.status = 'active'`];
  const params: SqlParam[] = [orgId];
  if (f.city) { conds.push('u.city LIKE ?'); params.push(`%${f.city}%`); }
  if (f.eventId || f.from || f.to) {
    const sub = [`o.organization_id = ?`, `o.status IN ('paid','partially_refunded')`, `(o.user_id = u.id OR o.buyer_email = u.email)`];
    params.push(orgId);
    if (f.eventId) { sub.push('o.event_id = ?'); params.push(f.eventId); }
    if (f.from) { sub.push('e.starts_at >= ?'); params.push(`${f.from} 00:00:00`); }
    if (f.to) { sub.push('e.starts_at < ? + INTERVAL 1 DAY'); params.push(`${f.to} 00:00:00`); }
    conds.push(`EXISTS (SELECT 1 FROM orders o JOIN events e ON e.id = o.event_id WHERE ${sub.join(' AND ')})`);
  }
  return {
    sql: `SELECT u.id AS user_id, LOWER(u.email) AS email, u.name, u.city, u.username, f.created_at AS followed_at, f.muted
            FROM org_follows f JOIN users u ON u.id = f.user_id WHERE ${conds.join(' AND ')}`,
    params,
  };
}

export async function listAudience(orgId: number, f: AudienceFilters, limit = 100, offset = 0): Promise<{ rows: AudienceRow[]; total: number }> {
  const att = f.kind === 'followers' ? null : attendeesSql(orgId, f);
  const fol = f.kind === 'attendees' ? null : followersSql(orgId, f);
  const [attendees, followers, consent] = await Promise.all([
    att ? query<Row & { email: string; name: string | null; city: string | null; events: number; last_event_at: Date | null; user_id: number | null }>(att.sql, att.params) : Promise.resolve([]),
    fol ? query<Row & { user_id: number; email: string; name: string; city: string | null; username: string | null; followed_at: Date }>(fol.sql, fol.params) : Promise.resolve([]),
    query<Row & { email: string }>(`SELECT LOWER(c.email) AS email FROM marketing_contacts c WHERE c.organization_id = ? AND c.unsubscribed_at IS NULL AND c.consent_at IS NOT NULL`, [orgId]),
  ]);
  const opted = new Set(consent.map((c) => c.email));
  const byKey = new Map<string, AudienceRow>();
  for (const a of attendees) {
    byKey.set(a.email, { key: a.email, name: a.name ?? a.email.split('@')[0], email: a.email, city: a.city, follower: false, followedAt: null, events: Number(a.events), lastEventAt: a.last_event_at, optedIn: opted.has(a.email), username: null });
  }
  for (const fo of followers) {
    const existing = byKey.get(fo.email);
    if (existing) { existing.follower = true; existing.followedAt = fo.followed_at; existing.username = fo.username; existing.city ??= fo.city; continue; }
    // Followers who never bought: name and city only.
    byKey.set(fo.email, { key: `u${fo.user_id}`, name: fo.name, email: null, city: fo.city, follower: true, followedAt: fo.followed_at, events: 0, lastEventAt: null, optedIn: false, username: fo.username });
  }
  let rows = [...byKey.values()];
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.email ?? '').includes(q) || (r.username ?? '').includes(q));
  }
  rows.sort((a, b) => (b.lastEventAt?.getTime() ?? b.followedAt?.getTime() ?? 0) - (a.lastEventAt?.getTime() ?? a.followedAt?.getTime() ?? 0));
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

/** Who a message reaches: followers not muted, and opted-in attendees (deduplicated by email). */
export async function messageRecipients(orgId: number, f: AudienceFilters): Promise<{ email: string; name: string | null; phone: string | null; sms: boolean; follower: boolean }[]> {
  const out = new Map<string, { email: string; name: string | null; phone: string | null; sms: boolean; follower: boolean }>();
  if (f.kind !== 'attendees') {
    const fol = followersSql(orgId, f);
    const rows = await query<Row & { email: string; name: string; muted: number; user_id: number }>(fol.sql, fol.params);
    const phones = rows.length
      ? await query<Row & { id: number; phone: string | null; social_sms_opt_in: number }>(`SELECT id, phone, social_sms_opt_in FROM users WHERE id IN (${rows.map(() => '?').join(',')})`, rows.map((r) => r.user_id))
      : [];
    const ph = new Map(phones.map((p) => [Number(p.id), p]));
    for (const r of rows) {
      if (Number(r.muted) || r.email.endsWith('@deleted.invalid')) continue;
      const p = ph.get(Number(r.user_id));
      out.set(r.email, { email: r.email, name: r.name, phone: p?.phone ?? null, sms: !!Number(p?.social_sms_opt_in) && !!p?.phone, follower: true });
    }
  }
  if (f.kind !== 'followers') {
    const att = attendeesSql(orgId, f);
    const rows = await query<Row & { email: string; name: string | null }>(att.sql, att.params);
    const consent = await query<Row & { email: string }>(`SELECT LOWER(email) AS email FROM marketing_contacts WHERE organization_id = ? AND unsubscribed_at IS NULL AND consent_at IS NOT NULL`, [orgId]);
    const ok = new Set(consent.map((c) => c.email));
    const sms = await query<Row & { email: string; phone: string }>(
      `SELECT LOWER(buyer_email) AS email, MAX(buyer_phone) AS phone FROM orders WHERE organization_id = ? AND sms_opt_in = 1 AND buyer_phone IS NOT NULL AND status IN ('paid','partially_refunded') GROUP BY LOWER(buyer_email)`, [orgId],
    );
    const smsBy = new Map(sms.map((s) => [s.email, s.phone]));
    for (const r of rows) {
      if (!ok.has(r.email) || out.has(r.email)) continue;
      out.set(r.email, { email: r.email, name: r.name, phone: smsBy.get(r.email) ?? null, sms: smsBy.has(r.email), follower: false });
    }
  }
  return [...out.values()];
}

export type AudienceStats = {
  followers: number; newFollowers30: number; growth: { week: string; count: number }[];
  referralSales: { orders: number; revenue: number }; shareSales: { orders: number; revenue: number }; shares: number;
};

/** Organizer analytics (11.10): follower growth, and sales from referrals and shares. */
export async function audienceStats(orgId: number): Promise<AudienceStats> {
  const [counts, weeks, ref, share, shares] = await Promise.all([
    queryOne<Row & { total: number; recent: number }>(
      `SELECT COUNT(*) AS total, SUM(f.created_at > NOW() - INTERVAL 30 DAY) AS recent FROM org_follows f JOIN users u ON u.id = f.user_id WHERE f.organization_id = ? AND u.status = 'active'`, [orgId],
    ),
    query<Row & { wk: string; n: number }>(
      `SELECT DATE_FORMAT(DATE_SUB(DATE(f.created_at), INTERVAL WEEKDAY(f.created_at) DAY), '%Y-%m-%d') AS wk, COUNT(*) AS n
         FROM org_follows f WHERE f.organization_id = ? AND f.created_at > NOW() - INTERVAL 12 WEEK GROUP BY wk ORDER BY wk`, [orgId],
    ),
    queryOne<Row & { n: number; rev: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(o.total_cents - o.refunded_cents), 0) AS rev FROM referral_rewards rr JOIN orders o ON o.id = rr.order_id
        WHERE rr.organization_id = ? AND rr.status <> 'reversed'`, [orgId],
    ),
    queryOne<Row & { n: number; rev: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_cents - refunded_cents), 0) AS rev FROM orders WHERE organization_id = ? AND shared_by_user_id IS NOT NULL AND status IN ('paid','partially_refunded')`, [orgId],
    ),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM event_shares s JOIN events e ON e.id = s.event_id WHERE e.organization_id = ?`, [orgId]),
  ]);
  return {
    followers: Number(counts?.total ?? 0), newFollowers30: Number(counts?.recent ?? 0),
    growth: weeks.map((w) => ({ week: w.wk, count: Number(w.n) })),
    referralSales: { orders: Number(ref?.n ?? 0), revenue: Number(ref?.rev ?? 0) },
    shareSales: { orders: Number(share?.n ?? 0), revenue: Number(share?.rev ?? 0) },
    shares: Number(shares?.n ?? 0),
  };
}

/** Per-event share report: shares by channel, and orders / revenue from "I'm going" links. */
export async function eventShareStats(eventId: number): Promise<{ shares: { channel: string; n: number }[]; orders: number; revenue: number }> {
  const [shares, sales] = await Promise.all([
    query<Row & { channel: string; n: number }>(`SELECT channel, COUNT(*) AS n FROM event_shares WHERE event_id = ? GROUP BY channel ORDER BY n DESC`, [eventId]),
    queryOne<Row & { n: number; rev: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total_cents - refunded_cents), 0) AS rev FROM orders WHERE event_id = ? AND shared_by_user_id IS NOT NULL AND status IN ('paid','partially_refunded')`, [eventId],
    ),
  ]);
  return { shares: shares.map((s) => ({ channel: s.channel, n: Number(s.n) })), orders: Number(sales?.n ?? 0), revenue: Number(sales?.rev ?? 0) };
}

// Unsubscribe links in audience messages to past attendees: org id + email, signed.
export function audienceUnsubToken(orgId: number, email: string): string {
  const payload = Buffer.from(`${orgId}:${email.toLowerCase()}`).toString('base64url');
  return `${payload}.${hmacHex(`audience-unsub:${payload}`).slice(0, 32)}`;
}

export function parseAudienceUnsubToken(token: string): { orgId: number; email: string } | null {
  const [payload, sig] = String(token ?? '').split('.');
  if (!payload || !sig || !safeEqual(hmacHex(`audience-unsub:${payload}`).slice(0, 32), sig)) return null;
  const [org, ...rest] = Buffer.from(payload, 'base64url').toString('utf8').split(':');
  const orgId = Number(org);
  const email = rest.join(':');
  return Number.isSafeInteger(orgId) && orgId > 0 && email.includes('@') ? { orgId, email } : null;
}
