import type { Metadata } from "next";
import { brandingForLayout } from "@/lib/branding";
import { siteFees } from "@/lib/home/data";
import { formatCents } from "@/lib/home/pricing";
import { PRO_MONTHLY_CENTS, PRO_YEARLY_MONTHLY_CENTS } from "@/lib/home/pro";
import { PublicPage } from "@/components/layout/PublicPage";
import ProPage from "@/components/pro/ProPage";

export const metadata: Metadata = {
  title: "Fattixx Pro",
  description: `Your brand, your tickets: your own web address, logo and colors, no third-party ads, plus reserved seating, email marketing and advanced reports. ${formatCents(PRO_MONTHLY_CENTS)} a month, or ${formatCents(PRO_YEARLY_MONTHLY_CENTS)} a month billed yearly.`,
  robots: { index: true, follow: true },
};

export default async function Page() {
  const [fees, brand] = await Promise.all([siteFees(), brandingForLayout()]);
  return (
    <PublicPage reveal>
      <main>
        <ProPage fees={fees} contactEmail={brand.supportEmail} />
      </main>
    </PublicPage>
  );
}
