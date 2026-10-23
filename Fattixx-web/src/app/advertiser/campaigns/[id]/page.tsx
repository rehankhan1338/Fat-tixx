import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { advertiserCampaignState } from "@/lib/ads/advertisers";
import { deleteCampaign, setCampaignStatus } from "@/lib/ads/actions";
import { campaignFormValues, campaignStats, ctr, getCampaign, listCreatives } from "@/lib/ads/queries";
import { PLACEMENTS } from "@/lib/ads/placements";
import { formatCents } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { categoryNames } from "@/lib/site-content/categories";
import { PageHeader, Section, Stat, StatusBadge } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { CampaignForm } from "@/components/ads/campaign-form";
import { CreativesPanel } from "@/components/ads/creatives-panel";
import { ConfirmButton } from "@/components/confirm-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdvertiser } from "../../guard";
import { BuyImpressionsForm } from "./buy-form";

export const metadata: Metadata = { title: "Campaign", robots: { index: false } };

const STATE_TEXT: Record<string, string> = {
  unpaid: "Not live yet. Add a creative, then buy impressions to submit it for review.",
  in_review: "Paid and waiting for review. Fattixx usually reviews within one business day; you get an email either way.",
  rejected: "Not approved. See the reason below; edit the campaign and contact us to resubmit.",
  refunded: "Not approved and refunded in full.",
  active: "Live. It shows within its dates until the impressions you bought are delivered.",
  paused: "Paused. Resume it to continue delivering the impressions you bought.",
  completed: "Finished: every impression you bought was delivered.",
  expired: "The end date has passed. Impressions not delivered by then are not used.",
  draft: "Approved and waiting to start.",
};

export default async function AdvertiserCampaignPage({ params, searchParams }: PageProps<"/advertiser/campaigns/[id]">) {
  const { advertiser } = await requireAdvertiser();
  const id = Number((await params).id);
  const sp = await searchParams;
  const c = await getCampaign(id);
  if (!c || Number(c.advertiser_id) !== Number(advertiser.id)) notFound();
  const [creatives, stats, categories, settings] = await Promise.all([listCreatives(id), campaignStats(id), categoryNames(), getSettings()]);
  const state = advertiserCampaignState({ status: c.status, payment_status: c.payment_status, review_status: c.review_status, impressions_cap: c.impressions_cap, impressions_served: Number(c.impressions_served), ends_at: c.ends_at });
  const fields = { id, advertiser: 1 };
  async function remove(fd: FormData) {
    "use server";
    const r = await deleteCampaign(fd);
    if (r?.ok) redirect("/advertiser");
    return r;
  }
  return (
    <PublicShell wide>
      <p className="text-sm"><Link href="/advertiser" className="hover:underline">← All campaigns</Link></p>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{c.name} <StatusBadge status={state} /></span>}
        description={STATE_TEXT[state] ?? ""}
        actions={<>
          {state === "active" ? <ConfirmButton action={setCampaignStatus} fields={{ ...fields, status: "paused" }} title="Pause this campaign?" description="It stops showing at once. You can resume it later." confirmText="Pause">Pause</ConfirmButton> : null}
          {state === "paused" && c.review_status === "approved" ? <ConfirmButton action={setCampaignStatus} fields={{ ...fields, status: "active" }} title="Resume this campaign?" description="It starts showing again within its dates." confirmText="Resume" variant="default">Resume</ConfirmButton> : null}
          {state === "unpaid" ? <ConfirmButton action={remove} fields={fields} title="Delete this campaign?" description="It has not been paid for; nothing is charged." confirmText="Delete" variant="ghost">Delete</ConfirmButton> : null}
        </>}
      />
      {sp.paid ? <p className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">Thank you. Your payment went through and the campaign is submitted for review (it can take a moment for the status to update).</p> : null}
      {c.review_notes ? <p className="mt-4 rounded-lg border border-red-500/40 p-3 text-sm">Reviewer’s note: {c.review_notes}</p> : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Delivered" value={Number(c.impressions_served).toLocaleString()} hint={c.impressions_cap ? `of ${Number(c.impressions_cap).toLocaleString()} bought` : "none bought yet"} />
        <Stat label="Clicks" value={Number(c.clicks).toLocaleString()} />
        <Stat label="CTR" value={ctr(Number(c.impressions), Number(c.clicks))} />
        <Stat label="Paid" value={c.price_cents && c.payment_status !== "unpaid" ? formatCents(Number(c.price_cents)) : "—"} hint={c.payment_status ?? undefined} />
      </div>

      <div className="mt-6 space-y-6">
        {state === "unpaid" ? (
          <Section title="Buy impressions" description="You pay once, by card, through Stripe. If we do not approve the campaign, you get a full refund.">
            <BuyImpressionsForm campaignId={id} cpmCents={Number(settings.ad_cpm_cents)} min={Number(settings.ad_min_impressions)} ready={creatives.length > 0} />
          </Section>
        ) : null}
        <Section title="Creatives" description="An image (JPG, PNG or WebP; it is resized for you) and/or a headline. Changing a paid campaign sends it back for review.">
          <CreativesPanel campaignId={id} creatives={creatives.map((x) => ({ id: Number(x.id), imageUrl: x.imageUrl ?? null, alt_text: x.alt_text, headline: x.headline, body: x.body }))} advertiser />
        </Section>
        <Section title="Settings">
          <CampaignForm advertiser values={campaignFormValues(c)} categories={categories} />
        </Section>
        {stats.byPlacement.length ? (
          <Section title="Performance by placement">
            <Table>
              <TableHeader><TableRow><TableHead>Placement</TableHead><TableHead className="text-right">Impressions</TableHead><TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">CTR</TableHead></TableRow></TableHeader>
              <TableBody>{stats.byPlacement.map((r) => (
                <TableRow key={r.label}><TableCell>{PLACEMENTS.find((p) => p.key === r.label)?.label ?? r.label}</TableCell><TableCell className="text-right tabular-nums">{Number(r.impressions).toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{Number(r.clicks).toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{ctr(Number(r.impressions), Number(r.clicks))}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          </Section>
        ) : null}
        {stats.byDay.length ? (
          <Section title="By day (UTC)">
            <Table>
              <TableHeader><TableRow><TableHead>Day</TableHead><TableHead className="text-right">Impressions</TableHead><TableHead className="text-right">Clicks</TableHead></TableRow></TableHeader>
              <TableBody>{stats.byDay.map((r) => (
                <TableRow key={r.label}><TableCell>{r.label}</TableCell><TableCell className="text-right tabular-nums">{Number(r.impressions).toLocaleString()}</TableCell><TableCell className="text-right tabular-nums">{Number(r.clicks).toLocaleString()}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          </Section>
        ) : null}
      </div>
    </PublicShell>
  );
}
