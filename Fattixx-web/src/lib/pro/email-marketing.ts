import 'server-only';
import { execute, query, queryOne, type Row } from '../db';
import { env } from '../env';
import { sendEmail, type MailEnvelope } from '../email';
import { EMAIL_THEME } from '../email-templates';
import { publicEventPath } from '../events/queries';
import { getBranding } from '../settings';
import { hmacHex, safeEqual, sha256 } from '../security/crypto';
import { uploadUrl } from '../uploads';
import { normalizeHex } from './brand-colors';
import { applyMergeTags, bodyToHtml, campaignHtml, campaignLinks, campaignText, firstNameOf, type CampaignLayout } from './campaign-render';
import { publicOriginFor } from './domains';
import { parseRules, segmentWhere, type SegmentRules } from './segments';
import { isProActive } from './status';

/**
 * Email marketing (Fattixx Pro, plan 5.7.2).
 *
 *  - Consent: only buyers who ticked "Email me about future events from this organizer" at checkout become contacts,
 *    with the order that gave consent. Unsubscribing (link, one-click header or the organizer) is per organization and
 *    is only lifted by a newer opt-in at a later checkout.
 *  - Audiences: every subscribed contact, or a segment (lib/pro/segments.ts). The audience is frozen when sending starts.
 *  - Scheduling and sending: the background jobs (lib/jobs.ts) start due campaigns and send in batches through the
 *    email outbox (retries included); contacts who unsubscribe meanwhile are skipped. Campaigns pause when Pro ends.
 *  - Stats: opens (tracking image; approximate, as some mail apps load images automatically) and clicks (links
 *    redirect through /api/email/c, only to links stored for the campaign), unsubscribes and failed deliveries.
 *  - CAN-SPAM: the organizer's postal address and an unsubscribe link in every email, List-Unsubscribe headers.
 */
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'canceled';
export type CampaignRow = Row & {
  id: number; organization_id: number; name: string; subject: string; preheader: string | null; body: string; event_id: number | null; segment_id: number | null;
  status: CampaignStatus; scheduled_at: Date | null; started_at: Date | null; finished_at: Date | null; paused_reason: string | null; recipients: number; created_at: Date; updated_at: Date;
};
type OrgForMail = Row & { id: number; slug: string; name: string; logo_path: string | null; contact_email: string; mailing_address: string | null; brand_primary: string | null; brand_accent: string | null; pro_until: Date | null };

const PAID_OR_REFUNDED = `o.status IN ('paid','partially_refunded','refunded')`;

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/** Copy opted-in buyers into marketing_contacts and refresh everyone's purchase totals. Idempotent. */
export async function syncContacts(orgId: number): Promise<void> {
  await execute(
    `INSERT INTO marketing_contacts (organization_id, email, name, consent_at, consent_source, first_order_at, last_order_at, orders_count, tickets_count, spent_cents)
     SELECT * FROM (
       SELECT o.organization_id, o.buyer_email, MAX(o.buyer_name) AS buyer_name,
              MAX(IF(o.marketing_opt_in = 1, o.paid_at, NULL)) AS opt_in_at,
              CONCAT('checkout:', SUBSTRING_INDEX(GROUP_CONCAT(IF(o.marketing_opt_in = 1, o.code, NULL) ORDER BY o.paid_at DESC SEPARATOR ','), ',', 1)) AS opt_in_source,
              MIN(o.paid_at) AS first_paid, MAX(o.paid_at) AS last_paid, COUNT(*) AS n_orders,
              COALESCE(SUM((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id)), 0) AS n_tickets,
              COALESCE(SUM(GREATEST(CAST(o.total_cents AS SIGNED) - CAST(o.refunded_cents AS SIGNED), 0)), 0) AS spent
         FROM orders o
        WHERE o.organization_id = ? AND ${PAID_OR_REFUNDED} AND o.paid_at IS NOT NULL
        GROUP BY o.organization_id, o.buyer_email
       HAVING MAX(o.marketing_opt_in) = 1
     ) AS src
     ON DUPLICATE KEY UPDATE
       unsubscribed_at = IF(VALUES(consent_at) IS NOT NULL AND unsubscribed_at IS NOT NULL AND VALUES(consent_at) > unsubscribed_at, NULL, unsubscribed_at),
       unsubscribe_source = IF(unsubscribed_at IS NULL, NULL, unsubscribe_source),
       consent_source = IF(consent_at IS NULL OR VALUES(consent_at) > consent_at, VALUES(consent_source), consent_source),
       consent_at = GREATEST(COALESCE(consent_at, VALUES(consent_at)), VALUES(consent_at)),
       name = COALESCE(VALUES(name), name), first_order_at = VALUES(first_order_at), last_order_at = VALUES(last_order_at),
       orders_count = VALUES(orders_count), tickets_count = VALUES(tickets_count), spent_cents = VALUES(spent_cents)`,
    [orgId],
  );
}

const SUBSCRIBED = 'c.unsubscribed_at IS NULL AND c.consent_at IS NOT NULL';

export async function audienceSize(orgId: number, rules: SegmentRules | null): Promise<number> {
  const w = segmentWhere(rules ?? {});
  const r = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM marketing_contacts c WHERE c.organization_id = ? AND ${SUBSCRIBED} AND ${w.sql}`, [orgId, ...w.params]);
  return Number(r?.n ?? 0);
}

export async function contactCounts(orgId: number): Promise<{ subscribed: number; unsubscribed: number }> {
  const r = await queryOne<Row & { s: number; u: number }>(
    `SELECT SUM(unsubscribed_at IS NULL AND consent_at IS NOT NULL) AS s, SUM(unsubscribed_at IS NOT NULL) AS u FROM marketing_contacts WHERE organization_id = ?`, [orgId],
  );
  return { subscribed: Number(r?.s ?? 0), unsubscribed: Number(r?.u ?? 0) };
}

export type ContactRow = Row & { id: number; email: string; name: string | null; consent_at: Date | null; consent_source: string | null; unsubscribed_at: Date | null; unsubscribe_source: string | null; orders_count: number; tickets_count: number; spent_cents: number; last_order_at: Date | null };

export async function listContacts(orgId: number, opts: { q?: string; status?: 'subscribed' | 'unsubscribed' | 'all'; limit: number; offset: number }): Promise<{ rows: ContactRow[]; total: number }> {
  const where = ['c.organization_id = ?'];
  const params: (string | number)[] = [orgId];
  if (opts.status === 'subscribed') where.push(SUBSCRIBED);
  if (opts.status === 'unsubscribed') where.push('c.unsubscribed_at IS NOT NULL');
  if (opts.q) { where.push('(c.email LIKE ? OR c.name LIKE ?)'); const like = `%${opts.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`; params.push(like, like); }
  const [rows, total] = await Promise.all([
    query<ContactRow>(`SELECT c.* FROM marketing_contacts c WHERE ${where.join(' AND ')} ORDER BY c.last_order_at DESC, c.id DESC LIMIT ? OFFSET ?`, [...params, opts.limit, opts.offset]),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM marketing_contacts c WHERE ${where.join(' AND ')}`, params),
  ]);
  return { rows, total: Number(total?.n ?? 0) };
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
export async function getCampaign(orgId: number, id: number): Promise<CampaignRow | null> {
  return queryOne<CampaignRow>(`SELECT * FROM marketing_campaigns WHERE id = ? AND organization_id = ?`, [id, orgId]);
}

export type CampaignStats = { recipients: number; sent: number; failed: number; skipped: number; queued: number; opened: number; clicked: number; unsubscribed: number; opens: number; clicks: number };

export async function campaignStats(campaignIds: number[]): Promise<Map<number, CampaignStats>> {
  if (!campaignIds.length) return new Map();
  const rows = await query<Row & { campaign_id: number } & Record<keyof CampaignStats, number>>(
    `SELECT s.campaign_id, COUNT(*) AS recipients, SUM(s.status = 'sent' AND (eo.status IS NULL OR eo.status <> 'failed')) AS sent,
            SUM(s.status = 'failed' OR eo.status = 'failed') AS failed, SUM(s.status = 'skipped') AS skipped, SUM(s.status = 'queued') AS queued,
            SUM(s.opened_at IS NOT NULL) AS opened, SUM(s.clicked_at IS NOT NULL) AS clicked, SUM(s.unsubscribed_at IS NOT NULL) AS unsubscribed,
            COALESCE(SUM(s.opens), 0) AS opens, COALESCE(SUM(s.clicks), 0) AS clicks
       FROM marketing_sends s LEFT JOIN email_outbox eo ON eo.id = s.outbox_id
      WHERE s.campaign_id IN (${campaignIds.map(() => '?').join(',')}) GROUP BY s.campaign_id`, campaignIds,
  );
  const out = new Map<number, CampaignStats>();
  for (const r of rows) {
    const n = (k: keyof CampaignStats) => Number(r[k] ?? 0);
    out.set(Number(r.campaign_id), { recipients: n('recipients'), sent: n('sent'), failed: n('failed'), skipped: n('skipped'), queued: n('queued'), opened: n('opened'), clicked: n('clicked'), unsubscribed: n('unsubscribed'), opens: n('opens'), clicks: n('clicks') });
  }
  return out;
}

export async function campaignLinkStats(campaignId: number) {
  return query<Row & { id: number; url: string; clicks: number }>(`SELECT id, url, clicks FROM marketing_links WHERE campaign_id = ? ORDER BY clicks DESC, id`, [campaignId]);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
async function orgForMail(orgId: number): Promise<OrgForMail | null> {
  return queryOne<OrgForMail>(`SELECT id, slug, name, logo_path, contact_email, mailing_address, brand_primary, brand_accent, pro_until FROM organizations WHERE id = ?`, [orgId]);
}

async function eventButton(c: Pick<CampaignRow, 'event_id' | 'organization_id'>): Promise<{ label: string; href: string } | null> {
  if (!c.event_id) return null;
  const e = await queryOne<Row & { slug: string; visibility: string; private_key: string | null; status: string }>(
    `SELECT slug, visibility, private_key, status FROM events WHERE id = ? AND organization_id = ?`, [c.event_id, c.organization_id],
  );
  if (!e || !['published', 'postponed'].includes(e.status)) return null;
  return { label: 'Get tickets', href: `${await publicOriginFor(Number(c.organization_id))}${publicEventPath(e)}` };
}

type Recipient = { email: string; name: string | null; sendId: number | null };

async function renderCampaign(c: Pick<CampaignRow, 'id' | 'subject' | 'preheader' | 'body' | 'event_id' | 'organization_id'>, org: OrgForMail, to: Recipient, links: Map<string, number> | null) {
  const brand = await getBranding();
  const vars = { first_name: firstNameOf(to.name), name: to.name, org_name: org.name };
  const token = to.sendId ? sendToken(to.sendId) : null;
  const base = env.APP_URL;
  const track = (href: string) => {
    const id = links?.get(href);
    return token && id ? `${base}/api/email/c/${token}/${id}` : href;
  };
  const button = await eventButton(c);
  const primary = normalizeHex(org.brand_primary) ?? EMAIL_THEME.red;
  const accent = normalizeHex(org.brand_accent) ?? EMAIL_THEME.yellow;
  const logo = uploadUrl(org.logo_path);
  const layout: CampaignLayout = {
    orgName: org.name, logoUrl: logo ? (/^https?:/.test(logo) ? logo : base + logo) : null, primary, accent,
    mailingAddress: org.mailing_address || '(mailing address)', platformName: brand.name,
    subject: applyMergeTags(c.subject, vars), preheader: c.preheader ? applyMergeTags(c.preheader, vars) : null,
    bodyHtml: bodyToHtml(applyMergeTags(c.body, vars), track, primary),
    button: button ? { label: button.label, href: track(button.href) } : null,
    unsubscribeUrl: token ? `${base}/unsubscribe/${token}` : `${base}/unsubscribe/preview`,
    openPixelUrl: token ? `${base}/api/email/o/${token}` : null,
  };
  const envelope: MailEnvelope = {
    fromName: `${org.name.replace(/[\r\n"]/g, '').slice(0, 60)} via ${brand.name}`,
    replyTo: org.contact_email,
    headers: token ? { 'List-Unsubscribe': `<${base}/api/email/unsubscribe/${token}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
  };
  return { subject: layout.subject, html: campaignHtml(layout), text: campaignText(applyMergeTags(c.body, vars), { ...layout, button: button }), envelope };
}

/** Preview in the editor (no tracking). */
export async function previewCampaign(orgId: number, draft: { subject: string; preheader: string | null; body: string; event_id: number | null }, viewer: { email: string; name: string | null }) {
  const org = await orgForMail(orgId);
  if (!org) throw new Error('Organization not found');
  return renderCampaign({ id: 0, organization_id: orgId, ...draft }, org, { ...viewer, sendId: null }, null);
}

/** Test send to the person editing (no tracking, not counted). */
export async function sendCampaignTest(orgId: number, c: CampaignRow, to: { email: string; name: string | null }): Promise<void> {
  const mail = await previewCampaign(orgId, c, to);
  await sendEmail({ to: to.email, toName: to.name, subject: `[Test] ${mail.subject}`, text: mail.text, html: mail.html, category: 'marketing', envelope: { ...mail.envelope, headers: undefined }, related: { type: 'campaign_test', id: c.id } });
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
async function pause(campaignId: number, reason: string) {
  await execute(`UPDATE marketing_campaigns SET status = 'paused', paused_reason = ? WHERE id = ? AND status IN ('scheduled','sending')`, [reason.slice(0, 200), campaignId]);
}

/** scheduled → sending: freeze the audience and the campaign's links. Returns the number of recipients (null if not started). */
export async function startCampaign(campaignId: number): Promise<number | null> {
  const claim = await execute(`UPDATE marketing_campaigns SET status = 'sending', started_at = COALESCE(started_at, NOW()), paused_reason = NULL WHERE id = ? AND status = 'scheduled'`, [campaignId]);
  if (!claim.affectedRows) return null;
  const c = await queryOne<CampaignRow>(`SELECT * FROM marketing_campaigns WHERE id = ?`, [campaignId]);
  const org = c ? await orgForMail(Number(c.organization_id)) : null;
  if (!c || !org) return null;
  if (!isProActive(org.pro_until)) { await pause(campaignId, 'Fattixx Pro ended'); return null; }
  if (!org.mailing_address) { await pause(campaignId, 'Add your mailing address in Email settings, then resume'); return null; }
  await syncContacts(Number(org.id));
  const seg = c.segment_id ? await queryOne<Row & { rules: string | object }>(`SELECT rules FROM marketing_segments WHERE id = ? AND organization_id = ?`, [c.segment_id, org.id]) : null;
  const w = segmentWhere(parseRules(seg?.rules ?? null));
  // A paused campaign that resumes keeps its frozen audience; INSERT IGNORE adds nobody twice.
  await execute(
    `INSERT IGNORE INTO marketing_sends (campaign_id, contact_id, email)
     SELECT ?, c.id, c.email FROM marketing_contacts c WHERE c.organization_id = ? AND ${SUBSCRIBED} AND ${w.sql}`,
    [campaignId, org.id, ...w.params],
  );
  const total = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM marketing_sends WHERE campaign_id = ?`, [campaignId]);
  await execute(`UPDATE marketing_campaigns SET recipients = ? WHERE id = ?`, [Number(total?.n ?? 0), campaignId]);
  const button = await eventButton(c);
  for (const url of campaignLinks(c.body, [button?.href])) {
    await execute(`INSERT IGNORE INTO marketing_links (campaign_id, url, url_hash) VALUES (?, ?, ?)`, [campaignId, url.slice(0, 1000), sha256(url)]);
  }
  return Number(total?.n ?? 0);
}

/**
 * Every minute (lib/jobs.ts): start campaigns whose time has come, then send up to `batch` emails across sending
 * campaigns. Each recipient row is claimed with a conditional UPDATE, so parallel runs never send twice.
 */
export async function runMarketingSends(batch = Number(process.env.MARKETING_BATCH) || 100): Promise<{ started: number; sent: number }> {
  let started = 0, sent = 0;
  const due = await query<Row & { id: number }>(`SELECT id FROM marketing_campaigns WHERE status = 'scheduled' AND scheduled_at <= NOW() ORDER BY scheduled_at LIMIT 20`);
  for (const d of due) if ((await startCampaign(Number(d.id))) !== null) started++;

  const sending = await query<CampaignRow>(`SELECT * FROM marketing_campaigns WHERE status = 'sending' ORDER BY started_at LIMIT 10`);
  for (const c of sending) {
    if (sent >= batch) break;
    const org = await orgForMail(Number(c.organization_id));
    if (!org || !isProActive(org.pro_until)) { await pause(Number(c.id), 'Fattixx Pro ended'); continue; }
    const rows = await query<Row & { id: number; email: string; name: string | null; unsubscribed_at: Date | null }>(
      `SELECT s.id, s.email, k.name, k.unsubscribed_at FROM marketing_sends s JOIN marketing_contacts k ON k.id = s.contact_id
        WHERE s.campaign_id = ? AND s.status = 'queued' ORDER BY s.id LIMIT ?`, [c.id, batch - sent],
    );
    if (!rows.length) {
      await execute(`UPDATE marketing_campaigns SET status = 'sent', finished_at = NOW() WHERE id = ? AND status = 'sending'`, [c.id]);
      continue;
    }
    const links = new Map((await query<Row & { id: number; url: string }>(`SELECT id, url FROM marketing_links WHERE campaign_id = ?`, [c.id])).map((l) => [l.url, Number(l.id)]));
    for (const r of rows) {
      const claim = await execute(`UPDATE marketing_sends SET status = 'sent', sent_at = NOW() WHERE id = ? AND status = 'queued'`, [r.id]);
      if (!claim.affectedRows) continue;
      if (r.unsubscribed_at) { await execute(`UPDATE marketing_sends SET status = 'skipped', sent_at = NULL WHERE id = ?`, [r.id]); continue; }
      try {
        const mail = await renderCampaign(c, org, { email: r.email, name: r.name, sendId: Number(r.id) }, links);
        const outboxId = await sendEmail({ to: r.email, toName: r.name, subject: mail.subject, text: mail.text, html: mail.html, category: 'marketing', envelope: mail.envelope, related: { type: 'campaign', id: c.id } });
        await execute(`UPDATE marketing_sends SET outbox_id = ? WHERE id = ?`, [outboxId, r.id]);
        sent++;
      } catch (e) {
        console.error('[marketing] send failed', e);
        await execute(`UPDATE marketing_sends SET status = 'failed' WHERE id = ?`, [r.id]);
      }
    }
  }
  return { started, sent };
}

// ---------------------------------------------------------------------------
// Tracking tokens and endpoints
// ---------------------------------------------------------------------------
const sig = (id: number) => hmacHex(`marketing-send:${id}`).slice(0, 24);

/** Opaque per-recipient token: the send row id and an HMAC, so links cannot be guessed or altered. */
export function sendToken(sendId: number): string {
  return `${sendId.toString(36)}.${sig(sendId)}`;
}

export function parseSendToken(token: string): number | null {
  const m = /^([0-9a-z]{1,12})\.([0-9a-f]{24})$/.exec(String(token ?? ''));
  if (!m) return null;
  const id = parseInt(m[1], 36);
  return Number.isSafeInteger(id) && id > 0 && safeEqual(sig(id), m[2]) ? id : null;
}

export async function recordOpen(token: string): Promise<void> {
  const id = parseSendToken(token);
  if (!id) return;
  await execute(`UPDATE marketing_sends SET opens = opens + 1, opened_at = COALESCE(opened_at, NOW()) WHERE id = ?`, [id]);
}

/** Click: count it and return where to go. Only links stored for the campaign; never a URL from the request. */
export async function recordClick(token: string, linkId: number): Promise<string | null> {
  const id = parseSendToken(token);
  if (!id || !Number.isInteger(linkId)) return null;
  const link = await queryOne<Row & { id: number; url: string }>(
    `SELECT l.id, l.url FROM marketing_links l JOIN marketing_sends s ON s.campaign_id = l.campaign_id WHERE s.id = ? AND l.id = ?`, [id, linkId],
  );
  if (!link) return null;
  await execute(`UPDATE marketing_sends SET clicks = clicks + 1, clicked_at = COALESCE(clicked_at, NOW()), opened_at = COALESCE(opened_at, NOW()) WHERE id = ?`, [id]);
  await execute(`UPDATE marketing_links SET clicks = clicks + 1 WHERE id = ?`, [link.id]);
  return link.url;
}

export async function unsubscribeInfo(token: string): Promise<{ orgName: string; email: string; already: boolean } | null> {
  const id = parseSendToken(token);
  if (!id) return null;
  const r = await queryOne<Row & { name: string; email: string; unsubscribed_at: Date | null }>(
    `SELECT o.name, k.email, k.unsubscribed_at FROM marketing_sends s JOIN marketing_contacts k ON k.id = s.contact_id JOIN organizations o ON o.id = k.organization_id WHERE s.id = ?`, [id],
  );
  return r ? { orgName: r.name, email: r.email, already: !!r.unsubscribed_at } : null;
}

/** Unsubscribe the contact behind a send token from that organization's emails. Idempotent. */
export async function unsubscribeByToken(token: string, source: 'link' | 'one_click'): Promise<boolean> {
  const id = parseSendToken(token);
  if (!id) return false;
  const s = await queryOne<Row & { contact_id: number }>(`SELECT contact_id FROM marketing_sends WHERE id = ?`, [id]);
  if (!s) return false;
  await execute(`UPDATE marketing_contacts SET unsubscribed_at = COALESCE(unsubscribed_at, NOW()), unsubscribe_source = COALESCE(unsubscribe_source, ?) WHERE id = ?`, [source, s.contact_id]);
  await execute(`UPDATE marketing_sends SET unsubscribed_at = COALESCE(unsubscribed_at, NOW()) WHERE id = ?`, [id]);
  return true;
}
