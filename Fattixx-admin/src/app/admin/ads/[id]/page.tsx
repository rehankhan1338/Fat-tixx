import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DownloadIcon } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guard";
import { campaignFormValues, campaignStats, ctr, getCampaign, listCreatives, type AdStatRow } from "@/lib/ads/queries";
import { effectiveStatus, PLACEMENTS } from "@/lib/ads/placements";
import { deleteCampaign, setCampaignStatus } from "@/lib/ads/actions";
import { PageHeader, Section, StatusBadge, Stat } from "@/components/shared";
import { ConfirmButton } from "@/components/confirm-button";
import { CampaignForm } from "@/components/ads/campaign-form";
import { CreativesPanel } from "@/components/ads/creatives-panel";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Campaign" };

function StatTable({ rows, first }: { rows: AdStatRow[]; first: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No impressions yet.</p>;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>{first}</TableHead><TableHead className="text-right">Impressions</TableHead><TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">CTR</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.label}><TableCell>{PLACEMENTS.find((p) => p.key === r.label)?.label ?? r.label}</TableCell><TableCell className="text-right tabular-nums">{Number(r.impressions).toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{Number(r.clicks).toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{ctr(Number(r.impressions), Number(r.clicks))}</TableCell></TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function CampaignPage({ params }: PageProps<"/admin/ads/[id]">) {
  await requireSuperAdmin();
  const id = Number((await params).id);
  const c = await getCampaign(id);
  if (!c) notFound();
  const [creatives, stats] = await Promise.all([listCreatives(id), campaignStats(id)]);
  const status = effectiveStatus(c);
  const imps = Number(c.impressions), clicks = Number(c.clicks);
  const statusButton = (to: "active" | "paused" | "draft", text: string, variant: "default" | "outline" | "ghost" = "outline") => (
    <ConfirmButton action={setCampaignStatus} fields={{ id, status: to }} title={`${text}?`} description={to === "active" ? "The campaign starts showing in its placements within its dates." : "The campaign stops showing immediately; pages render normally without it."} confirmText={text} variant={variant}>{text}</ConfirmButton>
  );
  async function remove(fd: FormData) {
    "use server";
    const r = await deleteCampaign(fd);
    if (r?.ok) redirect("/admin/ads");
    return r;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{c.name} <StatusBadge status={c.organization_id && c.status === "draft" ? "awaiting_approval" : status} /></span>}
        description={<>{c.kind} campaign{c.org_name ? ` · submitted by ${c.org_name}` : ""}{c.event_title ? ` · only on “${c.event_title}”` : ""}</>}
        actions={<>
          {c.status !== "active" ? statusButton("active", c.organization_id ? "Approve & activate" : "Activate", "default") : statusButton("paused", "Pause")}
          {c.status === "paused" ? statusButton("draft", "Back to draft", "ghost") : null}
          <Button variant="outline" nativeButton={false} render={<a href={`/api/exports/ads?id=${id}`} />}><DownloadIcon /> Export</Button>
          <ConfirmButton action={remove} fields={{ id }} title="Delete this campaign?" description="Its creatives and statistics are removed. This cannot be undone." confirmText="Delete" variant="ghost">Delete</ConfirmButton>
        </>}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Impressions" value={imps.toLocaleString()} hint="Counted when at least half the ad was on screen" />
        <Stat label="Clicks" value={clicks.toLocaleString()} />
        <Stat label="CTR" value={ctr(imps, clicks)} />
      </div>
      <Section title="Creatives" description="One is picked at random each time the campaign is shown.">
        <CreativesPanel campaignId={id} creatives={creatives.map((x) => ({ id: Number(x.id), imageUrl: x.imageUrl ?? null, alt_text: x.alt_text, headline: x.headline, body: x.body }))} />
      </Section>
      <Section title="Settings"><CampaignForm values={campaignFormValues(c)} /></Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="By placement"><StatTable rows={stats.byPlacement} first="Placement" /></Section>
        <Section title="By event"><StatTable rows={stats.byEvent} first="Event" /></Section>
      </div>
      <Section title="By day (UTC)"><StatTable rows={stats.byDay} first="Day" /></Section>
    </div>
  );
}
