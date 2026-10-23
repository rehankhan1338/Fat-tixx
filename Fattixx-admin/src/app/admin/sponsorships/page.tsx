import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { listAllDeals, organizerDealCents } from "@/lib/sponsorships/deals";
import { approveSponsorshipPayout, refundDeal } from "@/lib/sponsorships/actions";
import { formatCents } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { EmptyState, PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { ConfirmButton } from "@/components/confirm-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Sponsorships" };

/** Sponsorship marketplace (lib/sponsorships/deals.ts): every deal, Fattixx's fee, and payouts for deals paid without Stripe Connect. */
export default async function SponsorshipsAdminPage() {
  await requirePlatformStaff(["super_admin", "finance"]);
  const [deals, s] = await Promise.all([listAllDeals(), getSettings()]);
  const paid = deals.filter((d) => d.status === "paid");
  const owed = paid.filter((d) => !d.connect_account_id && !d.payout_status);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Sponsorships" description={`Deals from the sponsorship marketplace (/sponsorships). Fattixx keeps ${(Number(s.sponsorship_fee_bps) / 100).toFixed(1)}% (Payments → Payouts & marketplace). With Stripe Connect the organizer's share is paid with the sponsor's payment; otherwise approve a payout here and send it from Payouts.`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Paid deals" value={paid.length} hint={formatCents(paid.reduce((n, d) => n + Number(d.amount_cents), 0))} />
        <Stat label="Fattixx fees" value={formatCents(paid.reduce((n, d) => n + Number(d.fee_cents), 0))} />
        <Stat label="Payouts to approve" value={owed.length} hint={formatCents(owed.reduce((n, d) => n + organizerDealCents(d), 0))} />
      </div>
      <Section title="All deals">
        {deals.length === 0 ? <EmptyState title="No sponsorship deals yet" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Sponsor → organizer</TableHead><TableHead>Package</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount · fee</TableHead><TableHead>Organizer share</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {deals.map((d) => (
                <TableRow key={d.id}>
                  <TableCell><span className="font-medium">{d.sponsor_name}</span> → <Link href={`/admin/organizations/${d.org_slug}`} className="hover:underline">{d.org_name}</Link><span className="block text-xs text-muted-foreground">{d.contact_email} · {formatDate(d.created_at)}</span></TableCell>
                  <TableCell className="text-xs">{d.package_title}{d.event_title ? <span className="block text-muted-foreground">{d.event_title}</span> : null}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{formatCents(Number(d.amount_cents), d.currency)}<span className="block text-xs text-muted-foreground">{formatCents(Number(d.fee_cents), d.currency)}</span></TableCell>
                  <TableCell className="text-xs">{d.status === "paid" ? <>{formatCents(organizerDealCents(d), d.currency)} · {d.connect_account_id ? "Stripe Connect" : d.payout_status ? `payout ${d.payout_status}` : "manual, not approved"}</> : "—"}</TableCell>
                  <TableCell className="space-x-2 text-right whitespace-nowrap">
                    {d.status === "paid" && !d.connect_account_id && !d.payout_status ? <ConfirmButton action={approveSponsorshipPayout} fields={{ id: d.id }} title="Approve this payout?" description={`${formatCents(organizerDealCents(d), d.currency)} to ${d.org_name}. Send it, then mark it paid under Payouts.`} confirmText="Approve" variant="default" size="sm">Approve payout</ConfirmButton> : null}
                    {d.status === "paid" && d.payout_status !== "paid" ? <ConfirmButton action={refundDeal} fields={{ id: d.id }} title="Refund this sponsorship?" description="The sponsor is refunded in full; with Stripe Connect the organizer's share is taken back; an approved manual payout is voided and the sponsor ad paused." confirmText="Refund" variant="ghost" size="sm">Refund</ConfirmButton> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
