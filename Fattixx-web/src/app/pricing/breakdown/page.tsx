import type { Metadata } from "next";
import { brandingForLayout } from "@/lib/branding";
import { pricingContent } from "@/lib/site-content";
import { PublicPage } from "@/components/layout/PublicPage";
import FeeComparison from "@/components/pricing/FeeComparison";
import PricingHero from "@/components/pricing/PricingHero";
import { FeeRules, PricingCta, PricingFaq } from "@/components/pricing/PricingSections";

export async function generateMetadata(): Promise<Metadata> {
  const c = await pricingContent();
  return { title: c.breakdown.meta.title, description: c.breakdown.meta.description, robots: { index: false, follow: false } };
}

/**
 * The full pricing page with fee figures, sent by link to organizers who ask for pricing. Public, but noindex and not
 * linked from the site. It always shows every section, whatever the `show` flags on /pricing say.
 */
export default async function PricingBreakdownPage() {
  const [c, brand] = await Promise.all([pricingContent(), brandingForLayout()]);
  return (
    <PublicPage reveal>
      <main>
        <PricingHero content={c.hero} />
        <FeeRules content={c.rules} />
        <FeeComparison content={c.compare} />
        <PricingFaq content={{ ...c.faq, items: c.breakdown.faq }} />
        <PricingCta content={c.cta} contactEmail={brand.supportEmail} />
      </main>
    </PublicPage>
  );
}
