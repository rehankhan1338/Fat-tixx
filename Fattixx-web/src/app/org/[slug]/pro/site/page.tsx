import type { Metadata } from "next";
import { requireOrg } from "@/lib/authz";
import { env } from "@/lib/env";
import { orgIsPro } from "@/lib/pro/gate";
import { publicOriginFor } from "@/lib/pro/domains";
import { listSitePages, MAX_SITE_PAGES, whiteLabelActive } from "@/lib/pro/white-label";
import { PageHeader, Section } from "@/components/shared";
import { proNav, ProUpsell, SubNav } from "@/components/pro/dashboard";
import { SenderNameForm, SitePageForm } from "./site-forms";

export const metadata: Metadata = { title: "White-label site" };

/** Organization Admin: white-label site pages and sender name (lib/pro/white-label.ts). */
export default async function WhiteLabelPage({ params }: PageProps<"/org/[slug]/pro/site">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug, "org_admin");
  const pro = orgIsPro(ctx.org);
  const on = whiteLabelActive(ctx.org);
  const [pages, origin] = await Promise.all([listSitePages(ctx.org.id), publicOriginFor(ctx.org.id)]);
  // On their live custom domain pages sit at /p/<page>; otherwise under the organizer page.
  const pageUrl = (p: string) => (origin !== env.APP_URL ? `${origin}/p/${p}` : `${env.APP_URL}/o/${slug}/p/${p}`);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="White-label site" description="Your own brand on everything buyers see: your pages, your name on tickets, wallet passes, emails and texts." />
      <SubNav items={proNav(slug)} current={`/org/${slug}/pro/site`} />
      {!pro ? <ProUpsell ctx={ctx} feature="White-label" text="White-label is an add-on to Fattixx Pro: your own site pages, and your name instead of Fattixx's on tickets and emails." /> : null}
      {pro && !on ? (
        <Section title="Not switched on yet" description="White-label is an add-on to your Pro plan. Ask us through Help and we will switch it on. You can look at the settings now; they open once it is on.">
          <p className="text-sm text-muted-foreground">While it is on, Fattixx is only named where it has to be: as the seller of record on receipts and in the footer.</p>
        </Section>
      ) : null}
      <Section title="Emails and texts" description="Ticket, reminder, refund and transfer emails use your name and logo (the logo is set under Settings).">
        <SenderNameForm org={slug} value={ctx.org.email_sender_name ?? ""} orgName={ctx.org.name} disabled={!on} />
      </Section>
      <Section title="Site pages" description={`Up to ${MAX_SITE_PAGES} pages (About, FAQ, Venue info, …), linked from your header and footer.`}>
        <div className="space-y-4">
          {pages.map((p) => (
            <details key={p.id} className="rounded-xl border p-4">
              <summary className="cursor-pointer font-medium">
                {p.title} <span className="ml-2 font-mono text-xs text-muted-foreground">{pageUrl(p.slug)}</span>
                {p.published ? null : <span className="ml-2 text-xs text-muted-foreground">(draft)</span>}
              </summary>
              <div className="pt-4"><SitePageForm org={slug} disabled={!on} page={{ id: Number(p.id), title: p.title, slug: p.slug, body: p.body, published: !!Number(p.published), sort_order: Number(p.sort_order) }} /></div>
            </details>
          ))}
          {pages.length < MAX_SITE_PAGES ? (
            <details className="rounded-xl border border-dashed p-4" open={!pages.length}>
              <summary className="cursor-pointer font-medium">Add a page</summary>
              <div className="pt-4"><SitePageForm org={slug} disabled={!on} page={{ title: "", slug: "", body: "", published: true, sort_order: pages.length }} /></div>
            </details>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
