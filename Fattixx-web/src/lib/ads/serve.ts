import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { execute, query, queryOne, type Row } from '../db';
import { env } from '../env';
import { escapeHtml } from '../email';
import { uploadUrl } from '../uploads';
import { matchesTargeting, type AdEventFacts, type AdTargeting, type AdViewerFacts, type PlacementKey, type ViewerRole } from './placements';

/**
 * Ad delivery (plan 14.4). One query per request picks an eligible campaign for a placement:
 * active, inside its dates, assigned to the placement, matching its targeting, and (for an organizer's
 * sponsor campaign) only on that organization's events. The highest priority wins; equal priorities
 * rotate by weight. Impressions and clicks are counted in a daily roll-up with no cookies or personal data.
 */
export type ServedAd = {
  campaignId: number; creativeId: number; placement: PlacementKey; eventId: number;
  imageUrl: string | null; alt: string; headline: string | null; body: string | null; advertiser: string | null; kind: string;
  token: string; clickUrl: string;
};

/** `roles` defaults to guest / attendee from `signedIn`; `ticketKinds` is the visitor's own tickets where the slot shows them. */
export type AdContext = { eventId?: number | null; signedIn?: boolean; roles?: ViewerRole[]; ticketKinds?: string[] };

type Candidate = Row & {
  id: number; kind: string; organization_id: number | null; event_id: number | null; advertiser_name: string | null; weight: number; priority: number; targeting: string | null;
};

function key(): Buffer {
  return createHmac('sha256', process.env.TICKET_SIGNING_KEY ?? 'dev').update('fattixx-ads').digest();
}

/** Signed "campaign.creative.placement.event" so tracking endpoints only count ads that were actually served. */
export function adToken(campaignId: number, creativeId: number, placement: string, eventId: number): string {
  const body = `${campaignId}.${creativeId}.${placement}.${eventId}`;
  return `${body}.${createHmac('sha256', key()).update(body).digest('base64url').slice(0, 16)}`;
}

export function parseAdToken(token: string): { campaignId: number; creativeId: number; placement: string; eventId: number } | null {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 5) return null;
  const [c, cr, p, e, sig] = parts;
  if (!/^\d+$/.test(c) || !/^\d+$/.test(cr) || !/^[a-z_]{2,40}$/.test(p) || !/^\d+$/.test(e)) return null;
  const want = Buffer.from(createHmac('sha256', key()).update(`${c}.${cr}.${p}.${e}`).digest('base64url').slice(0, 16));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { campaignId: Number(c), creativeId: Number(cr), placement: p, eventId: Number(e) };
}

function parseTargeting(raw: string | null): AdTargeting {
  if (!raw) return {};
  try { return JSON.parse(raw) as AdTargeting; } catch { return {}; }
}

/** The visitor's roles for role targeting: guest, or attendee plus organizer / staff from their memberships. */
export async function viewerRoles(userId: number | null): Promise<ViewerRole[]> {
  if (!userId) return ['guest'];
  const rows = await query<Row & { role: string }>(`SELECT DISTINCT role FROM organization_members WHERE user_id = ?`, [userId]);
  const roles: ViewerRole[] = ['attendee'];
  if (rows.some((r) => r.role === 'org_admin' || r.role === 'organizer')) roles.push('organizer');
  if (rows.some((r) => r.role === 'staff')) roles.push('staff');
  return roles;
}

/** Ticket kinds on one order (order confirmation page and email). */
export async function orderTicketKinds(orderId: number): Promise<string[]> {
  const rows = await query<Row & { kind: string }>(
    `SELECT DISTINCT tt.kind FROM order_items oi JOIN ticket_types tt ON tt.id = oi.ticket_type_id WHERE oi.order_id = ?`, [orderId]);
  return rows.map((r) => r.kind);
}

/** Ticket kinds a signed-in visitor holds for upcoming events (the ticket dashboard). */
export async function upcomingTicketKinds(userId: number): Promise<string[]> {
  const rows = await query<Row & { kind: string }>(
    `SELECT DISTINCT tt.kind FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN ticket_types tt ON tt.id = oi.ticket_type_id JOIN events e ON e.id = o.event_id
      WHERE o.user_id = ? AND o.status IN ('paid','partially_refunded') AND e.starts_at > NOW()`, [userId]);
  return rows.map((r) => r.kind);
}

export async function pickAd(placement: PlacementKey, ctx: AdContext = {}): Promise<ServedAd | null> {
  const eventId = ctx.eventId ? Number(ctx.eventId) : 0;
  const ev = eventId
    ? await queryOne<Row & { organization_id: number; region: string | null; city: string | null; age_restriction: number | null; starts_at: Date; category: string | null; kinds: string | null; org_pro: number }>(
      `SELECT e.organization_id, v.region, v.city, e.age_restriction, e.starts_at, e.category,
              (SELECT GROUP_CONCAT(DISTINCT tt.kind) FROM ticket_types tt WHERE tt.event_id = e.id AND tt.hidden = 0) AS kinds,
              (g.pro_until IS NOT NULL AND g.pro_until > NOW()) AS org_pro
         FROM events e JOIN organizations g ON g.id = e.organization_id LEFT JOIN venues v ON v.id = e.venue_id WHERE e.id = ?`, [eventId])
    : null;
  // Fattixx Pro (plan 5.7.2): no platform or third-party ads on a Pro organizer's events (their pages, order pages,
  // emails, check-in); only the organizer's own sponsor campaigns.
  const proOnly = !!ev && !!Number(ev.org_pro);
  const candidates = await query<Candidate>(
    `SELECT c.id, c.kind, c.organization_id, c.event_id, c.advertiser_name, c.weight, c.priority, c.targeting
       FROM ad_campaigns c JOIN ad_campaign_placements p ON p.campaign_id = c.id AND p.placement = ?
      WHERE c.status = 'active' AND (c.starts_at IS NULL OR c.starts_at <= NOW()) AND (c.ends_at IS NULL OR c.ends_at > NOW())
        AND (c.event_id IS NULL OR c.event_id = ?)
        AND (c.advertiser_id IS NULL OR c.payment_status = 'paid')
        AND (c.impressions_cap IS NULL OR c.impressions_served < c.impressions_cap)
        AND ${proOnly ? 'c.organization_id = ?' : '(c.organization_id IS NULL OR c.organization_id = ?)'}
        AND EXISTS (SELECT 1 FROM ad_creatives cr WHERE cr.campaign_id = c.id)`,
    [placement, eventId, ev ? Number(ev.organization_id) : 0],
  );
  const evFacts: AdEventFacts | null = ev
    ? { region: ev.region, city: ev.city, age: ev.age_restriction, startsAt: new Date(ev.starts_at), category: ev.category, ticketKinds: (ev.kinds ?? '').split(',').filter(Boolean) }
    : null;
  const viewer: AdViewerFacts = { signedIn: !!ctx.signedIn, roles: ctx.roles ?? [ctx.signedIn ? 'attendee' : 'guest'], ticketKinds: ctx.ticketKinds };
  const eligible = candidates.filter((c) => matchesTargeting(parseTargeting(c.targeting), evFacts, viewer));
  if (!eligible.length) return null;
  const top = Math.max(...eligible.map((c) => Number(c.priority)));
  const pool = eligible.filter((c) => Number(c.priority) === top);
  const total = pool.reduce((n, c) => n + Math.max(1, Number(c.weight)), 0);
  let r = Math.random() * total;
  const chosen = pool.find((c) => (r -= Math.max(1, Number(c.weight))) < 0) ?? pool[0];
  const creatives = await query<Row & { id: number; image_path: string | null; alt_text: string; headline: string | null; body: string | null }>(
    `SELECT id, image_path, alt_text, headline, body FROM ad_creatives WHERE campaign_id = ?`, [chosen.id],
  );
  const cr = creatives[Math.floor(Math.random() * creatives.length)];
  const token = adToken(Number(chosen.id), Number(cr.id), placement, eventId);
  return {
    campaignId: Number(chosen.id), creativeId: Number(cr.id), placement, eventId,
    imageUrl: uploadUrl(cr.image_path), alt: cr.alt_text, headline: cr.headline, body: cr.body, advertiser: chosen.advertiser_name, kind: chosen.kind,
    token, clickUrl: `/api/ads/click?d=${encodeURIComponent(token)}`,
  };
}

export async function recordAdStat(t: { campaignId: number; creativeId: number; placement: string; eventId: number }, kind: 'impression' | 'click'): Promise<void> {
  const col = kind === 'click' ? 'clicks' : 'impressions';
  await execute(
    `INSERT INTO ad_stats (campaign_id, creative_id, placement, event_id, day, ${col}) VALUES (?, ?, ?, ?, UTC_DATE(), 1)
     ON DUPLICATE KEY UPDATE ${col} = ${col} + 1`,
    [t.campaignId, t.creativeId, t.placement, t.eventId],
  );
  // Bought impressions (advertiser portal): count towards the cap; the campaign stops serving once it is reached.
  if (kind === 'impression') await execute(`UPDATE ad_campaigns SET impressions_served = impressions_served + 1 WHERE id = ? AND impressions_cap IS NOT NULL`, [t.campaignId]);
}

/** Destination for a click, read from the campaign (never from the URL, so the endpoint is not an open redirect). */
export async function adDestination(campaignId: number): Promise<string | null> {
  const r = await queryOne<Row & { destination_url: string }>(`SELECT destination_url FROM ad_campaigns WHERE id = ?`, [campaignId]);
  return r?.destination_url ?? null;
}

/** Static ad block for emails (plan 14.3): image + sponsored label, impression pixel, tracked link. Empty string when no ad is active. */
export async function adHtmlForEmail(eventId: number | null, order?: { id: number; userId: number | null }): Promise<string> {
  const ad = await pickAd('email', order
    ? { eventId, signedIn: !!order.userId, roles: await viewerRoles(order.userId), ticketKinds: await orderTicketKinds(order.id) }
    : { eventId });
  if (!ad) return '';
  const base = env.APP_URL;
  const img = ad.imageUrl ? `<img src="${base}${ad.imageUrl}" alt="${escapeHtml(ad.alt)}" width="552" style="display:block;width:100%;max-width:552px;border-radius:12px">` : '';
  const text = [ad.headline ? `<strong>${escapeHtml(ad.headline)}</strong>` : '', ad.body ? escapeHtml(ad.body) : ''].filter(Boolean).join('<br>');
  return `<div style="margin-top:24px;border-top:1px solid #EFD4D6;padding-top:14px">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#BB464C">Sponsored${ad.advertiser ? ` · ${escapeHtml(ad.advertiser)}` : ''}</p>
<a href="${base}${ad.clickUrl}" style="color:#2A0A0C;text-decoration:none">${img}${text ? `<p style="margin:8px 0 0">${text}</p>` : ''}</a>
<img src="${base}/api/ads/px?d=${encodeURIComponent(ad.token)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px">
</div>`;
}
