import "server-only";
import { cache } from "react";
import { getBranding, getSettings, getSettingValue, setSetting } from "../settings";
import { feeLabel, formatCents, percent, processingLabel } from "../home/pricing";
import type { FeeConfig } from "../money";
import { uploadUrl } from "../uploads";
import { DEFAULTS, withDefaults, type FooterContent, type HomeContent, type PricingContent, type SiteContent, type SitePage } from "./schema";

export * from "./schema";

const KEYS: Record<SitePage, string> = { home: "site_home", pricing: "site_pricing", footer: "site_footer" };

/** The stored documents (with defaults filled in), tokens not yet replaced: what the admin forms edit. */
export const loadSiteContent = cache(async (): Promise<SiteContent> => {
  const out = { ...DEFAULTS };
  for (const page of Object.keys(KEYS) as SitePage[]) {
    const raw = await getSettingValue(KEYS[page]);
    let stored: unknown = null;
    if (raw) {
      try { stored = JSON.parse(raw); } catch { stored = null; }
    }
    out[page] = withDefaults(DEFAULTS[page], stored) as never;
  }
  return out;
});

export async function saveSiteContent(page: SitePage, content: SiteContent[SitePage], userId: number): Promise<void> {
  await setSetting(KEYS[page], JSON.stringify(content), userId);
}

// ---------------------------------------------------------------------------
// Tokens: {fee}, {processing}, … filled in from the live settings so copy always matches checkout.
// ---------------------------------------------------------------------------
type Tokens = Record<string, string>;

const tokenContext = cache(async (): Promise<Tokens> => {
  const [s, brand, content] = await Promise.all([getSettings(), getBranding(), loadSiteContent()]);
  const fees: FeeConfig = {
    platformFeeBps: Number(s.platform_fee_bps),
    platformFeeFixedCents: Number(s.platform_fee_fixed_cents),
    processingFeeBps: Number(s.processing_fee_bps),
    processingFeeFixedCents: Number(s.processing_fee_fixed_cents),
  };
  const processing = processingLabel(fees);
  const c = content.pricing.compare.competitor;
  return {
    fee: feeLabel(fees),
    processing: processing ?? "included",
    processing_rate: processing ? processing.replace(" per order", "") : "Included",
    processing_clause: processing ? `, plus card processing of ${processing}` : ", with card processing included",
    platform_name: brand.name,
    support_email: brand.supportEmail,
    year: String(new Date().getFullYear()),
    competitor: c.label,
    competitor_rate: `${percent(Math.round(c.servicePercent * 100))} + ${formatCents(c.serviceFixedCents)} service fee plus ${percent(Math.round(c.processingPercent * 100))} payment processing`,
    competitor_checked: c.checked,
  };
});

export function fillTokens(text: string, tokens: Tokens): string {
  return text.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in tokens ? tokens[k] : m));
}

function fillDeep<T>(value: T, tokens: Tokens): T {
  if (typeof value === "string") return fillTokens(value, tokens) as T;
  if (Array.isArray(value)) return value.map((v) => fillDeep(v, tokens)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fillDeep(v, tokens)])) as T;
  }
  return value;
}

/** Homepage content ready to render: tokens filled in, hero images as URLs. */
export async function homeContent(): Promise<HomeContent> {
  const [content, tokens] = await Promise.all([loadSiteContent(), tokenContext()]);
  const home = fillDeep(content.home, tokens);
  home.hero.go.image = uploadUrl(home.hero.go.image);
  home.hero.host.image = uploadUrl(home.hero.host.image);
  return home;
}

export async function pricingContent(): Promise<PricingContent> {
  const [content, tokens] = await Promise.all([loadSiteContent(), tokenContext()]);
  return fillDeep(content.pricing, tokens);
}

export async function footerContent(): Promise<FooterContent> {
  const [content, tokens] = await Promise.all([loadSiteContent(), tokenContext()]);
  return fillDeep(content.footer, tokens);
}
