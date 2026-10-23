import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon, PlusIcon } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guard";
import { listCampaigns, ctr } from "@/lib/ads/queries";
import { effectiveStatus, PLACEMENTS } from "@/lib/ads/placements";
import { setCampaignStatus } from "@/lib/ads/actions";
import { PageHeader, Section, StatusBadge, EmptyState, Stat, formatDate } from "@/components/shared";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Ads & sponsorships" };

const label = (k: string) => PLACEMENTS.find((p) => p.key === k)?.label ?? k;

export default async function AdsPage() {
  await requireSuperAdmin();
  const campaigns = await listCampaigns();
  // organizer sponsor ads waiting for approval, and paid advertiser campaigns waiting for review
  const awaiting = campaigns.filter((c) => (c.organization_id && c.status === "draft") || c.review_status === "submitted");
  const live = campaigns.filter((c) => effectiveStatus(c) === "active");
  const imps = campaigns.reduce((n, c) => n + Number(c.impressions), 0);
  const clicks = campaigns.reduce((n, c) => n + Number(c.clicks), 0);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Ads & sponsorships"
        description="Campaigns are data: add, pause, schedule, target or remove them here without a deployment. Pages request an ad for a named placement and show nothing when none is active."
        actions={<><Button variant="outline" nativeButton={false} render={<a href="/api/exports/ads" />}><DownloadIcon /> Export report</Button><Button render={<Link href="/admin/ads/new" />}><PlusIcon /> New campaign</Button></>}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Live campaigns" value={live.length} hint={`${campaigns.length} in total`} />
        <Stat label="Awaiting approval" value={awaiting.length} hint="Sponsor ads and paid advertiser campaigns" />
        <Stat label="Impressions" value={imps.toLocaleString()} hint="All time" />
        <Stat label="Clicks · CTR" value={`${clicks.toLocaleString()} · ${ctr(imps, clicks)}`} />
      </div>
      {awaiting.length ? (
        <Section title="Awaiting approval" description="Sponsor ads submitted by organizers for their own events, and paid campaigns from self-service advertisers. Review the creatives and destination, then activate (or reject an advertiser campaign with a refund on its page).">
          <Table>
            <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Organization · event</TableHead><TableHead>Submitted</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {awaiting.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><Link href={`/admin/ads/${c.id}`} className="font-medium hover:underline">{c.name}</Link><span className="block text-xs text-muted-foreground">{c.creatives} creative(s) · {c.destination_url}</span></TableCell>
                  <TableCell>{c.advertiser_company ? `Advertiser: ${c.advertiser_company}` : `${c.org_name} · ${c.event_title}`}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                  <TableCell className="text-right"><ConfirmButton action={setCampaignStatus} fields={{ id: c.id, status: "active" }} title={`Approve and activate “${c.name}”?`} description="It starts showing on the organizer's event pages within its dates." confirmText="Activate" variant="default">Approve</ConfirmButton></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      ) : null}
      <Section title="All campaigns">
        {campaigns.length === 0 ? <EmptyState title="No campaigns yet" description="Create a campaign, add a creative and choose where it appears." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Campaign</TableHead><TableHead>Status</TableHead><TableHead>Placements</TableHead><TableHead>Dates</TableHead><TableHead className="text-right">Impr.</TableHead><TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">CTR</TableHead></TableRow></TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><Link href={`/admin/ads/${c.id}`} className="font-medium hover:underline">{c.name}</Link><span className="block text-xs text-muted-foreground capitalize">{c.kind}{c.advertiser_name ? ` · ${c.advertiser_name}` : ""}{c.org_name ? ` · ${c.org_name}` : ""}</span></TableCell>
                  <TableCell><StatusBadge status={(c.organization_id && c.status === "draft") || c.review_status === "submitted" ? "awaiting_approval" : effectiveStatus(c)} /></TableCell>
                  <TableCell className="max-w-56 text-xs text-muted-foreground">{(c.placements ?? "").split(",").filter(Boolean).map(label).join(", ") || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.starts_at ? formatDate(c.starts_at) : "now"} → {c.ends_at ? formatDate(c.ends_at) : "open"}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(c.impressions).toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(c.clicks).toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{ctr(Number(c.impressions), Number(c.clicks))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
