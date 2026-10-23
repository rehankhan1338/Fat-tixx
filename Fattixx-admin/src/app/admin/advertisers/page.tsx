import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth/guard";
import { listAdvertisers } from "@/lib/ads/advertisers";
import { formatCents } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { EmptyState, PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReviewAdvertiserForm } from "./review-form";

export const metadata: Metadata = { title: "Advertisers" };

/** Self-service advertisers (lib/ads/advertisers.ts): applications to review and approved accounts. Their campaigns are under Ads. */
export default async function AdvertisersPage() {
  await requireSuperAdmin();
  const [rows, s] = await Promise.all([listAdvertisers(), getSettings()]);
  const pending = rows.filter((r) => r.status === "pending");
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Advertisers" description={`Brands that buy ads themselves at /advertise. Price ${formatCents(Number(s.ad_cpm_cents))} per 1,000 impressions, at least ${Number(s.ad_min_impressions).toLocaleString()} (Payments → Payouts & marketplace). Their paid campaigns wait for review under Ads.`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Waiting for review" value={pending.length} />
        <Stat label="Approved" value={rows.filter((r) => r.status === "approved").length} />
        <Stat label="Paid campaigns, all time" value={formatCents(rows.reduce((n, r) => n + Number(r.spent_cents), 0))} />
      </div>
      <Section title="All advertisers">
        {rows.length === 0 ? <EmptyState title="No advertisers yet" description="Applications from /advertise appear here." /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Contact</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Campaigns · paid</TableHead><TableHead>Review</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><span className="font-medium">{r.company_name}</span>{r.website ? <a href={r.website} target="_blank" rel="noreferrer" className="block text-xs text-muted-foreground hover:underline">{r.website}</a> : null}<span className="block text-xs text-muted-foreground">Applied {formatDate(r.created_at)}</span></TableCell>
                  <TableCell className="text-xs">{r.contact_name}<span className="block text-muted-foreground">{r.contact_email}</span></TableCell>
                  <TableCell><StatusBadge status={r.status} />{r.review_notes ? <span className="block max-w-48 text-xs text-muted-foreground">{r.review_notes}</span> : null}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(r.campaigns)} · {formatCents(Number(r.spent_cents))}</TableCell>
                  <TableCell className="min-w-96"><ReviewAdvertiserForm id={Number(r.id)} status={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
