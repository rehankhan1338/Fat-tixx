import type { Metadata } from "next";
import { brandingForLayout } from "@/lib/branding";
import { pricingContent } from "@/lib/site-content";
import { PublicPage } from "@/components/layout/PublicPage";
import FeeComparison from "@/components/pricing/FeeComparison";
import PricingHero from "@/components/pricing/PricingHero";
import PricingRequest from "@/components/pricing/PricingRequest";
import { FeeRules, PricingCta, PricingFaq } from "@/components/pricing/PricingSections";

export async function generateMetadata(): Promise<Metadata> {
  const c = await pricingContent();
  return { title: c.meta.title, description: c.meta.description, robots: { index: true, follow: true } };
}

/**
 * Every heading, paragraph, FAQ entry and the comparison rates come from src/lib/site-content/schema.ts; the fee figures from Fees & Settings.
 * For launch only the "Send me pricing" form and the FAQ are on, so no fee figures appear on the page.
 */
export default async function PricingPage() {
  const [c, brand] = await Promise.all([pricingContent(), brandingForLayout()]);
  return (
    <PublicPage reveal>
      <main>
        {c.request.show && <PricingRequest content={c.request} />}
        {c.hero.show && <PricingHero content={c.hero} />}
        {c.rules.show && <FeeRules content={c.rules} />}
        {c.compare.show && <FeeComparison content={c.compare} />}
        {c.faq.show && <PricingFaq content={c.faq} last={!c.cta.show} />}
        {c.cta.show && <PricingCta content={c.cta} contactEmail={brand.supportEmail} />}
      </main>
    </PublicPage>
  );
}
