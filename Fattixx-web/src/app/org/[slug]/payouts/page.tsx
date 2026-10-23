import type { Metadata } from "next";
import { requireOrg } from "@/lib/authz";
import { query, type Row } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { getActiveStripe } from "@/lib/payments/stripe";
import { connectMoney, connectState, getConnectAccount, parseDue, payoutMode, syncConnectAccount, type ConnectState } from "@/lib/payments/connect";
import { openStripeDashboard, refreshPayoutStatus, startPayoutSetup } from "@/lib/payments/connect-actions";
import { EmptyState, PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { ActionButton } from "@/components/pro/action-button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Payouts" };

const STATE: Record<ConnectState, { label: string; text: string; tone: string }> = {
  not_started: { label: "Not set up", text: "Connect a bank account through Stripe to be paid automatically after each sale.", tone: "border-amber-500/40 text-amber-700" },
  incomplete: { label: "Setup not finished", text: "Stripe still needs some details from you. Continue where you left off.", tone: "border-amber-500/40 text-amber-700" },
  pending: { label: "Stripe is verifying", text: "Your details are with Stripe. This usually takes a few minutes, sometimes a business day.", tone: "border-sky-500/40 text-sky-700" },
  restricted: { label: "Action needed", text: "Stripe needs more information before it can pay you. Until then, sales are paid out by hand as before.", tone: "border-red-500/40 text-red-700" },
  active: { label: "Automatic payouts on", text: "Your share of every sale goes to your Stripe account with the payment; Stripe pays it out to your bank.", tone: "border-emerald-500/40 text-emerald-700" },
};

/** Organization Admin: how this organization is paid. Stripe Connect when the platform has it on (src/lib/payments/connect.ts). */
export default async function PayoutsPage({ params, searchParams }: PageProps<"/org/[slug]/payouts">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug, "org_admin");
  const [mode, active] = await Promise.all([payoutMode(), getActiveStripe()]);
  // Back from Stripe's onboarding (or opening the page): read the account's current state.
  const acct = active ? (sp.stripe ? await syncConnectAccount(ctx.org.id) : await getConnectAccount(ctx.org.id, active.mode)) : null;
  const state = connectState(acct);
  const money = acct && state !== "not_started" && state !== "incomplete" ? await connectMoney(acct.account_id) : null;
  const manual = await query<Row & { id: number; amount_cents: number; currency: string; status: string; method: string | null; reference: string | null; paid_at: Date | null; approved_at: Date; event_title: string | null }>(
    `SELECT p.id, p.amount_cents, p.currency, p.status, p.method, p.reference, p.paid_at, p.approved_at, e.title AS event_title
       FROM payouts p LEFT JOIN events e ON e.id = p.event_id WHERE p.organization_id = ? AND p.status <> 'void' ORDER BY p.id DESC LIMIT 50`, [ctx.org.id],
  );
  const due = parseDue(acct?.requirements_due ?? null);
  const fields = { org: slug };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Payouts" description="How and when your ticket revenue reaches your bank account." />

      {mode === "connect" && active ? (
        <Section
          title={<span className="flex flex-wrap items-center gap-3">Automatic payouts with Stripe <Badge variant="outline" className={STATE[state].tone}>{STATE[state].label}</Badge></span>}
          description={STATE[state].text}
          actions={<>
            {state !== "active" ? <ActionButton action={startPayoutSetup} fields={fields} variant="default" size="default">{state === "not_started" ? "Set up payouts" : "Continue with Stripe"}</ActionButton> : null}
            {acct && state !== "not_started" ? <ActionButton action={openStripeDashboard} fields={fields} size="default">Open Stripe dashboard</ActionButton> : null}
            {acct ? <ActionButton action={refreshPayoutStatus} fields={fields} variant="ghost" size="default">Refresh</ActionButton> : null}
          </>}
        >
          <div className="space-y-4 text-sm">
            {sp.stripe === "refresh" ? <p className="rounded-lg border border-amber-500/40 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">The Stripe link expired. Press “Continue with Stripe” to pick up where you left off.</p> : null}
            {due.length ? <p className="text-muted-foreground">Stripe is waiting for: {due.slice(0, 6).map((d) => d.replace(/[._]/g, " ")).join(", ")}{due.length > 6 ? ", …" : ""}.</p> : null}
            {money ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Stat label="Available in Stripe" value={formatCents(money.balance.availableCents, money.balance.currency)} hint="paid out on Stripe's schedule" />
                <Stat label="On its way" value={formatCents(money.balance.pendingCents, money.balance.currency)} hint="recent sales, not yet available" />
              </div>
            ) : null}
            {money?.payouts.length ? (
              <Table>
                <TableHeader><TableRow><TableHead>Arrives</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>{money.payouts.map((p) => (
                  <TableRow key={p.id}><TableCell>{formatDate(p.arrivalDate)}</TableCell><TableCell><StatusBadge status={p.status} /></TableCell><TableCell className="text-right font-mono">{formatCents(p.amountCents, p.currency)}</TableCell></TableRow>
                ))}</TableBody>
              </Table>
            ) : null}
            <p className="text-xs text-muted-foreground">Stripe checks your identity and bank details; Fattixx never sees your bank account number. Refunds are taken back from your Stripe balance in proportion. Fees and tax stay with Fattixx, as on your settlement statement.</p>
          </div>
        </Section>
      ) : (
        <Section title="Payouts by Fattixx" description="After each event Fattixx reviews the settlement statement and sends your payout. Automatic payouts through Stripe are coming; this page will let you set them up when they are switched on." >
          <p className="text-sm text-muted-foreground">Questions about a payout? Use Help in the menu.</p>
        </Section>
      )}

      <Section title="Payouts sent by Fattixx" description="Manual payouts for events settled by hand (all events before automatic payouts, and any sale made while your Stripe setup was unfinished).">
        {manual.length === 0 ? <EmptyState title="No manual payouts yet" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Approved</TableHead><TableHead>Event</TableHead><TableHead>Status</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>{manual.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{formatDate(p.approved_at)}</TableCell>
                <TableCell>{p.event_title ?? "—"}</TableCell>
                <TableCell><StatusBadge status={p.status} />{p.paid_at ? <span className="ml-2 text-xs text-muted-foreground">{formatDate(p.paid_at)}</span> : null}</TableCell>
                <TableCell className="text-xs">{[p.method, p.reference].filter(Boolean).join(" · ") || "—"}</TableCell>
                <TableCell className="text-right font-mono">{formatCents(Number(p.amount_cents), p.currency)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
