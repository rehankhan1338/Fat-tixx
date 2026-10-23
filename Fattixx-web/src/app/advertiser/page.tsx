import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { advertiserCampaignState, listAdvertiserCampaigns } from "@/lib/ads/advertisers";
import { ctr } from "@/lib/ads/queries";
import { formatCents } from "@/lib/money";
import { EmptyState, PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdvertiser } from "./guard";

export const metadata: Metadata = { title: "Advertiser portal", robots: { index: false } };

export default async function AdvertiserHome() {
  const { advertiser } = await requireAdvertiser();
  const campaigns = await listAdvertiserCampaigns(Number(advertiser.id));
  const imps = campaigns.reduce((n, c) => n + Number(c.impressions), 0);
  const clicks = campaigns.reduce((n, c) => n + Number(c.clicks), 0);
  const spent = campaigns.filter((c) => c.payment_status === "paid").reduce((n, c) => n + Number(c.price_cents ?? 0), 0);
  return (
    <PublicShell wide>
      <PageHeader title={advertiser.company_name} description="Your Fattixx ad campaigns." actions={<Button render={<Link href="/advertiser/campaigns/new" />}><PlusIcon /> New campaign</Button>} />
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Impressions" value={imps.toLocaleString()} hint="all campaigns" />
        <Stat label="Clicks · CTR" value={`${clicks.toLocaleString()} · ${ctr(imps, clicks)}`} />
        <Stat label="Spent" value={formatCents(spent)} />
      </div>
      <div className="mt-6">
        <Section title="Campaigns">
          {campaigns.length === 0 ? <EmptyState title="No campaigns yet" description="Create a campaign, add an image, choose where and to whom it shows, then buy impressions." action={<Button render={<Link href="/advertiser/campaigns/new" />}>Create a campaign</Button>} /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Status</TableHead><TableHead>Dates</TableHead><TableHead className="text-right">Delivered</TableHead><TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">Paid</TableHead></TableRow></TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><Link href={`/advertiser/campaigns/${c.id}`} className="font-medium hover:underline">{c.name}</Link><span className="block text-xs text-muted-foreground">{c.creatives} creative(s)</span></TableCell>
                    <TableCell><StatusBadge status={advertiserCampaignState(c)} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.starts_at ? formatDate(c.starts_at) : "on approval"} → {c.ends_at ? formatDate(c.ends_at) : "until delivered"}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(c.impressions_served).toLocaleString()}{c.impressions_cap ? ` / ${Number(c.impressions_cap).toLocaleString()}` : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(c.clicks).toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.payment_status === "paid" || c.payment_status === "refunded" ? formatCents(Number(c.price_cents)) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </PublicShell>
  );
}
