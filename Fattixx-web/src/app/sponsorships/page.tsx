import type { Metadata } from "next";
import Link from "next/link";
import { listMarketplace } from "@/lib/sponsorships/deals";
import { categoryNames } from "@/lib/site-content/categories";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";
import { EmptyState, PageHeader } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Sponsor an event", description: "Sponsorship opportunities from event organizers on Fattixx: put your brand in front of their audience." };

/** The sponsorship marketplace (lib/sponsorships/deals.ts): listed packages for upcoming public events and organizers' seasons. */
export default async function SponsorshipsPage({ searchParams }: PageProps<"/sponsorships">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim().slice(0, 80) : "");
  const f = { q: one(sp.q), category: one(sp.cat), city: one(sp.city) };
  const [packages, categories] = await Promise.all([listMarketplace(f), categoryNames()]);
  return (
    <PublicShell wide>
      <PageHeader title="Sponsor an event" description="Organizers list what they offer sponsors. Request a package, the organizer accepts, and you pay securely through Fattixx." actions={<Button variant="outline" render={<Link href="/sponsorships/deals" />}>Your sponsorships</Button>} />
      <form className="mt-6 flex flex-wrap gap-2" action="/sponsorships">
        <Input name="q" defaultValue={f.q} placeholder="Search events or organizers" className="max-w-xs" aria-label="Search" />
        <select name="cat" defaultValue={f.category} aria-label="Category" className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Input name="city" defaultValue={f.city} placeholder="City" className="max-w-40" aria-label="City" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <div className="mt-6">
        {packages.length === 0 ? <EmptyState title="No sponsorship opportunities match" description="Try another search, or check back soon." /> : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {packages.map((p) => (
              <li key={p.id} className="flex flex-col rounded-2xl border bg-card p-5">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{p.org_name}</p>
                <Link href={`/sponsorships/${p.id}`} className="mt-1 text-lg font-semibold hover:underline">{p.title}</Link>
                <p className="mt-1 text-sm text-muted-foreground">
                  {p.event_title ? <>{p.event_title}{p.event_starts_at && p.event_timezone ? ` · ${formatEventDate(new Date(p.event_starts_at), p.event_timezone, { withTime: false })}` : ""}{p.venue_city ? ` · ${p.venue_city}` : ""}</> : "Season sponsorship"}
                </p>
                {p.description ? <p className="mt-3 line-clamp-3 text-sm">{p.description}</p> : null}
                <div className="mt-auto flex items-end justify-between pt-4">
                  <span className="text-xl font-semibold tabular-nums">{formatCents(Number(p.price_cents), p.currency)}</span>
                  <span className="text-xs text-muted-foreground">{Number(p.quantity) - Number(p.sold)} of {p.quantity} left{Number(p.includes_ad) ? " · includes ad" : ""}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PublicShell>
  );
}
