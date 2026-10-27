import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/authz";
import { query, type Row } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { PRO_FEATURES, PRO_MONTHLY_CENTS, PRO_YEARLY_CENTS, PRO_YEARLY_MONTHLY_CENTS, PRO_YEARLY_SAVINGS_CENTS } from "@/lib/home/pro";
import { isStripeConfigured } from "@/lib/payments/stripe";
import { cancelPro, resumePro, switchProInterval } from "@/lib/pro/actions";
import { canSubscribe, PRO_END_RULES, type ProState } from "@/lib/pro/status";
import { orgProState, syncCheckoutSession } from "@/lib/pro/subscription";
import { ConfirmButton } from "@/components/confirm-button";
import { PageHeader, Section, StatusBadge, formatDate } from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { proNav, SubNav } from "@/components/pro/dashboard";
import { SubscribeForm, UpdateCardButton } from "./pro-client";

export const metadata: Metadata = { title: "Fattixx Pro" };

const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-US", { dateStyle: "long" }) : "—");

/** Where each Pro feature is set up. */
const SETUP: Partial<Record<string, (slug: string) => string>> = {
  brand: (s) => `/org/${s}/pro/branding`, header: (s) => `/org/${s}/pro/branding`, domain: (s) => `/org/${s}/pro/domain`,
  reports: (s) => `/org/${s}/reports`, email: (s) => `/org/${s}/email`, promoters: (s) => `/org/${s}/marketing`, tracking: (s) => `/org/${s}/marketing`, support: (s) => `/org/${s}/support`,
};

function describe(state: ProState): { title: string; text: string; tone: "ok" | "warn" | "off" } {
  switch (state.kind) {
    case "active": return { title: "You are on Fattixx Pro", text: `Billed ${state.interval === "year" ? "yearly" : "monthly"}. Next renewal on ${day(state.renews)}.`, tone: "ok" };
    case "canceling": return { title: "Pro is cancelled", text: `Pro stays on until ${day(state.until)}. Resume before then to keep it.`, tone: "warn" };
    case "grace": return { title: "Your last payment failed", text: `Pro stays on until ${day(state.until)}. Update your card to keep it.`, tone: "warn" };
    case "lapsed": return { title: "Pro is off: payment failed", text: "Update your card to pay the open invoice and switch Pro back on.", tone: "off" };
    case "comp": return { title: "Complimentary Pro", text: `Fattixx has given you Pro until ${day(state.until)}. You can subscribe at any time to keep it after that.`, tone: "ok" };
    case "pending": return { title: "Checkout not finished", text: "The subscription starts once the payment goes through. Start again below if you closed the page.", tone: "off" };
    case "ended": return { title: "Pro has ended", text: `Your settings, contacts and campaigns are kept. Subscribe again to switch everything back on.${state.at ? ` Ended ${day(state.at)}.` : ""}`, tone: "off" };
    default: return { title: "You are on the standard plan", text: "Create, sell and scan for free. Pro adds your brand and the tools to grow.", tone: "off" };
  }
}

export default async function ProPage({ params, searchParams }: PageProps<"/org/[slug]/pro">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireOrg(slug, "org_admin");
  let notice: string | null = null;
  if (sp.checkout === "success" && typeof sp.session_id === "string") {
    let active = false;
    try { active = await syncCheckoutSession(ctx.org.id, sp.session_id); } catch (e) { console.error("[pro] checkout sync failed", e); }
    notice = active ? "Thanks! Your subscription is active." : "Payment received. Your plan updates in a moment.";
  } else if (sp.checkout === "cancelled") notice = "Checkout was cancelled. Nothing was charged.";
  else if (sp.card === "updated") notice = "Card updated.";

  const [{ state, sub, grace }, invoices, stripeReady] = await Promise.all([
    orgProState(ctx.org),
    query<Row & { id: number; number: string | null; status: string; amount_due_cents: number; amount_paid_cents: number; currency: string; period_start: Date | null; period_end: Date | null; hosted_url: string | null; pdf_url: string | null; created_at: Date }>(
      `SELECT * FROM org_invoices WHERE organization_id = ? ORDER BY created_at DESC LIMIT 24`, [ctx.org.id]),
    isStripeConfigured(),
  ]);
  const d = describe(state);
  const managed = !!sub?.stripe_subscription_id && ["active", "trialing", "past_due"].includes(sub.status);
  const other = sub?.billing_interval === "year" ? "month" : "year";
  const fields = { org: slug };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Fattixx Pro" description="Your brand, your web address, email marketing, advanced reports and priority support." />
      <SubNav items={proNav(slug)} current={`/org/${slug}/pro`} />
      {notice ? <Alert><AlertDescription>{notice}</AlertDescription></Alert> : null}

      <Section title={d.title} description={d.text} className={d.tone === "warn" ? "border-amber-500/50" : d.tone === "off" && state.kind === "lapsed" ? "border-destructive/50" : ""}>
        {managed ? (
          <div className="flex flex-wrap gap-2">
            {state.kind === "canceling" ? (
              <ConfirmButton action={resumePro} fields={fields} title="Resume Fattixx Pro?" description="Your subscription continues and renews as before." confirmText="Resume" variant="default" size="default">Resume Pro</ConfirmButton>
            ) : null}
            {state.kind !== "canceling" && state.kind !== "lapsed" ? (
              <ConfirmButton action={switchProInterval} fields={{ ...fields, interval: other }} variant="outline" size="default" confirmText="Switch"
                title={`Switch to ${other === "year" ? "yearly" : "monthly"} billing?`}
                description={other === "year"
                  ? `You pay ${formatCents(PRO_YEARLY_CENTS)} a year (${formatCents(PRO_YEARLY_MONTHLY_CENTS)} a month) and save ${formatCents(PRO_YEARLY_SAVINGS_CENTS)}. The unused part of this month is credited.`
                  : `You pay ${formatCents(PRO_MONTHLY_CENTS)} a month. The unused part of your year is credited to future invoices.`}>
                Switch to {other === "year" ? "yearly" : "monthly"}
              </ConfirmButton>
            ) : null}
            <UpdateCardButton org={slug} />
            {state.kind === "active" || state.kind === "grace" ? (
              <ConfirmButton action={cancelPro} fields={fields} size="default" confirmText="Cancel Pro" title="Cancel Fattixx Pro?"
                description={<span className="block space-y-2"><span className="block">Pro stays on until the end of the period you paid for. Then:</span>{PRO_END_RULES.map((r) => <span key={r.feature} className="block text-xs"><b>{r.feature}:</b> {r.rule}</span>)}</span>}>
                Cancel Pro
              </ConfirmButton>
            ) : null}
          </div>
        ) : canSubscribe(state) ? (
          stripeReady ? <SubscribeForm org={slug} /> : <p className="text-sm text-muted-foreground">Payments are not set up on Fattixx yet. Please contact support to start Pro.</p>
        ) : null}
        {state.kind === "grace" || state.kind === "lapsed" ? <p className="mt-3 text-xs text-muted-foreground">After a failed payment, Pro stays on for {grace} days. Stripe retries the card automatically during that time.</p> : null}
      </Section>

      <Section title="What Pro includes" description="Set each feature up from here.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {PRO_FEATURES.map((f) => {
            const href = SETUP[f.key]?.(slug);
            return (
              <li key={f.key} className="rounded-2xl border border-fx-red/10 bg-white p-4">
                <p className="font-semibold">{href ? <Link href={href} className="hover:underline">{f.title}</Link> : f.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="When Pro ends" description="Cancelled, or a payment still failing after the grace period. Nothing is deleted.">
        <dl className="grid gap-3 text-sm">
          {PRO_END_RULES.map((r) => (
            <div key={r.feature} className="grid gap-1 sm:grid-cols-[220px_1fr]">
              <dt className="font-semibold">{r.feature}</dt>
              <dd className="text-muted-foreground">{r.rule}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Billing history">
        {invoices.length === 0 ? <p className="text-sm text-muted-foreground">No invoices yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Invoice</TableHead><TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {invoices.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{formatDate(i.created_at)}</TableCell>
                  <TableCell className="font-mono text-xs">{i.number ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{i.period_start ? `${day(i.period_start)} – ${day(i.period_end)}` : "—"}</TableCell>
                  <TableCell><StatusBadge status={i.status === "uncollectible" ? "failed" : i.status === "open" ? "pending" : i.status} /></TableCell>
                  <TableCell className="text-right font-mono">{formatCents(Number(i.status === "paid" ? i.amount_paid_cents : i.amount_due_cents), i.currency)}</TableCell>
                  <TableCell className="text-right">
                    {i.hosted_url ? <a href={i.hosted_url} target="_blank" rel="noopener noreferrer" className="text-sm underline">{i.status === "open" ? "Pay" : "View"}</a> : null}
                    {i.pdf_url ? <> · <a href={i.pdf_url} target="_blank" rel="noopener noreferrer" className="text-sm underline">PDF</a></> : null}
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
