/* Page composition; shared Pro content and pricing live in lib/pro.ts. */

import type { FeeConfig } from "@/lib/home/pricing";
import ProHero from "./ProHero";
import ProPricing from "./ProPricing";
import { ProCta, ProFaq, ProFeatures, ReservedSeating } from "./ProSections";

const gap = "pt-[120px] max-[721px]:pt-[88px]";

export default function ProPage({ fees, contactEmail }: { fees: FeeConfig; contactEmail: string }) {
  return (
    <>
      <ProHero />
      <ProFeatures className="pt-10" />
      <ReservedSeating className={gap} />
      <ProPricing className={gap} contactEmail={contactEmail} />
      <ProFaq className={gap} fees={fees} contactEmail={contactEmail} />
      <ProCta className={`${gap} pb-[150px] max-[721px]:pb-[110px]`} />
    </>
  );
}
