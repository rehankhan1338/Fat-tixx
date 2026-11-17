import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { env } from "@/lib/env";
import { queryOne, type Row } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { payoutMode } from "@/lib/payments/connect";
import { referrerDashboard, rewardLabel, syncReferrerAccounts } from "@/lib/social/referrals";
import { formatEventDate } from "@/lib/tz";
import { CopyButton } from "@/components/copy-button";
import { EmptyState, PageHeader, Section, Stat } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountNav } from "../account-nav";
import { ManualPayoutForm, StripePayoutButton } from "./payout-forms";

export const metadata: Metadata = { title: "Referral rewards", robots: { index: false } };

/* The referrer's dashboard (11.9): personal links, clicks, tickets sold, earnings and payout status. */
export default async function ReferralsPage({ searchParams }: PageProps<"/account/referrals">) {
  const session = await requireSession();
  const sp = await searchParams;
  if (sp.stripe === "return") await syncReferrerAccounts();
  const [rows, mode, acct] = await Promise.all([
    referrerDashboard(session.user.id), payoutMode(),
    queryOne<Row & { account_id: string | null; transfers_active: number; manual_details: string | null }>(`SELECT account_id, transfers_active, manual_details FROM referrer_payout_accounts WHERE user_id = ?`, [session.user.id]),
  ]);
  const sum = (k: "earned" | "pending" | "payable" | "paid") => rows.reduce((n, r) => n + Number(r[k]), 0);
  const currency = rows[0]?.currency ?? "USD";
  const payoutReady = mode === "connect" ? !!Number(acct?.transfers_active) : !!acct?.manual_details;
  return (
    <PublicShell wide>
      <PageHeader title="Referral rewards" description="Earn when tickets sell through your personal link. Rewards are paid after each event ends, on the same schedule as organizer payouts." />
      <AccountNav active="referrals" />
      {rows.length === 0 ? (
        <div className="mt-6"><EmptyState title="No referral links yet" description="When an event you have tickets for offers referral rewards, you can get your link on its event page. Organizers can also invite you." action={<Link href="/events" className="text-sm font-medium underline">Browse events</Link>} /></div>
      ) : (
        <div className="mt-6 space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Earned" value={formatCents(sum("earned"), currency)} hint="Not counting refunded sales" />
            <Stat label="Waiting for the event" value={formatCents(sum("pending"), currency)} hint="Payable once the event is over" />
            <Stat label="Ready to pay" value={formatCents(sum("payable"), currency)} hint={payoutReady ? "Paid on the next payout run" : "Set up payout details below"} />
            <Stat label="Paid" value={formatCents(sum("paid"), currency)} />
          </div>
          <Section title="Payout details" description="Like organizers, referrers are paid inside Fattixx. Earnings wait until this is set up.">
            {mode === "connect" ? (
              <div className="flex flex-wrap items-center gap-3">
                {payoutReady ? <Badge>Ready to receive payouts</Badge> : acct?.account_id ? <Badge variant="outline">Setup not finished</Badge> : null}
                <StripePayoutButton label={payoutReady ? "Update payout details" : acct?.account_id ? "Finish setup with Stripe" : "Set up payouts with Stripe"} />
              </div>
            ) : (
              <ManualPayoutForm saved={!!acct?.manual_details} />
            )}
          </Section>
          <Section title="Your links">
            <Table>
              <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Reward</TableHead><TableHead>Link</TableHead><TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Earned</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const url = r.code ? `${env.APP_URL}/r/${r.code}` : null;
                  const status = r.status === "removed" ? "Removed" : Number(r.paid) > 0 && !Number(r.payable) && !Number(r.pending) ? "Paid" : Number(r.payable) > 0 ? "Ready to pay" : Number(r.pending) > 0 ? "Event not over" : "—";
                  return (
                    <TableRow key={r.referrer_id}>
                      <TableCell><Link href={`/events/${r.event_slug}`} className="font-medium hover:underline">{r.event_title}</Link><div className="text-xs text-muted-foreground">{formatEventDate(new Date(r.starts_at), "UTC", { withTime: false })}{r.kind === "invite" ? " · invited" : ""}</div></TableCell>
                      <TableCell className="text-sm">{rewardLabel(r, r.currency)}</TableCell>
                      <TableCell>{url ? <div className="flex items-center gap-2"><code className="max-w-[220px] truncate text-xs">{url}</code><CopyButton value={url} label="Copy" /></div> : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(r.clicks)}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(r.tickets)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCents(Number(r.earned), r.currency)}</TableCell>
                      <TableCell className="text-sm">{status}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">No reward for buying through your own link. When you promote an event, say that you earn a reward (<Link href="/referral-terms" className="underline">Referral Rewards Terms</Link>).</p>
          </Section>
        </div>
      )}
    </PublicShell>
  );
}
