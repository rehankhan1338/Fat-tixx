import type { Metadata } from "next";
import { requireOrg } from "@/lib/authz";
import { orgIsPro } from "@/lib/pro/gate";
import { uploadUrl } from "@/lib/uploads";
import { PageHeader, Section } from "@/components/shared";
import { proNav, ProUpsell, SubNav } from "@/components/pro/dashboard";
import { BrandingForm } from "./branding-form";

export const metadata: Metadata = { title: "Branding" };

export default async function BrandingPage({ params }: PageProps<"/org/[slug]/pro/branding">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "org_admin");
  const pro = orgIsPro(ctx.org);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Branding" description="Your colors, cover image and header on your event pages and organizer page. Applied the same way to every event." />
      <SubNav items={proNav(slug)} current={`/org/${slug}/pro/branding`} />
      {!pro ? <ProUpsell ctx={ctx} feature="Branding" text="Put your logo, colors and photos on every event page, and replace the Fattixx header with your own." /> : null}
      <Section title="Your look" description="Your logo is set under Settings. Colors must stay readable for everyone, so very light colors are not accepted.">
        <BrandingForm
          org={slug}
          disabled={!pro}
          logoUrl={uploadUrl(ctx.org.logo_path)}
          name={ctx.org.name}
          primary={ctx.org.brand_primary}
          accent={ctx.org.brand_accent}
          coverUrl={uploadUrl(ctx.org.brand_cover_path)}
          ownHeader={!!ctx.org.brand_own_header}
        />
      </Section>
    </div>
  );
}
