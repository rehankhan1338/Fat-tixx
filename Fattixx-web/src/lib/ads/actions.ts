'use server';

import { revalidatePath } from 'next/cache';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertOrg, canAccessEvent } from '../authz';
import { getSession } from '../auth/session';
import { getEvent } from '../events/queries';
import { wallClockToUtc } from '../tz';
import { deleteUpload, saveImageUpload } from '../uploads';
import { ADVERTISER_PLACEMENTS, PLACEMENTS, TICKET_KINDS, VIEWER_ROLES, type AdTargeting } from './placements';
import { approvedAdvertiser } from './advertisers';

/**
 * Ad campaign management (plan 14.6 / 14.7).
 *  - Super Admin: every campaign, any placement, activate / pause / delete.
 *  - Organization Admin / Organizer: sponsor campaigns limited to their own event (event detail and
 *    order confirmation placements). They are created as drafts and go live only after a Super Admin activates them.
 *  - Approved advertisers (self-service portal, /advertiser; lib/ads/advertisers.ts): their own campaigns on the
 *    advertiser placements, with targeting. Paid through Stripe Checkout, then reviewed by a Super Admin.
 */
export type ActionState = { error?: string; ok?: boolean; message?: string; id?: number } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);
const PLATFORM_TZ = 'America/New_York';
const ORG_PLACEMENTS = ['event_detail', 'order_confirmation'];

type CampaignAuth = { userId: number; isSuper: boolean; orgId: number | null; eventId: number | null; orgSlug: string | null; advertiserId: number | null; advertiserName?: string };

/** Who is acting, and on whose behalf. Org callers pass `org` + `event` and are confined to that event; advertisers pass `advertiser`. */
async function authorize(fd: FormData): Promise<CampaignAuth> {
  const orgSlug = str(fd, 'org', 64);
  if (orgSlug) {
    const ctx = await assertOrg(orgSlug, 'organizer');
    const event = await getEvent(ctx.org.id, Number(fd.get('event')));
    if (!event || !(await canAccessEvent(ctx, event))) throw new Error('Event not found');
    return { userId: ctx.session.user.id, isSuper: ctx.isSuperAdmin, orgId: ctx.org.id, eventId: event.id, orgSlug, advertiserId: null };
  }
  const session = await getSession();
  if (fd.get('advertiser')) {
    if (!session) throw new Error('Please sign in again.');
    const adv = await approvedAdvertiser(session.user.id);
    if (!adv) throw new Error('Your advertiser account is not approved yet.');
    return { userId: session.user.id, isSuper: false, orgId: null, eventId: null, orgSlug: null, advertiserId: Number(adv.id), advertiserName: adv.company_name };
  }
  if (!session || !session.user.roles.includes('super_admin')) throw new Error('Only a Super Admin can manage platform ads.');
  return { userId: session.user.id, isSuper: true, orgId: null, eventId: null, orgSlug: null, advertiserId: null };
}

async function loadOwned(id: number, auth: CampaignAuth) {
  const c = await queryOne<Row & { id: number; organization_id: number | null; event_id: number | null; advertiser_id: number | null; status: string; payment_status: string | null; review_status: string }>(
    `SELECT id, organization_id, event_id, advertiser_id, status, payment_status, review_status FROM ad_campaigns WHERE id = ?`, [id]);
  if (!c) return null;
  if (auth.orgId && !(Number(c.organization_id) === auth.orgId && Number(c.event_id) === auth.eventId)) return null;
  if (auth.advertiserId && Number(c.advertiser_id) !== auth.advertiserId) return null;
  return c;
}

function revalidate(auth: CampaignAuth, id?: number) {
  revalidatePath('/admin/ads');
  if (id) revalidatePath(`/admin/ads/${id}`);
  if (auth.orgSlug) revalidatePath(`/org/${auth.orgSlug}/events/${auth.eventId}`);
  if (auth.advertiserId) { revalidatePath('/advertiser'); if (id) revalidatePath(`/advertiser/campaigns/${id}`); }
}

/** An advertiser's edit to a paid campaign goes back for review (and off the air until approved again). */
async function backToReview(c: { id: number; status: string; payment_status: string | null }) {
  if (c.payment_status === 'paid') await execute(`UPDATE ad_campaigns SET status = 'draft', review_status = 'submitted' WHERE id = ?`, [c.id]);
}

function parseList(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50);
}

function triState(v: string): boolean | undefined {
  return v === 'yes' ? true : v === 'no' ? false : undefined;
}

export async function saveCampaign(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let auth: CampaignAuth;
  try { auth = await authorize(fd); } catch (e) { return { error: (e as Error).message }; }
  const id = Number(fd.get('id')) || null;
  const name = str(fd, 'name', 160);
  const destination = str(fd, 'destination_url', 500);
  if (name.length < 2) return { error: 'Give the campaign a name.' };
  if (!/^https?:\/\/[^\s]+$/i.test(destination)) return { error: 'Destination must be a full http(s):// URL.' };
  const startsAt = str(fd, 'starts_at', 20) ? wallClockToUtc(str(fd, 'starts_at', 20), PLATFORM_TZ) : null;
  const endsAt = str(fd, 'ends_at', 20) ? wallClockToUtc(str(fd, 'ends_at', 20), PLATFORM_TZ) : null;
  if (startsAt && endsAt && endsAt <= startsAt) return { error: 'The end date must be after the start date.' };
  const allowed: string[] = auth.orgId ? ORG_PLACEMENTS : auth.advertiserId ? [...ADVERTISER_PLACEMENTS] : PLACEMENTS.map((p) => p.key as string);
  const placements = allowed.filter((k) => fd.get(`pl_${k}`));
  if (!placements.length) return { error: 'Choose at least one placement.' };
  const targeting: AdTargeting = {
    regions: parseList(str(fd, 't_regions', 300)), cities: parseList(str(fd, 't_cities', 300)),
    ageRestricted: triState(str(fd, 't_age', 5)), signedIn: triState(str(fd, 't_signed', 5)),
    daysBeforeEvent: Number(str(fd, 't_days', 4)) || undefined,
    categories: fd.getAll('t_category').map((v) => String(v).trim().slice(0, 40)).filter(Boolean).slice(0, 50),
    ticketKinds: TICKET_KINDS.map((k) => k.key).filter((k) => fd.get(`t_kind_${k}`)),
    roles: VIEWER_ROLES.map((r) => r.key).filter((r) => fd.get(`t_role_${r}`)),
  };
  const weight = auth.advertiserId ? 1 : Math.min(100, Math.max(1, Number(str(fd, 'weight', 4)) || 1));
  const priority = auth.isSuper ? Math.min(100, Math.max(-100, Number(str(fd, 'priority', 4)) || 0)) : 0;
  const kind = auth.orgId || auth.advertiserId ? 'sponsored' : (['platform', 'sponsored', 'contextual'].includes(str(fd, 'kind', 20)) ? str(fd, 'kind', 20) : 'platform');
  const restrictEvent = auth.orgId ? auth.eventId : auth.advertiserId ? null : (Number(fd.get('event_id')) || null);
  // An advertiser's ads are always labelled with their company name.
  const advertiserName = auth.advertiserId ? auth.advertiserName ?? null : str(fd, 'advertiser_name', 160) || null;
  const vals = [name, kind, advertiserName, str(fd, 'advertiser_contact', 255) || null, startsAt, endsAt, weight, priority, destination, JSON.stringify(targeting)];

  let campaignId: number;
  if (id) {
    const c = await loadOwned(id, auth);
    if (!c) return { error: 'Campaign not found.' };
    await execute(
      `UPDATE ad_campaigns SET name = ?, kind = ?, advertiser_name = ?, advertiser_contact = ?, starts_at = ?, ends_at = ?, weight = ?, priority = ?, destination_url = ?, targeting = ?, event_id = ? WHERE id = ?`,
      [...vals, restrictEvent, id],
    );
    // An organizer's edit to a live sponsor ad goes back for approval; an advertiser's edit to a paid campaign goes back for review.
    if (auth.advertiserId) await backToReview(c);
    else if (!auth.isSuper && c.status === 'active') await execute(`UPDATE ad_campaigns SET status = 'draft' WHERE id = ?`, [id]);
    campaignId = id;
    await audit('ad.updated', { actorUserId: auth.userId, targetType: 'ad_campaign', targetId: id });
  } else {
    const r = await execute(
      `INSERT INTO ad_campaigns (name, kind, advertiser_name, advertiser_contact, starts_at, ends_at, weight, priority, destination_url, targeting, event_id, organization_id, advertiser_id, payment_status, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [...vals, restrictEvent, auth.orgId, auth.advertiserId, auth.advertiserId ? 'unpaid' : null, auth.userId],
    );
    campaignId = r.insertId;
    await audit('ad.created', { actorUserId: auth.userId, targetType: 'ad_campaign', targetId: campaignId, metadata: { orgId: auth.orgId } });
  }
  await execute(`DELETE FROM ad_campaign_placements WHERE campaign_id = ?`, [campaignId]);
  for (const p of placements) await execute(`INSERT INTO ad_campaign_placements (campaign_id, placement) VALUES (?, ?)`, [campaignId, p]);
  revalidate(auth, campaignId);
  return { ok: true, id: campaignId, message: auth.isSuper ? 'Campaign saved.' : auth.advertiserId ? 'Saved. Add a creative, then buy impressions and submit it for review.' : 'Saved. A Fattixx admin reviews sponsor ads before they go live.' };
}

export async function addCreative(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let auth: CampaignAuth;
  try { auth = await authorize(fd); } catch (e) { return { error: (e as Error).message }; }
  const c = await loadOwned(Number(fd.get('campaign_id')), auth);
  if (!c) return { error: 'Campaign not found.' };
  const alt = str(fd, 'alt_text', 200);
  if (alt.length < 3) return { error: 'Describe the image (alt text) for screen-reader users.' };
  const file = fd.get('image');
  let imagePath: string | null = null;
  if (file instanceof File && file.size > 0) {
    try { imagePath = await saveImageUpload(file, 'ads', 1200); } catch (e) { return { error: (e as Error).message }; }
  }
  const headline = str(fd, 'headline', 120) || null;
  if (!imagePath && !headline) return { error: 'Add an image or at least a headline.' };
  await execute(`INSERT INTO ad_creatives (campaign_id, image_path, alt_text, headline, body) VALUES (?, ?, ?, ?, ?)`, [c.id, imagePath, alt, headline, str(fd, 'body', 300) || null]);
  if (auth.advertiserId) await backToReview(c);
  else if (!auth.isSuper && c.status === 'active') await execute(`UPDATE ad_campaigns SET status = 'draft' WHERE id = ?`, [c.id]);
  await audit('ad.updated', { actorUserId: auth.userId, targetType: 'ad_campaign', targetId: c.id, metadata: { creative: 'added' } });
  revalidate(auth, Number(c.id));
  return { ok: true, message: 'Creative added.' };
}

export async function deleteCreative(fd: FormData): Promise<ActionState> {
  let auth: CampaignAuth;
  try { auth = await authorize(fd); } catch (e) { return { error: (e as Error).message }; }
  const cr = await queryOne<Row & { id: number; campaign_id: number; image_path: string | null }>(`SELECT id, campaign_id, image_path FROM ad_creatives WHERE id = ?`, [Number(fd.get('creative_id'))]);
  if (!cr || !(await loadOwned(Number(cr.campaign_id), auth))) return { error: 'Creative not found.' };
  await execute(`DELETE FROM ad_creatives WHERE id = ?`, [cr.id]);
  await deleteUpload(cr.image_path);
  await audit('ad.updated', { actorUserId: auth.userId, targetType: 'ad_campaign', targetId: cr.campaign_id, metadata: { creative: 'deleted' } });
  revalidate(auth, Number(cr.campaign_id));
  return { ok: true };
}

/** Super Admin: draft / active / paused. Organizers may only pause their sponsor ad or return it to draft. */
export async function setCampaignStatus(fd: FormData): Promise<ActionState> {
  let auth: CampaignAuth;
  try { auth = await authorize(fd); } catch (e) { return { error: (e as Error).message }; }
  const c = await loadOwned(Number(fd.get('id')), auth);
  if (!c) return { error: 'Campaign not found.' };
  const status = str(fd, 'status', 10);
  if (!['draft', 'active', 'paused'].includes(status)) return { error: 'Unknown status.' };
  // An advertiser may resume a campaign Fattixx already approved; everything else is activated by a Super Admin after review.
  const resumeApproved = !!auth.advertiserId && c.review_status === 'approved' && c.payment_status === 'paid';
  if (!auth.isSuper && status === 'active' && !resumeApproved) return { error: 'A Fattixx admin activates sponsor ads after review.' };
  if (status === 'active' && c.advertiser_id && c.payment_status !== 'paid') return { error: 'This advertiser campaign has not been paid for yet.' };
  if (status === 'active') {
    const n = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM ad_creatives WHERE campaign_id = ?`, [c.id]);
    if (!Number(n?.n)) return { error: 'Add at least one creative before activating.' };
  }
  await execute(`UPDATE ad_campaigns SET status = ? WHERE id = ?`, [status, c.id]);
  if (auth.isSuper && status === 'active' && c.advertiser_id) await execute(`UPDATE ad_campaigns SET review_status = 'approved', review_notes = NULL WHERE id = ?`, [c.id]);
  await audit('ad.status.changed', { actorUserId: auth.userId, targetType: 'ad_campaign', targetId: c.id, metadata: { from: c.status, to: status } });
  revalidate(auth, Number(c.id));
  return { ok: true };
}

export async function deleteCampaign(fd: FormData): Promise<ActionState> {
  let auth: CampaignAuth;
  try { auth = await authorize(fd); } catch (e) { return { error: (e as Error).message }; }
  const c = await loadOwned(Number(fd.get('id')), auth);
  if (!c) return { error: 'Campaign not found.' };
  if (auth.advertiserId && c.payment_status && c.payment_status !== 'unpaid') return { error: 'A paid campaign can be paused, not deleted. Contact Fattixx about a refund.' };
  const imgs = await query<Row & { image_path: string | null }>(`SELECT image_path FROM ad_creatives WHERE campaign_id = ?`, [c.id]);
  await execute(`DELETE FROM ad_campaigns WHERE id = ?`, [c.id]);
  for (const i of imgs) await deleteUpload(i.image_path);
  await audit('ad.deleted', { actorUserId: auth.userId, targetType: 'ad_campaign', targetId: c.id });
  revalidate(auth);
  return { ok: true };
}
