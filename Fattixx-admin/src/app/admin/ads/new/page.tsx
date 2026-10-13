import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth/guard";
import { PageHeader, Section } from "@/components/shared";
import { NewCampaign } from "./new-campaign";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  await requireSuperAdmin();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="New campaign" description="Create the campaign first; you can add creatives on the next screen. New campaigns start as drafts." />
      <Section><NewCampaign /></Section>
    </div>
  );
}
