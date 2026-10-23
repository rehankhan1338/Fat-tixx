import type { Metadata } from "next";
import { requireOrg } from "@/lib/authz";
import { getSettings } from "@/lib/settings";
import { formatCents } from "@/lib/money";
import { uploadUrl } from "@/lib/uploads";
import { PageHeader, Section } from "@/components/shared";
import { OrgSettingsForm } from "./org-settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function OrgSettingsPage({ params }: PageProps<"/org/[slug]/settings">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "org_admin");
  const s = await getSettings();
  const feeBps = ctx.org.fee_bps_override ?? Number(s.platform_fee_bps);
  const feeFixed = ctx.org.fee_fixed_cents_override ?? Number(s.platform_fee_fixed_cents);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Organization settings" description="Profile shown on your event pages and receipts." />
      <Section title="Profile">
        <OrgSettingsForm org={{ slug: ctx.org.slug, name: ctx.org.name, legal_name: ctx.org.legal_name, contact_email: ctx.org.contact_email, contact_phone: ctx.org.contact_phone, website: ctx.org.website, description: ctx.org.description, logoUrl: uploadUrl(ctx.org.logo_path) }} />
      </Section>
      <Section title="Fees" description="Set by Fattixx. Each event chooses whether buyers pay these fees or you absorb them.">
        <p className="text-sm">
          Platform fee: <span className="font-mono">{(feeBps / 100).toFixed(2)}%</span> + <span className="font-mono">{formatCents(feeFixed)}</span> per paid ticket
          {Number(s.platform_fee_cap_cents) > 0 ? <>, never more than <span className="font-mono">{formatCents(Number(s.platform_fee_cap_cents))}</span> per ticket</> : null}.{" "}
          {Number(s.processing_fee_bps) || Number(s.processing_fee_fixed_cents)
            ? <>Card processing: <span className="font-mono">{(Number(s.processing_fee_bps) / 100).toFixed(2)}%</span> + <span className="font-mono">{formatCents(Number(s.processing_fee_fixed_cents))}</span> per order.</>
            : "Card processing is included."}
        </p>
      </Section>
    </div>
  );
}
