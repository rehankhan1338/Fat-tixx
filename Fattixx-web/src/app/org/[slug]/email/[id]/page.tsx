import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/authz";
import { cancelCampaign, deleteCampaign, duplicateCampaign, resumeCampaign, sendTestCampaign } from "@/lib/pro/email-actions";
import { campaignLinkStats, campaignStats, getCampaign, previewCampaign } from "@/lib/pro/email-marketing";
import { orgIsPro } from "@/lib/pro/gate";
import { ConfirmButton } from "@/components/confirm-button";
import { PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionButton } from "@/components/pro/action-button";
import { CampaignEditor } from "../email-client";
import { campaignEditorData } from "../editor-data";

export const metadata: Metadata = { title: "Campaign" };

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

export default async function CampaignPage({ params, searchParams }: PageProps<"/org/[slug]/email/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug);
  if (ctx.role === "staff") notFound();
  const c = await getCampaign(ctx.org.id, Number(id));
  if (!c) notFound();
  const pro = orgIsPro(ctx.org);
  const editable = pro && (c.status === "draft" || c.status === "scheduled" || (c.status === "paused" && !c.started_at));
  const [stats, links, preview, editor] = await Promise.all([
    campaignStats([Number(c.id)]).then((m) => m.get(Number(c.id)) ?? null),
    campaignLinkStats(Number(c.id)),
    previewCampaign(ctx.org.id, c, { email: ctx.session.user.email, name: ctx.session.user.name }),
    editable ? campaignEditorData(ctx) : Promise.resolve(null),
  ]);
  const fields = { org: slug, campaign_id: Number(c.id) };
  const saved = typeof sp.saved === "string" ? sp.saved : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{c.name} <StatusBadge status={c.status} /></span>}
        description={c.status === "scheduled" ? `Sends ${formatDate(c.scheduled_at)}.` : c.status === "sent" ? `Sent ${formatDate(c.finished_at)}.` : c.status === "sending" ? "Sending now, in batches." : c.status === "paused" ? `Paused: ${c.paused_reason ?? "stopped"}.` : c.status === "canceled" ? "Stopped. Nobody else will receive it." : "Draft."}
        actions={<>
          <Link href={`/org/${slug}/email`} className="text-sm underline">All campaigns</Link>
          {pro ? <ActionButton action={sendTestCampaign} fields={fields}>Send me a test</ActionButton> : null}
          {pro ? <ActionButton action={duplicateCampaign} fields={fields}>Duplicate</ActionButton> : null}
          {c.status === "paused" && pro ? <ActionButton action={resumeCampaign} fields={fields} variant="default">Resume</ActionButton> : null}
          {c.status === "scheduled" ? <ConfirmButton action={cancelCampaign} fields={fields} title="Unschedule this campaign?" description="It goes back to being a draft." confirmText="Unschedule" variant="outline">Unschedule</ConfirmButton> : null}
          {c.status === "sending" || c.status === "paused" ? <ConfirmButton action={cancelCampaign} fields={fields} title="Stop sending?" description="People who have not received it yet will not get it. This cannot be undone." confirmText="Stop">Stop sending</ConfirmButton> : null}
          {c.status === "draft" ? <ConfirmButton action={deleteCampaign} fields={fields} title="Delete this draft?" confirmText="Delete">Delete</ConfirmButton> : null}
        </>}
      />
      {saved ? <Alert><AlertDescription>{saved}</AlertDescription></Alert> : null}

      {stats && stats.recipients > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Recipients" value={stats.recipients.toLocaleString()} hint={stats.queued ? `${stats.queued.toLocaleString()} still to send` : stats.skipped ? `${stats.skipped} skipped (unsubscribed)` : undefined} />
            <Stat label="Delivered" value={stats.sent.toLocaleString()} hint={stats.failed ? `${stats.failed} failed` : undefined} />
            <Stat label="Opened" value={pct(stats.opened, stats.sent)} hint={`${stats.opened.toLocaleString()} people, ${stats.opens.toLocaleString()} opens. Approximate.`} />
            <Stat label="Clicked" value={pct(stats.clicked, stats.sent)} hint={`${stats.clicked.toLocaleString()} people, ${stats.clicks.toLocaleString()} clicks`} />
            <Stat label="Unsubscribed" value={stats.unsubscribed.toLocaleString()} hint={pct(stats.unsubscribed, stats.sent)} />
          </div>
          {links.length ? (
            <Section title="Clicks per link">
              <Table>
                <TableHeader><TableRow><TableHead>Link</TableHead><TableHead className="text-right">Clicks</TableHead></TableRow></TableHeader>
                <TableBody>
                  {links.map((l) => <TableRow key={l.id}><TableCell className="max-w-[640px] truncate font-mono text-xs">{l.url}</TableCell><TableCell className="text-right tabular-nums">{Number(l.clicks)}</TableCell></TableRow>)}
                </TableBody>
              </Table>
            </Section>
          ) : null}
        </>
      ) : null}

      <div className={editor ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}>
        {editor ? (
          <Section title="Edit">
            <CampaignEditor org={slug} {...editor} campaign={{
              id: Number(c.id), name: c.name, subject: c.subject, preheader: c.preheader ?? "", body: c.body, eventId: c.event_id ? Number(c.event_id) : null,
              segmentId: c.segment_id ? Number(c.segment_id) : null, status: c.status, scheduledIso: c.scheduled_at ? new Date(c.scheduled_at).toISOString() : null, startedAt: !!c.started_at,
            }} />
          </Section>
        ) : null}
        <Section title="Preview" description={`Subject: ${preview.subject}. Links in the preview are not tracked.`}>
          <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="h-[720px] w-full rounded-xl border bg-white" />
        </Section>
      </div>
    </div>
  );
}
