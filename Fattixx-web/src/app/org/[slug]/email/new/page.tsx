import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireOrg } from "@/lib/authz";
import { orgIsPro } from "@/lib/pro/gate";
import { PageHeader, Section } from "@/components/shared";
import { CampaignEditor } from "../email-client";
import { campaignEditorData } from "../editor-data";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({ params }: PageProps<"/org/[slug]/email/new">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  if (ctx.role === "staff") notFound();
  if (!orgIsPro(ctx.org)) redirect(`/org/${slug}/email`);
  const data = await campaignEditorData(ctx);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="New campaign" description="Write it, preview it with a test email, then send now or schedule it." />
      <Section>
        <CampaignEditor org={slug} campaign={null} {...data} />
      </Section>
    </div>
  );
}
