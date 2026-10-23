import "server-only";
import { cache } from "react";
import { getBranding, platformFeeConfig } from "../settings";
import { feeCapLabel, feeLabel, formatCents, percent, processingLabel } from "../home/pricing";
import { uploadUrl } from "../uploads";
import { DEFAULTS, type FooterContent, type HomeContent, type PricingContent } from "./schema";

export * from "./schema";

// ---------------------------------------------------------------------------
// Tokens: {fee}, {processing}, … filled in from the live settings so copy always matches checkout.
// ---------------------------------------------------------------------------
type Tokens = Record<string, string>;

const tokenContext = cache(async (): Promise<Tokens> => {
  const [fees, brand] = await Promise.all([platformFeeConfig(), getBranding()]);
  const processing = processingLabel(fees);
  const cap = feeCapLabel(fees);
  const fee = feeLabel(fees);
  const c = DEFAULTS.pricing.compare.competitor;
  return {
    fee,
    // "" when there is no cap: copy built only from {fee_cap} is then left out (see homeContent / pricingContent)
    fee_cap: cap ?? "",
    fee_cap_clause: cap ? `, never more than ${cap} per ticket` : "",
    processing: processing ?? "included",
    processing_rate: processing ? processing.replace(" per order", "") : "Included",
    processing_clause: processing ? `, plus card processing of ${processing}` : ", with card processing included",
    processing_answer: processing ? `Card processing is ${processing}, charged once per paid order. The ${fee} fee is per ticket.` : `No. Card processing is included in the ${fee} fee per ticket.`,
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
  home.host.stats = home.host.stats.filter((s) => s.big.trim()); // e.g. the fee-cap stat when no cap is set
  return home;
}

export async function pricingContent(): Promise<PricingContent> {
  return fillDeep(DEFAULTS.pricing, await tokenContext());
}

export async function footerContent(): Promise<FooterContent> {
  return fillDeep(DEFAULTS.footer, await tokenContext());
}
