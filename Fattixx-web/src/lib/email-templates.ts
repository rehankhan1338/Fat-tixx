import 'server-only';
import { query, type Row } from './db';
import { escapeHtml } from './email';
import { getBranding, type Branding } from './settings';
import { uploadUrl } from './uploads';
import { env } from './env';

/** Public origin used in the sample variables shown on the Admin → Emails → Templates preview. */
const APP = env.APP_URL;

/**
 * Editable transactional email templates. Defaults live here; Super Admin edits are stored in
 * `email_templates` and override the default for that key. Placeholders:
 *   {{name}}   → inserted as escaped text
 *   {{{name}}} → inserted as raw HTML (only for variables that are pre-rendered HTML, e.g. receipt rows)
 * {{platform_name}} and {{support_email}} are always available.
 */
export type TemplateKey =
  | 'order_confirmation' | 'tickets_resent' | 'refund_issued' | 'order_cancelled' | 'event_cancelled' | 'event_postponed'
  | 'organizer_update' | 'invitation' | 'password_reset' | 'tickets_link' | 'waitlist_available' | 'ticket_transferred'
  | 'event_reminder' | 'verify_email' | 'application_received' | 'application_approved' | 'application_rejected' | 'reconciliation_alert';

export interface TemplateDef { key: TemplateKey; name: string; description: string; variables: string[]; subject: string; body: string; sample: Record<string, string> }

const BUTTON = (href: string, label: string) => `<p><a href="${href}" class="btn">${label}</a></p>`;

export const TEMPLATES: TemplateDef[] = [
  {
    key: 'order_confirmation', name: 'Order confirmation', description: 'Sent when an order is paid or free tickets are confirmed. Contains the receipt and one link per ticket.',
    variables: ['event_title', 'event_when', 'venue_line', 'order_code', 'total', '{{{receipt_rows}}}', '{{{tickets_html}}}', 'age_notice', 'find_tickets_url'],
    subject: 'Your tickets are confirmed: {{event_title}}',
    body: `<p><strong>{{event_title}}</strong><br>{{event_when}}<br>{{venue_line}}</p>
<p class="muted">Order <code>{{order_code}}</code></p>
<table class="receipt">{{{receipt_rows}}}</table>
<h2>Your tickets</h2>
{{{tickets_html}}}
<p class="notice">{{age_notice}}</p>
<p class="muted">Find your tickets any time at <a href="{{find_tickets_url}}">{{find_tickets_url}}</a>.</p>`,
    sample: { event_title: 'Demo Night Live', event_when: 'Fri, Nov 20, 2026, 8:00 PM EST', venue_line: 'The Warehouse, Charleston', order_code: 'FTX-7K2M9Q', total: '$29.62', receipt_rows: '<tr><td>1 × General Admission</td><td align="right">$25.00</td></tr><tr><td>Service fee</td><td align="right">$2.24</td></tr><tr><td>Tax</td><td align="right">$1.25</td></tr><tr><td><strong>Total paid</strong></td><td align="right"><strong>$29.62</strong></td></tr>', tickets_html: '<p><a href="#" class="btn">Open ticket</a> &nbsp; General Admission · Jane Doe <code>H2BT56TWX6TT</code></p>', age_notice: 'This event is 21+. Bring a valid photo ID.', find_tickets_url: `${APP}/tickets/find` },
  },
  {
    key: 'tickets_resent', name: 'Tickets re-sent', description: 'Sent when staff click “Resend tickets”. Same variables as the order confirmation.',
    variables: ['event_title', 'event_when', 'venue_line', 'order_code', 'total', '{{{receipt_rows}}}', '{{{tickets_html}}}', 'age_notice', 'find_tickets_url'],
    subject: 'Your tickets: {{event_title}}',
    body: `<p>Here are your tickets again for <strong>{{event_title}}</strong>, {{event_when}}.</p>
<p class="muted">Order <code>{{order_code}}</code></p>
{{{tickets_html}}}
<p class="notice">{{age_notice}}</p>
<p class="muted">Find your tickets any time at <a href="{{find_tickets_url}}">{{find_tickets_url}}</a>.</p>`,
    sample: { event_title: 'Demo Night Live', event_when: 'Fri, Nov 20, 2026, 8:00 PM EST', venue_line: 'The Warehouse', order_code: 'FTX-7K2M9Q', total: '$29.62', receipt_rows: '', tickets_html: '<p><a href="#" class="btn">Open ticket</a> &nbsp; General Admission · Jane Doe <code>H2BT56TWX6TT</code></p>', age_notice: '', find_tickets_url: `${APP}/tickets/find` },
  },
  {
    key: 'ticket_transferred', name: 'Ticket transferred to you', description: 'Sent to the new holder when a ticket is transferred to them, by the previous holder or by event staff.',
    variables: ['recipient_name', 'from_name', 'event_title', 'event_when', 'venue_line', 'ticket_line', 'ticket_code', 'url', 'note', 'age_notice', 'find_tickets_url'],
    subject: '{{from_name}} sent you a ticket: {{event_title}}',
    body: `<p>Hi {{recipient_name}},</p>
<p>{{from_name}} transferred a ticket to you for <strong>{{event_title}}</strong>.<br>{{event_when}}<br>{{venue_line}}</p>
<p>{{ticket_line}} <code>{{ticket_code}}</code></p>
${BUTTON('{{url}}', 'Open your ticket')}
<p>{{note}}</p>
<p class="notice">{{age_notice}}</p>
<p class="muted">The ticket is now in your name and the previous QR code no longer works. Find your tickets any time at <a href="{{find_tickets_url}}">{{find_tickets_url}}</a>.</p>`,
    sample: { recipient_name: 'Sam Lee', from_name: 'Jane Doe', event_title: 'Demo Night Live', event_when: 'Fri, Nov 20, 2026, 8:00 PM EST', venue_line: 'The Warehouse', ticket_line: 'General Admission', ticket_code: 'H2BT56TWX6TT', url: `${APP}/t/H2BT56TWX6TT?k=example`, note: '', age_notice: '', find_tickets_url: `${APP}/tickets/find` },
  },
  {
    key: 'refund_issued', name: 'Refund issued', description: 'Sent for every refund, full or partial.',
    variables: ['amount', 'order_code', 'event_title', 'event_when', 'reason', 'tickets_note'],
    subject: 'Refund issued for {{event_title}}',
    body: `<p>We have refunded <strong>{{amount}}</strong> for order <code>{{order_code}}</code> ({{event_title}}, {{event_when}}).</p>
<p>Reason: {{reason}}</p>
<p>{{tickets_note}}</p>
<p class="muted">Refunds usually appear within 5–10 business days.</p>`,
    sample: { amount: '$29.62', order_code: 'FTX-7K2M9Q', event_title: 'Demo Night Live', event_when: 'Fri, Nov 20, 2026, 8:00 PM EST', reason: 'Requested by attendee', tickets_note: 'The tickets on this order are no longer valid.' },
  },
  {
    key: 'order_cancelled', name: 'Order cancelled', description: 'Sent when staff cancel an order without a refund (for example a duplicate).',
    variables: ['order_code', 'event_title', 'reason'],
    subject: 'Order {{order_code}} cancelled: {{event_title}}',
    body: `<p>Your order <code>{{order_code}}</code> for <strong>{{event_title}}</strong> has been cancelled and its tickets are no longer valid.</p>
<p>Reason: {{reason}}</p>`,
    sample: { order_code: 'FTX-7K2M9Q', event_title: 'Demo Night Live', reason: 'Duplicate order' },
  },
  {
    key: 'event_cancelled', name: 'Event cancelled', description: 'Sent to every ticket holder when an event is cancelled (refunds are described in the refund email).',
    variables: ['event_title', 'reason'],
    subject: 'Cancelled: {{event_title}}',
    body: `<p><strong>{{event_title}}</strong> has been cancelled.</p>
<p>{{reason}}</p>`,
    sample: { event_title: 'Demo Night Live', reason: 'The venue is no longer available.' },
  },
  {
    key: 'event_postponed', name: 'Event postponed', description: 'Sent to every ticket holder when an event is postponed; tickets stay valid.',
    variables: ['event_title', 'message', 'when_text'],
    subject: 'Postponed: {{event_title}}',
    body: `<p><strong>{{event_title}}</strong> has been postponed.</p>
<p>{{message}}</p>
<p>{{when_text}}</p>`,
    sample: { event_title: 'Demo Night Live', message: 'The artist is unwell; we are moving the show.', when_text: 'New date: Sat, Dec 5, 2026, 8:00 PM EST. Your existing tickets remain valid.' },
  },
  {
    key: 'organizer_update', name: 'Organizer update', description: 'A message an organizer sends to all ticket holders of an event.',
    variables: ['event_title', 'subject', '{{{body_html}}}'],
    subject: '{{event_title}}: {{subject}}',
    body: `<p>{{{body_html}}}</p>`,
    sample: { event_title: 'Demo Night Live', subject: 'Doors open earlier', body_html: 'Doors now open at 6:30 PM.<br>See you there!' },
  },
  {
    key: 'invitation', name: 'Team invitation', description: 'Sent when someone is added to an organization or the platform team and needs to set a password.',
    variables: ['context', 'url'],
    subject: 'You have been invited to {{context}}',
    body: `<p>You have been given access to {{context}} on {{platform_name}}. Set your password to get started. The link expires in 7 days.</p>
${BUTTON('{{url}}', 'Set your password')}
<p class="muted">{{url}}</p>`,
    sample: { context: 'Demo Organization on Fat Tixx', url: `${APP}/set-password/example` },
  },
  {
    key: 'password_reset', name: 'Password reset', description: 'Sent from “Forgot password” and when staff send a reset link.',
    variables: ['url'],
    subject: 'Reset your {{platform_name}} password',
    body: `<p>Use the link below to choose a new password. It expires in 60 minutes.</p>
${BUTTON('{{url}}', 'Choose a new password')}
<p class="muted">{{url}}</p>
<p class="muted">If you did not request this, you can ignore this email.</p>`,
    sample: { url: `${APP}/set-password/example` },
  },
  {
    key: 'waitlist_available', name: 'Waitlist: tickets available', description: 'Sent to waitlisted people when the organizer releases tickets to the waitlist. First come, first served.',
    variables: ['event_title', 'event_when', 'ticket_note', 'url', 'leave_url'],
    subject: 'Tickets are available: {{event_title}}',
    body: `<p>Good news — tickets for <strong>{{event_title}}</strong> ({{event_when}}) are available again.</p>
<p>{{ticket_note}}</p>
${BUTTON('{{url}}', 'Get tickets')}
<p class="muted">Tickets are first come, first served. If you no longer want to be on the waitlist, <a href="{{leave_url}}">remove yourself</a>.</p>`,
    sample: { event_title: 'Demo Night Live', event_when: 'Fri, Nov 20, 2026, 8:00 PM EST', ticket_note: 'You asked about: General Admission.', url: `${APP}/events/demo-night-live`, leave_url: `${APP}/events/demo-night-live?leave=example` },
  },
  {
    key: 'tickets_link', name: 'Find my tickets link', description: 'The one-time link sent from the “Find my tickets” page.',
    variables: ['url'],
    subject: 'Your {{platform_name}} tickets',
    body: `<p>Open the link below to see all your tickets and orders. It works once and expires in 30 minutes.</p>
${BUTTON('{{url}}', 'Show my tickets')}
<p class="muted">{{url}}</p>`,
    sample: { url: `${APP}/tickets/list?token=example` },
  },
  {
    key: 'event_reminder', name: 'Event reminder', description: 'Sent automatically to ticket holders about 24 hours before the event starts.',
    variables: ['buyer_name', 'event_title', 'event_when', 'doors_line', 'venue_line', 'ticket_count', 'order_url', 'age_notice'],
    subject: 'Reminder: {{event_title}} is tomorrow',
    body: `<p>Hi {{buyer_name}},</p>
<p>See you soon at <strong>{{event_title}}</strong>.<br>{{event_when}}<br>{{doors_line}}<br>{{venue_line}}</p>
<p>You have {{ticket_count}} ticket(s). Have the QR codes ready on your phone; screen brightness up helps at the door.</p>
${BUTTON('{{order_url}}', 'Show my tickets')}
<p class="notice">{{age_notice}}</p>`,
    sample: { buyer_name: 'Jane', event_title: 'Demo Night Live', event_when: 'Fri, Nov 20, 2026, 8:00 PM EST', doors_line: 'Doors 7:00 PM', venue_line: 'The Warehouse, Charleston', ticket_count: '2', order_url: `${APP}/tickets/find`, age_notice: 'This event is 21+. Bring a valid photo ID.' },
  },
  {
    key: 'verify_email', name: 'Verify email address', description: 'Sent after creating an account (and from the account page) to confirm the email address.',
    variables: ['name', 'url'],
    subject: 'Confirm your email for {{platform_name}}',
    body: `<p>Hi {{name}},</p>
<p>Please confirm this is your email address. The link works once and expires in 24 hours.</p>
${BUTTON('{{url}}', 'Confirm email')}
<p class="muted">If you did not create an account, you can ignore this email.</p>`,
    sample: { name: 'Jane', url: `${APP}/verify-email/example` },
  },
  {
    key: 'application_received', name: 'Organizer application received', description: 'Confirmation sent to someone who applied to sell tickets.',
    variables: ['contact_name', 'org_name'],
    subject: 'We received your application: {{org_name}}',
    body: `<p>Hi {{contact_name}},</p>
<p>Thanks for applying to sell tickets on {{platform_name}} as <strong>{{org_name}}</strong>. Our team verifies every organizer's identity and business details before they can sell. We will email you when the review is done.</p>`,
    sample: { contact_name: 'Jane', org_name: 'Lowcountry Live' },
  },
  {
    key: 'application_approved', name: 'Organizer application approved', description: 'Sent when platform staff approve an organizer application. Contains the link to set a password.',
    variables: ['contact_name', 'org_name', 'url'],
    subject: 'You are approved to sell on {{platform_name}}',
    body: `<p>Hi {{contact_name}},</p>
<p><strong>{{org_name}}</strong> is verified and ready to sell tickets. You are the Organization Admin.</p>
${BUTTON('{{url}}', 'Open your organizer dashboard')}`,
    sample: { contact_name: 'Jane', org_name: 'Lowcountry Live', url: `${APP}/set-password/example` },
  },
  {
    key: 'application_rejected', name: 'Organizer application declined', description: 'Sent when platform staff decline an organizer application.',
    variables: ['contact_name', 'org_name', 'notes'],
    subject: 'Your {{platform_name}} application',
    body: `<p>Hi {{contact_name}},</p>
<p>We could not verify <strong>{{org_name}}</strong> at this time.</p>
<p>{{notes}}</p>
<p class="muted">Reply to {{support_email}} if you have questions or want to send more information.</p>`,
    sample: { contact_name: 'Jane', org_name: 'Lowcountry Live', notes: 'The legal business name did not match the tax ID.' },
  },
  {
    key: 'reconciliation_alert', name: 'Reconciliation alert (staff)', description: 'Sent to Finance staff when the daily Stripe reconciliation finds discrepancies.',
    variables: ['count', 'range', 'url'],
    subject: 'Reconciliation: {{count}} discrepancy(ies) found',
    body: `<p>The daily reconciliation between Fat Tixx orders and Stripe found <strong>{{count}}</strong> discrepancy(ies) for {{range}}.</p>
${BUTTON('{{url}}', 'Review in Payments')}`,
    sample: { count: '2', range: 'the last 2 days', url: `${APP}/admin/payments` },
  },
];

export function templateDef(key: TemplateKey): TemplateDef {
  return TEMPLATES.find((t) => t.key === key)!;
}

export type StoredTemplate = Row & { key: string; subject: string; body_html: string; updated_at: Date; updated_by_name: string | null };

export async function listStoredTemplates(): Promise<Map<string, StoredTemplate>> {
  const rows = await query<StoredTemplate>(`SELECT t.*, u.name AS updated_by_name FROM email_templates t LEFT JOIN users u ON u.id = t.updated_by`);
  return new Map(rows.map((r) => [r.key, r]));
}

/** Placeholder substitution. {{{x}}} raw, {{x}} escaped; unknown placeholders are left blank. */
export function fillTemplate(src: string, vars: Record<string, string>): string {
  return src
    .replace(/\{\{\{\s*([a-z_]+)\s*\}\}\}/g, (_, k: string) => vars[k] ?? '')
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => escapeHtml(vars[k] ?? ''));
}

/** Readable plain-text version of an HTML body (links keep their URL). */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => (text.trim() === href ? href : `${text.trim()}: ${href}`))
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Brand palette shared with the public site (src/app/globals.css, @theme static --color-fx-*). Email clients cannot read CSS
 * variables, so the hex values are repeated here; keep the two in sync.
 */
export const EMAIL_THEME = {
  red: '#A8121A',        // --color-fx-red: headings, text on light, header band
  redSecond: '#C8201A',  // --color-fx-red-second: links, prices, notices
  redNight: '#6E0A10',   // --color-fx-red-night: footer
  yellow: '#FFD23F',     // --color-fx-yellow: primary buttons
  ivory: '#F5F1EA',      // --color-fx-ivory: page background, text on red
  white: '#FFFDFA',      // --color-fx-white: the sheet
  sand: '#F3ECE2',       // --color-fx-sand: chips, code
  ink: '#2A0A0C',        // --color-fx-ink: body text
  muted: '#BB464C',      // red at 78% over white (the site's --muted-foreground)
  border: '#EFD4D6',     // red at 18% over white (the site's --border)
  footerText: '#CCACA9', // ivory at 70% over red-night (footer links)
  sans: "'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  display: "'Bricolage Grotesque', 'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif",
} as const;

/** Image shown in the red header band. `width`/`height` are the file's pixel size (0 when unknown, e.g. an uploaded logo). */
export interface EmailLogo { src: string; width: number; height: number }

/** The Fattixx wordmark the site uses (src/components/home/Logo.tsx): transparent PNG, legible on the red band. */
const DEFAULT_LOGO = { path: '/images/brand/fattixx-logo.png', width: 800, height: 513 } as const;
const LOGO_HEIGHT = 48;

/**
 * Which logo an email shows: the one the Super Admin uploaded (Admin → Settings → Branding) if any, otherwise the default wordmark.
 * Mail clients only load absolute URLs, so `appUrl` must be the public site's origin (APP_URL), never the admin console's:
 * the console has no /images and sits behind its own domain. See src/lib/env.ts.
 */
export function emailLogo(brand: Branding, appUrl: string): EmailLogo {
  const uploaded = uploadUrl(brand.logoPath);
  if (uploaded) return { src: /^https?:/.test(uploaded) ? uploaded : appUrl + uploaded, width: 0, height: 0 };
  return { src: `${appUrl}${DEFAULT_LOGO.path}`, width: DEFAULT_LOGO.width, height: DEFAULT_LOGO.height };
}

/** Brand-aware HTML wrapper used by every template, styled like the public site (ivory page, white sheet, red header, yellow pill buttons). */
export function brandedLayout(title: string, bodyHtml: string, brand: Branding, appUrl: string, logoOverride?: EmailLogo): string {
  const T = EMAIL_THEME;
  const logoDef = logoOverride ?? emailLogo(brand, appUrl);
  // Outlook (Word engine) ignores CSS sizing and renders at the width/height attributes, or at the file's natural size when
  // they are missing; so both attributes are set whenever the file's proportions are known.
  const logoWidth = logoDef.width && logoDef.height ? Math.round((LOGO_HEIGHT * logoDef.width) / logoDef.height) : 0;
  const logo = `<img src="${logoDef.src}" alt="${escapeHtml(brand.name)}"${logoWidth ? ` width="${logoWidth}"` : ''} height="${LOGO_HEIGHT}" style="height:${LOGO_HEIGHT}px;width:${logoWidth ? `${logoWidth}px` : 'auto'};max-width:220px;display:block;border:0">`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(title)}</title><style>
    body{margin:0;padding:0;background:${T.ivory};-webkit-font-smoothing:antialiased}
    p{margin:0 0 14px;font-size:15px;line-height:1.55}
    a{color:${T.redSecond}}
    strong{color:${T.red}}
    h1{margin:0 0 16px;font-family:${T.display};font-size:24px;line-height:1.2;font-weight:700;letter-spacing:-.01em;color:${T.red}}
    h2{margin:24px 0 10px;font-family:${T.display};font-size:17px;line-height:1.3;font-weight:600;color:${T.red}}
    .btn{display:inline-block;background:${T.yellow};color:${T.red} !important;padding:13px 24px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px;line-height:1.2;mso-padding-alt:0;mso-line-height-rule:exactly}
    .btn:hover{opacity:.88}
    .muted{color:${T.muted};font-size:13px;line-height:1.5}
    .muted a{color:${T.muted}}
    .notice{color:${T.redSecond};font-weight:600}
    code{font-family:'Geist Mono',Menlo,Consolas,monospace;font-size:13px;color:${T.red};background:${T.sand};padding:2px 7px;border-radius:6px;white-space:nowrap}
    table.receipt{width:100%;border-collapse:collapse;font-size:14px;margin:4px 0 18px;color:${T.ink}}
    table.receipt td{padding:8px 0;border-bottom:1px solid ${T.border};vertical-align:top}
    table.receipt tr:last-child td{border-bottom:0;border-top:2px solid ${T.red};padding-top:12px;color:${T.red}}
    @media (max-width:640px){.sheet{border-radius:18px !important}.pad{padding:22px !important}.band{padding:18px 22px !important}}
  </style></head><body style="margin:0;background:${T.ivory};font-family:${T.sans};color:${T.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${T.ivory}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="sheet" style="width:100%;max-width:600px;background:${T.white};border-radius:24px;overflow:hidden;box-shadow:0 18px 40px -24px rgba(78,7,11,.45)">
<tr><td class="band" style="background:${T.red};padding:22px 28px"><a href="${appUrl}" style="display:inline-block;text-decoration:none">${logo}</a></td></tr>
<tr><td class="pad" style="padding:28px;font-family:${T.sans};font-size:15px;line-height:1.55;color:${T.ink}"><h1 style="margin:0 0 16px;font-family:${T.display};font-size:24px;line-height:1.2;font-weight:700;letter-spacing:-.01em;color:${T.red}">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
<tr><td class="pad" style="background:${T.redNight};padding:22px 28px;font-family:${T.sans};font-size:12px;line-height:1.6;color:${T.footerText}">
<span style="font-family:${T.display};font-size:15px;font-weight:600;color:${T.ivory}">${escapeHtml(brand.name)}</span><br>
You received this email because of a purchase or account on ${escapeHtml(brand.name)}.<br>
Questions? <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:${T.ivory};text-decoration:underline">${escapeHtml(brand.supportEmail)}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

export interface RenderedEmail { subject: string; html: string; text: string }

export interface RenderOptions { title?: string; brand?: Branding; appUrl?: string; appendHtml?: string; logo?: EmailLogo }

/** Render a template (stored override or default) with variables and the current branding. */
export async function renderEmail(key: TemplateKey, vars: Record<string, string>, opts: RenderOptions = {}): Promise<RenderedEmail> {
  const def = templateDef(key);
  const stored = (await listStoredTemplates()).get(key);
  return renderWith(stored?.subject ?? def.subject, stored?.body_html ?? def.body, vars, opts);
}

/** Render an unsaved subject/body (the Super Admin editor's live preview) with the template's sample data. */
export async function renderEmailDraft(key: TemplateKey, subject: string, body: string, opts: RenderOptions = {}): Promise<RenderedEmail> {
  return renderWith(subject, body, templateDef(key).sample, opts);
}

async function renderWith(subjectTemplate: string, bodyTemplate: string, vars: Record<string, string>, opts: RenderOptions): Promise<RenderedEmail> {
  const brand = opts.brand ?? (await getBranding());
  const all = { platform_name: brand.name, support_email: brand.supportEmail, ...vars };
  const subject = fillTemplate(subjectTemplate, all);
  const bodyHtml = fillTemplate(bodyTemplate, all).replace(/<p class="notice"><\/p>|<p><\/p>/g, '');
  // appendHtml (e.g. the email ad placement) is added outside the editable template and left out of the plain-text part.
  const html = brandedLayout(opts.title ?? subject, bodyHtml + (opts.appendHtml ?? ''), brand, opts.appUrl ?? env.APP_URL, opts.logo);
  return { subject, html, text: `${subject}\n\n${htmlToText(bodyHtml)}` };
}
