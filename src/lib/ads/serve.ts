import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { execute, query, queryOne, type Row } from '../db';
import { env } from '../env';
import { escapeHtml } from '../email';
import { uploadUrl } from '../uploads';
import type { AdTargeting, PlacementKey } from './placements';

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

export type AdContext = { eventId?: number | null; signedIn?: boolean };

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

function matchesTargeting(raw: string | null, ev: { region: string | null; city: string | null; age: number | null; startsAt: Date | null } | null, ctx: AdContext): boolean {
  if (!raw) return true;
  let t: AdTargeting;
  try { t = JSON.parse(raw) as AdTargeting; } catch { return true; }
  const norm = (s: string) => s.trim().toLowerCase();
  if (t.regions?.length && !(ev?.region && t.regions.map(norm).includes(norm(ev.region)))) return false;
  if (t.cities?.length && !(ev?.city && t.cities.map(norm).includes(norm(ev.city)))) return false;
  if (t.ageRestricted !== undefined && t.ageRestricted !== null && !!ev?.age !== t.ageRestricted) return false;
  if (t.signedIn !== undefined && t.signedIn !== null && !!ctx.signedIn !== t.signedIn) return false;
  if (t.daysBeforeEvent && (!ev?.startsAt || ev.startsAt.getTime() - Date.now() > t.daysBeforeEvent * 86_400_000)) return false;
  return true;
}

export async function pickAd(placement: PlacementKey, ctx: AdContext = {}): Promise<ServedAd | null> {
  const eventId = ctx.eventId ? Number(ctx.eventId) : 0;
  const ev = eventId
    ? await queryOne<Row & { organization_id: number; region: string | null; city: string | null; age_restriction: number | null; starts_at: Date }>(
      `SELECT e.organization_id, v.region, v.city, e.age_restriction, e.starts_at FROM events e LEFT JOIN venues v ON v.id = e.venue_id WHERE e.id = ?`, [eventId])
    : null;
  const candidates = await query<Candidate>(
    `SELECT c.id, c.kind, c.organization_id, c.event_id, c.advertiser_name, c.weight, c.priority, c.targeting
       FROM ad_campaigns c JOIN ad_campaign_placements p ON p.campaign_id = c.id AND p.placement = ?
      WHERE c.status = 'active' AND (c.starts_at IS NULL OR c.starts_at <= NOW()) AND (c.ends_at IS NULL OR c.ends_at > NOW())
        AND (c.event_id IS NULL OR c.event_id = ?)
        AND (c.organization_id IS NULL OR c.organization_id = ?)
        AND EXISTS (SELECT 1 FROM ad_creatives cr WHERE cr.campaign_id = c.id)`,
    [placement, eventId, ev ? Number(ev.organization_id) : 0],
  );
  const evCtx = ev ? { region: ev.region, city: ev.city, age: ev.age_restriction, startsAt: new Date(ev.starts_at) } : null;
  const eligible = candidates.filter((c) => matchesTargeting(c.targeting, evCtx, ctx));
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
}

/** Destination for a click, read from the campaign (never from the URL, so the endpoint is not an open redirect). */
export async function adDestination(campaignId: number): Promise<string | null> {
  const r = await queryOne<Row & { destination_url: string }>(`SELECT destination_url FROM ad_campaigns WHERE id = ?`, [campaignId]);
  return r?.destination_url ?? null;
}

/** Static ad block for emails (plan 14.3): image + sponsored label, impression pixel, tracked link. Empty string when no ad is active. */
export async function adHtmlForEmail(eventId: number | null): Promise<string> {
  const ad = await pickAd('email', { eventId });
  if (!ad) return '';
  const base = env.APP_URL;
  const img = ad.imageUrl ? `<img src="${base}${ad.imageUrl}" alt="${escapeHtml(ad.alt)}" width="552" style="display:block;width:100%;max-width:552px;border-radius:8px">` : '';
  const text = [ad.headline ? `<strong>${escapeHtml(ad.headline)}</strong>` : '', ad.body ? escapeHtml(ad.body) : ''].filter(Boolean).join('<br>');
  return `<div style="margin-top:24px;border-top:1px solid #e4e4e7;padding-top:12px">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#71717a">Sponsored${ad.advertiser ? ` · ${escapeHtml(ad.advertiser)}` : ''}</p>
<a href="${base}${ad.clickUrl}" style="color:#18181b;text-decoration:none">${img}${text ? `<p style="margin:8px 0 0">${text}</p>` : ''}</a>
<img src="${base}/api/ads/px?d=${encodeURIComponent(ad.token)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px">
</div>`;
}
