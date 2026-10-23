import type { Metadata } from "next";
import { categoryNames } from "@/lib/site-content/categories";
import { PageHeader, Section } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { requireAdvertiser } from "../../guard";
import { NewAdvertiserCampaign } from "./new-campaign";

export const metadata: Metadata = { title: "New campaign", robots: { index: false } };

export default async function NewAdvertiserCampaignPage() {
  await requireAdvertiser();
  return (
    <PublicShell>
      <PageHeader title="New campaign" description="Set where and to whom the ad shows. You add the image and buy impressions on the next screen." />
      <div className="mt-6"><Section><NewAdvertiserCampaign categories={await categoryNames()} /></Section></div>
    </PublicShell>
  );
}
