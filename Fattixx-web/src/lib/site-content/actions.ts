'use server';

/* Super Admin → Website: saves the homepage, pricing page, footer and event categories. */

import { revalidatePath } from 'next/cache';
import { audit } from '../audit';
import { assertSuperAdmin } from '../auth/guard';
import { CATEGORY_ICONS, type Category } from '../event-categories';
import { deleteUpload, saveImageUpload } from '../uploads';
import { MAX_CATEGORIES, saveCategories } from './categories';
import { loadSiteContent, saveSiteContent } from './index';
import {
  HOW_STEP_COUNT, MAX_COLUMNS, MAX_FAQ, MAX_LINKS, MAX_STATS, RULE_COUNT, SOCIAL_OPTIONS,
  type FooterContent, type HomeContent, type Link, type PricingContent, type SitePage,
} from './schema';
import type { SocialNetwork } from '../home/types';

export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;

const SHORT = 200;
const LONG = 2000;

const text = (fd: FormData, k: string, max = SHORT) => String(fd.get(k) ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const list = (fd: FormData, k: string, max: number, maxLen = LONG) => fd.getAll(k).map((v) => String(v).replace(/\r\n/g, '\n').trim().slice(0, maxLen)).slice(0, max);
const on = (fd: FormData, k: string) => fd.get(k) === '1';
const num = (fd: FormData, k: string) => Number(String(fd.get(k) ?? '').replace(/[$,%\s]/g, ''));

/** Same-site paths, anchors, mailto:, tel: and absolute http(s) links only. */
function safeHref(v: string): string | null {
  const s = v.trim().slice(0, 500);
  if (!s) return null;
  if (/^(\/(?!\/)|#|mailto:|tel:|https?:\/\/)/i.test(s)) return s;
  return null;
}

function link(fd: FormData, labelKey: string, hrefKey: string, fallback: Link): Link | string {
  const label = text(fd, labelKey, 80);
  const href = safeHref(text(fd, hrefKey, 500));
  if (label && !href) return `"${label}": enter a link that starts with /, #, mailto:, tel: or https://.`;
  return label ? { label, href: href! } : { label: '', href: fallback.href };
}

async function finish(page: SitePage, content: HomeContent | PricingContent | FooterContent, userId: number, message: string): Promise<ActionState> {
  await saveSiteContent(page, content, userId);
  await audit('settings.website', { actorUserId: userId, metadata: { page } });
  revalidatePath('/', 'layout');
  return { ok: true, message };
}

// ---------------------------------------------------------------------------
// Homepage
// ---------------------------------------------------------------------------
export async function saveHomeContent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const current = (await loadSiteContent()).home;

  const photo = async (key: string, existing: string | null): Promise<string | null> => {
    const file = fd.get(key);
    if (file instanceof File && file.size > 0) {
      const p = await saveImageUpload(file, 'site', 2400);
      await deleteUpload(existing);
      return p;
    }
    if (on(fd, `${key}_remove`)) { await deleteUpload(existing); return null; }
    return existing;
  };

  const links: Record<string, Link | string> = {
    go: link(fd, 'hero_go_cta_label', 'hero_go_cta_href', current.hero.go.cta),
    host: link(fd, 'hero_host_cta_label', 'hero_host_cta_href', current.hero.host.cta),
    browse: link(fd, 'browse_link_label', 'browse_link_href', current.browse.link),
    hostCta: link(fd, 'host_cta_label', 'host_cta_href', current.host.cta),
    pricing: link(fd, 'host_pricing_label', 'host_pricing_href', current.host.pricingLink),
  };
  for (const v of Object.values(links)) if (typeof v === 'string') return { error: v };
  const L = links as Record<string, Link>;
  if (!L.go.label || !L.host.label || !L.hostCta.label) return { error: 'The hero buttons and the organizer band button need a label.' };

  const titles = list(fd, 'step_title', HOW_STEP_COUNT, SHORT);
  const texts = list(fd, 'step_text', HOW_STEP_COUNT, LONG);
  const dots = list(fd, 'step_dot', HOW_STEP_COUNT, 30);
  const steps = current.how.steps.map((s, i) => ({ title: titles[i] || s.title, text: texts[i] || s.text, dot: dots[i] || s.dot }));

  const bigs = list(fd, 'stat_big', MAX_STATS, 40);
  const statTexts = list(fd, 'stat_text', MAX_STATS, LONG);
  const stats = bigs.map((big, i) => ({ big, text: statTexts[i] ?? '' })).filter((s) => s.big || s.text);

  let goImage: string | null, hostImage: string | null;
  try {
    goImage = await photo('hero_go_image', current.hero.go.image);
    hostImage = await photo('hero_host_image', current.hero.host.image);
  } catch (e) { return { error: (e as Error).message }; }

  const content: HomeContent = {
    meta: { title: text(fd, 'meta_title', 120) || current.meta.title, description: text(fd, 'meta_description', 300) || current.meta.description },
    hero: {
      heading: text(fd, 'hero_heading') || current.hero.heading,
      go: { word: text(fd, 'hero_go_word', 60) || current.hero.go.word, lead: text(fd, 'hero_go_lead', 300), cta: L.go, image: goImage },
      host: { word: text(fd, 'hero_host_word', 60) || current.hero.host.word, lead: text(fd, 'hero_host_lead', 300), cta: L.host, image: hostImage },
      hint: text(fd, 'hero_hint', 80),
      hintSub: text(fd, 'hero_hint_sub', 80),
    },
    how: { show: on(fd, 'how_show'), eyebrow: text(fd, 'how_eyebrow', 60), title: text(fd, 'how_title') || current.how.title, lead: text(fd, 'how_lead', 500), steps },
    featured: { show: on(fd, 'featured_show') },
    browse: { show: on(fd, 'browse_show'), eyebrow: text(fd, 'browse_eyebrow', 60), title: text(fd, 'browse_title') || current.browse.title, link: L.browse },
    host: {
      show: on(fd, 'host_show'),
      eyebrow: text(fd, 'host_eyebrow', 60),
      title: text(fd, 'host_title') || current.host.title,
      lead: text(fd, 'host_lead', 500),
      cta: L.hostCta,
      stats,
      pricingLink: L.pricing,
    },
  };
  return finish('home', content, session.user.id, 'Homepage saved. Open the site to see it.');
}

// ---------------------------------------------------------------------------
// Pricing page
// ---------------------------------------------------------------------------
export async function savePricingContent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const current = (await loadSiteContent()).pricing;

  const primary = link(fd, 'cta_label', 'cta_href', current.cta.primary);
  if (typeof primary === 'string') return { error: primary };
  if (!primary.label) return { error: 'The closing call to action needs a button label.' };

  const servicePercent = num(fd, 'comp_service_pct');
  const serviceFixedCents = Math.round(num(fd, 'comp_service_fixed') * 100);
  const processingPercent = num(fd, 'comp_processing_pct');
  if (![servicePercent, serviceFixedCents, processingPercent].every((n) => Number.isFinite(n) && n >= 0 && n < 10000)) return { error: 'The other platform’s rates must be zero or positive numbers.' };

  const ruleBig = list(fd, 'rule_big', RULE_COUNT, 40);
  const ruleTitle = list(fd, 'rule_title', RULE_COUNT, 80);
  const ruleText = list(fd, 'rule_text', RULE_COUNT, LONG);
  const rules = current.rules.items.map((r, i) => ({ big: ruleBig[i] || r.big, title: ruleTitle[i] || r.title, text: ruleText[i] ?? r.text }));

  const qs = list(fd, 'faq_q', MAX_FAQ, SHORT);
  const as = list(fd, 'faq_a', MAX_FAQ, LONG);
  const faq = qs.map((q, i) => ({ q, a: as[i] ?? '' })).filter((f) => f.q && f.a);

  const h = (k: string, max = SHORT) => text(fd, `hero_${k}`, max);
  const content: PricingContent = {
    meta: { title: text(fd, 'meta_title', 120) || current.meta.title, description: text(fd, 'meta_description', 300) || current.meta.description },
    hero: {
      eyebrow: h('eyebrow', 60),
      title: h('title') || current.hero.title,
      lead: h('lead', 500),
      ticketLabel: h('ticket_label', 40) || current.hero.ticketLabel,
      ticketType: h('ticket_type', 60) || current.hero.ticketType,
      ticketTagline: h('ticket_tagline', 120),
      feeLabel: h('fee_label', 40) || current.hero.feeLabel,
      payerQuestion: h('payer_question', 80) || current.hero.payerQuestion,
      payerBuyer: h('payer_buyer', 40) || current.hero.payerBuyer,
      payerOrganizer: h('payer_organizer', 40) || current.hero.payerOrganizer,
      buyerNote: h('buyer_note', 300),
      organizerNote: h('organizer_note', 300),
      taxNote: h('tax_note', 300),
    },
    rules: { show: on(fd, 'rules_show'), items: rules },
    compare: {
      show: on(fd, 'compare_show'),
      eyebrow: text(fd, 'compare_eyebrow', 60),
      title: text(fd, 'compare_title') || current.compare.title,
      lead: text(fd, 'compare_lead', 500),
      competitor: { label: text(fd, 'comp_label', 60) || current.compare.competitor.label, servicePercent, serviceFixedCents, processingPercent, checked: text(fd, 'comp_checked', 60) },
      saveNote: text(fd, 'compare_save_note', 300),
      footnote: text(fd, 'compare_footnote', 1000),
    },
    faq: { show: on(fd, 'faq_show'), eyebrow: text(fd, 'faq_eyebrow', 60), title: text(fd, 'faq_title') || current.faq.title, lead: text(fd, 'faq_lead', 300), items: faq.length ? faq : current.faq.items },
    cta: { show: on(fd, 'cta_show'), title: text(fd, 'cta_title') || current.cta.title, lead: text(fd, 'cta_lead', 300), primary, secondaryLabel: text(fd, 'cta_secondary', 40) },
  };
  return finish('pricing', content, session.user.id, 'Pricing page saved.');
}

// ---------------------------------------------------------------------------
// Footer (every public page)
// ---------------------------------------------------------------------------
/** "Label | /href" per line */
function parseLinkLines(raw: string, max: number): Link[] | string {
  const out: Link[] = [];
  for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, max)) {
    const [label, href] = line.split('|').map((s) => s.trim());
    const safe = href ? safeHref(href) : null;
    if (!label || !safe) return `"${line}": write each link as "Label | /path" (links start with /, #, mailto:, tel: or https://).`;
    out.push({ label: label.slice(0, 80), href: safe });
  }
  return out;
}

export async function saveFooterContent(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const current = (await loadSiteContent()).footer;

  const networks = list(fd, 'social_network', SOCIAL_OPTIONS.length, 20);
  const hrefs = list(fd, 'social_href', SOCIAL_OPTIONS.length, 500);
  const social: FooterContent['social'] = [];
  for (let i = 0; i < networks.length; i++) {
    const network = networks[i] as SocialNetwork;
    const href = hrefs[i] ?? '';
    if (!href) continue;
    if (!SOCIAL_OPTIONS.includes(network)) return { error: 'Choose a social network from the list.' };
    if (!/^https?:\/\//i.test(href)) return { error: `The ${network} link must start with https://.` };
    if (social.some((s) => s.network === network)) return { error: `${network} is listed twice.` };
    social.push({ network, href: href.slice(0, 500) });
  }

  const titles = list(fd, 'col_title', MAX_COLUMNS, 40);
  const colLinks = list(fd, 'col_links', MAX_COLUMNS, 4000);
  const columns: FooterContent['columns'] = [];
  for (let i = 0; i < titles.length; i++) {
    if (!titles[i]) continue;
    const links = parseLinkLines(colLinks[i] ?? '', MAX_LINKS);
    if (typeof links === 'string') return { error: links };
    columns.push({ title: titles[i], links });
  }
  const legal = parseLinkLines(text(fd, 'legal_links', 4000), MAX_LINKS);
  if (typeof legal === 'string') return { error: legal };

  const content: FooterContent = {
    blurb: text(fd, 'blurb', 300),
    social,
    columns: columns.length ? columns : current.columns,
    copyright: text(fd, 'copyright', 200) || current.copyright,
    legal: legal.length ? legal : current.legal,
  };
  return finish('footer', content, session.user.id, 'Footer saved.');
}

// ---------------------------------------------------------------------------
// Event categories (homepage pills, /events filter, /create and the organizer's event form)
// ---------------------------------------------------------------------------
export async function saveEventCategories(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const names = list(fd, 'cat_name', MAX_CATEGORIES, 40);
  const icons = list(fd, 'cat_icon', MAX_CATEGORIES, 30);
  const categories: Category[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name) continue;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return { error: `"${name}" is listed twice.` };
    categories.push({ name, icon: icons[i] in CATEGORY_ICONS ? icons[i] : 'tag' });
  }
  if (!categories.length) return { error: 'Keep at least one category.' };
  await saveCategories(categories, session.user.id);
  await audit('settings.website', { actorUserId: session.user.id, metadata: { page: 'categories', count: categories.length } });
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Categories saved. Events already filed under a removed category keep it until they are edited.' };
}
