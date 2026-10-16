import "server-only";
import { cache } from "react";
import { getBranding, getSettings } from "../settings";
import { feeLabel, formatCents, percent, processingLabel } from "../home/pricing";
import type { FeeConfig } from "../money";
import { uploadUrl } from "../uploads";
import { DEFAULTS, type FooterContent, type HomeContent, type PricingContent } from "./schema";

export * from "./schema";

// ---------------------------------------------------------------------------
// Tokens: {fee}, {processing}, … filled in from the live settings so copy always matches checkout.
// ---------------------------------------------------------------------------
type Tokens = Record<string, string>;

const tokenContext = cache(async (): Promise<Tokens> => {
  const [s, brand] = await Promise.all([getSettings(), getBranding()]);
  const fees: FeeConfig = {
    platformFeeBps: Number(s.platform_fee_bps),
    platformFeeFixedCents: Number(s.platform_fee_fixed_cents),
    processingFeeBps: Number(s.processing_fee_bps),
    processingFeeFixedCents: Number(s.processing_fee_fixed_cents),
  };
  const processing = processingLabel(fees);
  const c = DEFAULTS.pricing.compare.competitor;
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
  const home = fillDeep(DEFAULTS.home, await tokenContext());
  home.hero.go.image = uploadUrl(home.hero.go.image);
  home.hero.host.image = uploadUrl(home.hero.host.image);
  return home;
}

export async function pricingContent(): Promise<PricingContent> {
  return fillDeep(DEFAULTS.pricing, await tokenContext());
}

export async function footerContent(): Promise<FooterContent> {
  return fillDeep(DEFAULTS.footer, await tokenContext());
}
