import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { advertiserForUser } from "@/lib/ads/advertisers";
import { formatCents } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { PageHeader, Section } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { AdvertiserApplyForm } from "./apply-form";

export const metadata: Metadata = { title: "Advertise on Fattixx", description: "Reach people buying tickets to live events near them. Self-service ads with targeting by place, category, ticket type and audience." };

/** The advertiser portal's front door (lib/ads/advertisers.ts): what it is, and the application for signed-in visitors. */
export default async function AdvertisePage() {
  const [session, s] = await Promise.all([getSession(), getSettings()]);
  const adv = session ? await advertiserForUser(session.user.id) : null;
  const cpm = formatCents(Number(s.ad_cpm_cents));
  return (
    <PublicShell>
      <PageHeader title="Advertise on Fattixx" description="Put your brand in front of people going out: on event listings and pages, order confirmations, ticket emails and the ticket dashboard." />
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {[
          { t: "Targeted", d: "Show ads by state and city, event category, ticket type (VIP, tables, …), audience (guests, signed-in fans, organizers) and how close the event is." },
          { t: "Simple pricing", d: `${cpm} per 1,000 impressions, from ${Number(s.ad_min_impressions).toLocaleString()} impressions. An impression counts only once at least half of the ad was on screen.` },
          { t: "Reviewed and safe", d: "Every campaign is reviewed before it goes live. No ads on checkout or payment pages, no tracking cookies, and a full refund if we reject it." },
        ].map((x) => (
          <div key={x.t} className="rounded-2xl border bg-card p-5"><p className="font-semibold">{x.t}</p><p className="mt-2 text-sm text-muted-foreground">{x.d}</p></div>
        ))}
      </div>
      <div className="mt-10">
        {!session ? (
          <Section title="Get started" description="Sign in or create a free account first; your advertiser account is linked to it.">
            <div className="flex flex-wrap gap-3">
              <Button render={<Link href="/login?next=/advertise" />}>Sign in</Button>
              <Button variant="outline" render={<Link href="/register?next=/advertise" />}>Create an account</Button>
            </div>
          </Section>
        ) : adv?.status === "approved" ? (
          <Section title="You are approved" description={`${adv.company_name} can advertise on Fattixx.`}>
            <Button render={<Link href="/advertiser" />}>Open the advertiser portal</Button>
          </Section>
        ) : adv?.status === "pending" ? (
          <Section title="Application in review" description={`We are reviewing ${adv.company_name}. You will get an email at ${adv.contact_email}.`}><span /></Section>
        ) : adv?.status === "suspended" ? (
          <Section title="Account suspended" description={adv.review_notes ?? "Contact Fattixx support."}><span /></Section>
        ) : (
          <Section title="Apply to advertise" description={adv?.status === "rejected" ? `Your earlier application was not approved${adv.review_notes ? `: ${adv.review_notes}` : ""}. You can apply again.` : "Tell us who you are. We review new advertisers within one to two business days."}>
            <AdvertiserApplyForm defaults={{ company: adv?.company_name ?? "", contact: adv?.contact_name ?? session.user.name, email: adv?.contact_email ?? session.user.email, website: adv?.website ?? "" }} />
          </Section>
        )}
      </div>
    </PublicShell>
  );
}
