import 'server-only';
import { query, queryOne, type Row } from '../db';
import { env } from '../env';
import { escapeHtml, type MailEnvelope } from '../email';
import type { EmailLogo, RenderOptions } from '../email-templates';
import { getBranding } from '../settings';
import { uploadUrl } from '../uploads';
import { publicOriginFor } from './domains';
import { isProActive } from './status';

/**
 * White-label organizer sites (Phase 3): an add-on a Super Admin switches on for a Fattixx Pro organization
 * (Admin → Organizations). While it is on and Pro is active:
 *  - the organizer's own header and short footer are used on all their public pages (as Pro's "own header");
 *  - their site gets its own pages (About, FAQ, …: Dashboard → Fattixx Pro → Site pages), linked from that header;
 *  - tickets, wallet passes, ticket emails and texts carry the organizer's name and logo instead of Fattixx's.
 * Fattixx stays named only where it must: as seller of record on receipts and in the footer, and in the legal links.
 * When Pro ends the add-on stops working (nothing is deleted) and everything returns to the Fattixx look.
 */
export type WhiteLabelSource = { white_label: number | boolean | null; pro_until: Date | string | null };

export function whiteLabelActive(o: WhiteLabelSource | null | undefined): boolean {
  return !!o && !!Number(o.white_label) && isProActive(o.pro_until);
}

type OrgMailRow = Row & { id: number; name: string; contact_email: string; logo_path: string | null; email_sender_name: string | null; white_label: number; pro_until: Date | null };

export type OrgMail = { render: RenderOptions; envelope: MailEnvelope; smsName: string };

/**
 * Email / SMS branding for messages about an organization's orders: the organizer's name, logo and reply-to address
 * when white-label is on, else null (the standard Fattixx look). Pass `render` to renderEmail and `envelope` to sendEmail.
 */
export async function orgMail(orgId: number): Promise<OrgMail | null> {
  const org = await queryOne<OrgMailRow>(
    `SELECT id, name, contact_email, logo_path, email_sender_name, white_label, pro_until FROM organizations WHERE id = ?`, [orgId]);
  if (!org || !whiteLabelActive(org)) return null;
  const platform = await getBranding();
  const origin = await publicOriginFor(org.id);
  const logoPath = uploadUrl(org.logo_path);
  const logo: EmailLogo | undefined = logoPath ? { src: /^https?:/.test(logoPath) ? logoPath : `${env.APP_URL}${logoPath}`, width: 0, height: 0 } : undefined;
  const sender = (org.email_sender_name || org.name).replace(/["\r\n]/g, '').slice(0, 60);
  return {
    render: {
      brand: { ...platform, name: org.name, supportEmail: org.contact_email },
      logo,
      appUrl: origin,
      // Fattixx is still the seller of record: say so once, small, under the message.
      appendHtml: `<p class="muted" style="margin-top:18px">Tickets are sold and payments processed by ${escapeHtml(platform.name)} on behalf of ${escapeHtml(org.name)}.</p>`,
    },
    envelope: { fromName: sender, replyTo: org.contact_email },
    smsName: sender,
  };
}

/** Merge white-label render options with a message's own appendHtml (the email ad block). */
export function withOrgMail(render: RenderOptions, mail: OrgMail | null): RenderOptions {
  if (!mail) return render;
  return { ...render, ...mail.render, appendHtml: `${render.appendHtml ?? ''}${mail.render.appendHtml ?? ''}` };
}

// ---------------------------------------------------------------------------
// Site pages
// ---------------------------------------------------------------------------
export type SitePageRow = Row & { id: number; organization_id: number; slug: string; title: string; body: string; sort_order: number; published: number; updated_at: Date };

export const MAX_SITE_PAGES = 12;

/** Lower-case URL part from a title: "Frequently asked questions" → "frequently-asked-questions". */
export function pageSlug(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page';
}

export async function listSitePages(orgId: number, publishedOnly = false): Promise<SitePageRow[]> {
  return query<SitePageRow>(
    `SELECT * FROM org_site_pages WHERE organization_id = ? ${publishedOnly ? 'AND published = 1' : ''} ORDER BY sort_order, id`, [orgId]);
}

export async function getSitePage(orgId: number, slug: string): Promise<SitePageRow | null> {
  return queryOne<SitePageRow>(`SELECT * FROM org_site_pages WHERE organization_id = ? AND slug = ?`, [orgId, slug.slice(0, 64)]);
}

/** Links for the organizer's header: only while white-label is active. */
export async function sitePageLinks(org: { id: number } & WhiteLabelSource): Promise<{ slug: string; title: string }[]> {
  if (!whiteLabelActive(org)) return [];
  return (await listSitePages(org.id, true)).map((p) => ({ slug: p.slug, title: p.title }));
}
