/*
 * Email marketing campaigns (Fattixx Pro): turning a campaign into the email each contact receives. Pure functions; the
 * sender (lib/pro/email-marketing.ts) supplies the tracking URLs. The body uses the light formatting of the event
 * description editor (src/lib/rich-text.ts), so organizers never write HTML and links are always http(s) or mailto.
 */
import { parseRichText, richTextPlain, type RichInline } from '../rich-text';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Merge tags organizers can use in the subject and body. */
export const MERGE_TAGS = ['first_name', 'name', 'org_name'] as const;

export function applyMergeTags(src: string, vars: { first_name?: string | null; name?: string | null; org_name: string }): string {
  // a buyer's name is typed by the buyer: formatting characters are dropped so it cannot become a link or bold text
  const plain = (s: string | null | undefined) => (s ?? '').replace(/[*_[\]()<>{}`\\]/g, '').trim();
  const values: Record<string, string> = { first_name: plain(vars.first_name) || 'there', name: plain(vars.name) || 'there', org_name: plain(vars.org_name) };
  return src.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => values[k.toLowerCase()] ?? '');
}

export const firstNameOf = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || null;

/** Every link in the body, plus the event button's, in order and without duplicates: what click tracking may redirect to. */
export function campaignLinks(body: string, extra: (string | null | undefined)[] = []): string[] {
  const out: string[] = [];
  const walk = (parts: RichInline[]) => {
    for (const p of parts) {
      if (p.t === 'a') { if (/^https?:/i.test(p.href)) out.push(p.href); walk(p.c); }
      else if (p.t !== 'text') walk(p.c);
    }
  };
  for (const b of parseRichText(body)) for (const line of b.t === 'p' ? b.lines : b.items) walk(line);
  for (const e of extra) if (e) out.push(e);
  return [...new Set(out)];
}

/** The body as email HTML. `link` maps each http(s) link to the URL to put in the email (the click tracker). */
export function bodyToHtml(body: string, link: (href: string) => string, color: string): string {
  const inline = (parts: RichInline[]): string => parts.map((p) => {
    if (p.t === 'text') return esc(p.v);
    if (p.t === 'b') return `<strong>${inline(p.c)}</strong>`;
    if (p.t === 'i') return `<em>${inline(p.c)}</em>`;
    const href = /^https?:/i.test(p.href) ? link(p.href) : p.href;
    return `<a href="${esc(href)}" style="color:${color};text-decoration:underline">${inline(p.c)}</a>`;
  }).join('');
  return parseRichText(body).map((b) => b.t === 'p'
    ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.6">${b.lines.map(inline).join('<br>')}</p>`
    : `<ul style="margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.6">${b.items.map((i) => `<li style="margin:0 0 6px">${inline(i)}</li>`).join('')}</ul>`).join('\n');
}

export type CampaignLayout = {
  orgName: string;
  logoUrl: string | null;
  /** brand colors, validated (lib/pro/brand-colors.ts); the Fattixx palette when the organizer set none */
  primary: string;
  accent: string;
  mailingAddress: string;
  platformName: string;
  subject: string;
  preheader: string | null;
  bodyHtml: string;
  button: { label: string; href: string } | null;
  unsubscribeUrl: string;
  /** 1×1 open-tracking image (omitted in test sends and previews) */
  openPixelUrl: string | null;
};

export function campaignHtml(l: CampaignLayout): string {
  const logo = l.logoUrl
    ? `<img src="${esc(l.logoUrl)}" alt="${esc(l.orgName)}" height="56" style="height:56px;width:auto;max-width:220px;display:block;border:0">`
    : `<span style="font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;color:#ffffff">${esc(l.orgName)}</span>`;
  const button = l.button
    ? `<p style="margin:24px 0"><a href="${esc(l.button.href)}" style="display:inline-block;background:${l.accent};color:${l.primary};padding:14px 26px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px">${esc(l.button.label)}</a></p>`
    : '';
  const pre = l.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(l.preheader)}</div>` : '';
  const pixel = l.openPixelUrl ? `<img src="${esc(l.openPixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(l.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:Helvetica,Arial,sans-serif;color:#1f1f1f">${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:${l.primary};padding:22px 28px">${logo}</td></tr>
<tr><td style="padding:30px 28px 10px">${l.bodyHtml}${button}</td></tr>
<tr><td style="padding:18px 28px 26px;border-top:1px solid #eee;font-size:12px;line-height:1.6;color:#6b6b6b">
You are receiving this because you bought tickets from ${esc(l.orgName)} and asked to hear about their future events.<br>
<a href="${esc(l.unsubscribeUrl)}" style="color:#6b6b6b;text-decoration:underline">Unsubscribe</a> from ${esc(l.orgName)} emails.<br>
${esc(l.orgName)} · ${esc(l.mailingAddress)}<br>Sent with ${esc(l.platformName)}.
</td></tr></table>${pixel}
</td></tr></table></body></html>`;
}

export function campaignText(body: string, l: Pick<CampaignLayout, 'orgName' | 'mailingAddress' | 'platformName' | 'button' | 'unsubscribeUrl'>): string {
  return [
    richTextPlain(body),
    l.button ? `${l.button.label}: ${l.button.href}` : '',
    '--',
    `You are receiving this because you bought tickets from ${l.orgName} and asked to hear about their future events.`,
    `Unsubscribe: ${l.unsubscribeUrl}`,
    `${l.orgName} · ${l.mailingAddress}`,
    `Sent with ${l.platformName}.`,
  ].filter(Boolean).join('\n\n');
}

/** Starter templates every Pro organization gets (their own saved templates are listed after these). */
export const STARTER_TEMPLATES: { key: string; name: string; subject: string; body: string }[] = [
  {
    key: 'announce', name: 'New event announcement', subject: 'Just announced: our next event',
    body: 'Hi {{first_name}},\n\nOur next event is on sale now, and you are among the first to know.\n\n**What:** describe the event\n**When:** the date and time\n**Where:** the venue\n\nTickets go fast, so grab yours early.',
  },
  {
    key: 'presale', name: 'Presale for past guests', subject: 'Your early access starts now',
    body: 'Hi {{first_name}},\n\nThanks for coming out with us before. As a thank-you, you get early access before tickets go on sale to everyone.\n\n- Presale opens: the date and time\n- Use the button below to get your tickets\n\nSee you there!',
  },
  {
    key: 'last_call', name: 'Last chance', subject: 'Last chance: tickets almost gone',
    body: 'Hi {{first_name}},\n\nWe are almost sold out. If you have been meaning to get tickets, now is the time.\n\nSee you on the night,\n{{org_name}}',
  },
];
