import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getMarketplacePackage } from "@/lib/sponsorships/deals";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";
import { PageHeader, Section } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { RequestSponsorshipForm } from "./request-form";

export async function generateMetadata({ params }: PageProps<"/sponsorships/[id]">): Promise<Metadata> {
  const p = await getMarketplacePackage(Number((await params).id));
  return p ? { title: `${p.title} · Sponsor ${p.org_name}`, description: p.description?.slice(0, 160) } : { title: "Sponsorship not available" };
}

export default async function SponsorshipPackagePage({ params }: PageProps<"/sponsorships/[id]">) {
  const id = Number((await params).id);
  const [p, session] = await Promise.all([getMarketplacePackage(id), getSession()]);
  if (!p) notFound();
  const perks = (p.perks ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <PublicShell>
      <p className="text-sm"><Link href="/sponsorships" className="hover:underline">← All opportunities</Link></p>
      <PageHeader title={p.title} description={<>{p.org_name}{p.event_title ? <> · <Link href={`/events/${p.event_slug}`} className="underline">{p.event_title}</Link>{p.event_starts_at && p.event_timezone ? `, ${formatEventDate(new Date(p.event_starts_at), p.event_timezone)}` : ""}</> : " · season sponsorship"}</>} />
      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {p.description ? <p className="whitespace-pre-line">{p.description}</p> : null}
          {perks.length ? (
            <div><p className="font-semibold">What you get</p><ul className="mt-2 list-disc space-y-1 pl-5">{perks.map((x) => <li key={x}>{x}</li>)}</ul></div>
          ) : null}
          {Number(p.includes_ad) ? <p className="text-sm text-muted-foreground">Includes a “Sponsored” ad with your image on the event page and on buyers’ order confirmations.</p> : null}
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <p className="text-2xl font-semibold tabular-nums">{formatCents(Number(p.price_cents), p.currency)}</p>
          <p className="text-sm text-muted-foreground">{Number(p.quantity) - Number(p.sold)} of {p.quantity} available</p>
          <p className="mt-3 text-xs text-muted-foreground">You pay only after the organizer accepts. Payments are processed by Fattixx.</p>
        </div>
      </div>
      <div className="mt-8">
        {session ? (
          <Section title="Request this sponsorship" description="The organizer gets your request by email and replies through Fattixx.">
            <RequestSponsorshipForm packageId={p.id} defaults={{ contact: session.user.name, email: session.user.email }} />
          </Section>
        ) : (
          <Section title="Request this sponsorship" description="Sign in or create a free account to send a request.">
            <div className="flex flex-wrap gap-3">
              <Button render={<Link href={`/login?next=/sponsorships/${p.id}`} />}>Sign in</Button>
              <Button variant="outline" render={<Link href={`/register?next=/sponsorships/${p.id}`} />}>Create an account</Button>
            </div>
          </Section>
        )}
      </div>
    </PublicShell>
  );
}
