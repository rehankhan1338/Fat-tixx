import type { Metadata } from "next";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { getSettings } from "@/lib/settings";
import { formatCents } from "@/lib/money";
import { payoutMode } from "@/lib/payments/connect";
import { listOwedReferrers } from "@/lib/social/referral-actions";
import { listRewardsForStaff, rewardTotals } from "@/lib/social/referrals";
import { EmptyState, PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FlagActions, MarkPaidButton, ShareForm } from "./referral-client";

export const metadata: Metadata = { title: "Referral payouts" };

/*
 * Referral rewards (Social & Community 11.9). Rewards become payable after each event on the organizer payout schedule.
 * With Stripe Connect they are paid automatically (daily job); with manual payouts Finance pays them here. Flagged
 * rewards (several orders from one network) wait until someone clears or reverses them.
 */
export default async function ReferralsAdminPage() {
  const session = await requirePlatformStaff(["super_admin", "finance", "support"]);
  const isFinance = session.user.roles.some((r) => r === "super_admin" || r === "finance");
  const [totals, flagged, recent, owed, mode, settings] = await Promise.all([
    rewardTotals(), listRewardsForStaff("flagged"), listRewardsForStaff("recent"), isFinance ? listOwedReferrers() : Promise.resolve([]), payoutMode(), getSettings(),
  ]);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Referral payouts" description={mode === "connect" ? "Stripe Connect: rewards are taken back from the organizer’s transfer and sent to the referrer’s Stripe account by the daily job." : "Manual payouts: pay referrers with the details they saved, then mark them paid."} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Waiting for events to end" value={formatCents(totals.pending)} />
        <Stat label="Owed to referrers" value={formatCents(totals.payable)} />
        <Stat label="Paid to referrers" value={formatCents(totals.paid)} />
        <Stat label="Fattixx share kept" value={formatCents(totals.platform)} />
      </div>
      {session.user.roles.includes("super_admin") ? (
        <Section title="Fattixx share of each reward" description="Taken from each reward before it is paid (Posh keeps 20%). Applies to new rewards.">
          <ShareForm percent={Number(settings.referral_platform_share_bps) / 100} />
        </Section>
      ) : null}
      <Section title={`Flagged for review (${flagged.length})`} description="Several referred orders from the same network. Held until cleared; reverse them if they look arranged.">
        {flagged.length === 0 ? <p className="text-sm text-muted-foreground">Nothing flagged.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Referrer</TableHead><TableHead>Order</TableHead><TableHead>Event</TableHead><TableHead>Why</TableHead><TableHead className="text-right">Reward</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{flagged.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm">{r.referrer_name}<div className="text-xs text-muted-foreground">{r.referrer_email}</div></TableCell>
                <TableCell className="font-mono text-xs">{r.order_code}<div className="text-muted-foreground">{r.buyer_email} · {r.ip}</div></TableCell>
                <TableCell className="text-sm">{r.event_title}<div className="text-xs text-muted-foreground">{r.org_name}</div></TableCell>
                <TableCell className="text-sm">{r.flag_reason}</TableCell>
                <TableCell className="text-right font-mono">{formatCents(Number(r.amount_cents), r.currency)}</TableCell>
                <TableCell className="text-right"><FlagActions id={Number(r.id)} /></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </Section>
      {isFinance && mode !== "connect" ? (
        <Section title="Owed to referrers" description="Rewards for events that are over, minus Fattixx’s share. Pay with the details shown, then record the reference.">
          {owed.length === 0 ? <EmptyState title="Nothing owed" description="Rewards appear here once their event is over." /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Referrer</TableHead><TableHead>Pay with</TableHead><TableHead className="text-right">Owed</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{owed.map((o) => (
                <TableRow key={o.userId}>
                  <TableCell className="text-sm">{o.name}<div className="text-xs text-muted-foreground">{o.email}</div></TableCell>
                  <TableCell className="text-sm">{o.method ?? <Badge variant="outline">No payout details yet</Badge>}</TableCell>
                  <TableCell className="text-right font-mono">{formatCents(o.owed, o.currency)}</TableCell>
                  <TableCell className="text-right">{o.method ? <MarkPaidButton userId={o.userId} amount={formatCents(o.owed, o.currency)} /> : null}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </Section>
      ) : null}
      <Section title="Recent rewards">
        {recent.length === 0 ? <p className="text-sm text-muted-foreground">No referral rewards yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Created</TableHead><TableHead>Referrer</TableHead><TableHead>Order</TableHead><TableHead>Event</TableHead><TableHead className="text-right">Reward</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>{recent.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm">{formatDate(r.created_at)}</TableCell>
                <TableCell className="text-sm">{r.referrer_name}</TableCell>
                <TableCell className="font-mono text-xs">{r.order_code}</TableCell>
                <TableCell className="text-sm">{r.event_title}</TableCell>
                <TableCell className="text-right font-mono">{formatCents(Number(r.amount_cents), r.currency)}{Number(r.platform_cents) ? <div className="text-xs text-muted-foreground">Fattixx {formatCents(Number(r.platform_cents), r.currency)}</div> : null}</TableCell>
                <TableCell><StatusBadge status={r.status} />{Number(r.flagged) ? <Badge variant="destructive" className="ml-1">flagged</Badge> : null}{r.payout_reference ? <div className="text-xs text-muted-foreground">{r.payout_reference}</div> : null}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
