import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff, hasPlatformRole } from "@/lib/auth/guard";
import { countPayments, listPayments, listReconciliations, paymentsSummary } from "@/lib/admin/finance-queries";
import { getStripeSettings, maskKey } from "@/lib/settings";
import { checkWebhookEndpoint } from "@/lib/payments/stripe";
import { env } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { DEFAULT_PER_PAGE, parsePagination } from "@/lib/pagination";
import { PageHeader, Section, Stat, StatusBadge, formatDate, EmptyState } from "@/components/shared";
import { TablePagination } from "@/components/table-pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StripeSettingsPanel, ReconcileForm } from "./payments-client";

export const metadata: Metadata = { title: "Payments & Stripe" };

export default async function PaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  const session = await requirePlatformStaff(["super_admin", "finance"]);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const isSuper = hasPlatformRole(session, "super_admin");
  const { page, perPage, offset } = parsePagination(sp);
  const [summary, payments, paymentTotal, recon, stripe] = await Promise.all([paymentsSummary(), listPayments(q, perPage, offset), countPayments(q), listReconciliations(), getStripeSettings()]);
  const active = stripe[stripe.mode];
  const configured = !!(active.secretKey && active.publishableKey);
  const webhookUrl = `${env.APP_URL}/api/stripe/webhook`;
  const webhook = configured && sp.tab === "stripe"
    ? await checkWebhookEndpoint({ mode: stripe.mode, secretKey: active.secretKey!, publishableKey: active.publishableKey!, webhookSecret: active.webhookSecret }, webhookUrl)
    : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-3">Payments & Stripe {configured ? <Badge variant="outline" className={stripe.mode === "live" ? "border-red-500/40 text-red-700" : "border-emerald-500/40 text-emerald-700"}>{stripe.mode === "live" ? "LIVE MODE" : "TEST MODE"}</Badge> : <Badge variant="outline" className="border-amber-500/40 text-amber-700">Not connected</Badge>}</span>}
        description="Card payments, Stripe keys with a sandbox/live switch, and daily reconciliation between Stripe and Fattixx orders."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Card payments" value={summary.paid} hint="paid orders with a charge" />
        <Stat label="Gross charged" value={formatCents(summary.gross)} hint={`${formatCents(summary.refunded)} refunded`} />
        <Stat label="Platform fees earned" value={formatCents(summary.fees)} />
        <Stat label="Open disputes" value={summary.disputesOpen} hint={summary.disputesOpen ? `${formatCents(summary.disputedCents)} at risk` : "none"} />
      </div>

      <Tabs defaultValue={sp.tab === "stripe" ? "stripe" : sp.tab === "reconcile" ? "reconcile" : "payments"}>
        <TabsList><TabsTrigger value="payments">Payments</TabsTrigger><TabsTrigger value="reconcile">Reconciliation</TabsTrigger><TabsTrigger value="stripe">Stripe keys</TabsTrigger></TabsList>

        <TabsContent value="payments" className="pt-4">
          <Card><CardContent className="space-y-4 pt-6">
            <form className="flex gap-2" action="/admin/payments">
              <Input name="q" defaultValue={q} placeholder="Order number, buyer email or Stripe payment id" className="max-w-md" />
              {perPage !== DEFAULT_PER_PAGE ? <input type="hidden" name="per" value={perPage} /> : null}
              <Button type="submit" variant="secondary">Search</Button>
            </form>
            {payments.length === 0 ? <EmptyState title={q ? "No matching payments" : paymentTotal === 0 ? "No card payments yet" : "No payments on this page"} description={q ? "Try a different search." : "Paid orders with a Stripe charge appear here."} /> : (
              <Table>
                <TableHeader><TableRow><TableHead>Paid</TableHead><TableHead>Order</TableHead><TableHead>Event</TableHead><TableHead>Buyer</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Stripe payment</TableHead></TableRow></TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(p.paid_at ?? p.created_at)}</TableCell>
                      <TableCell><Link href={`/org/${p.org_slug}/orders/${p.code}`} className="font-mono text-xs hover:underline">{p.code}</Link>{p.source !== "online" ? <Badge variant="outline" className="ml-2 text-[10px]">{p.source.replace("_", " ")}</Badge> : null}</TableCell>
                      <TableCell className="max-w-48 truncate">{p.event_title}<span className="block text-xs text-muted-foreground">{p.org_name}</span></TableCell>
                      <TableCell className="text-xs">{p.buyer_email}</TableCell>
                      <TableCell><StatusBadge status={p.status} /></TableCell>
                      <TableCell className="text-right font-mono">{formatCents(Number(p.total_cents), p.currency)}{Number(p.refunded_cents) ? <span className="block text-xs text-destructive">−{formatCents(Number(p.refunded_cents), p.currency)}</span> : null}</TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">{p.stripe_payment_intent_id ?? <span className="italic">no card charge</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <TablePagination page={page} perPage={perPage} total={paymentTotal} params={{ q }} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="reconcile" className="pt-4 space-y-4">
          <Section title="Run a reconciliation" description="Compares every succeeded Stripe payment in the period with paid orders in Fattixx: missing on either side, amount or refund mismatches. It also runs automatically every day for the last 2 days; Finance is emailed when it finds discrepancies.">
            <ReconcileForm configured={configured} />
          </Section>
          <Section title="Accounting & tax exports" description="CSV files for your accountant. Dates are UTC and inclusive; leave them empty for the last 31 days.">
            <div className="grid gap-4 md:grid-cols-2">
              {[
                { href: "/api/exports/accounting", title: "Accounting export", text: "Every sale, refund and dispute with fees and tax split out." },
                { href: "/api/exports/tax", title: "Tax by jurisdiction", text: "Taxable sales and tax collected per state, city and event, net of refunds." },
              ].map((x) => (
                <form key={x.href} method="get" action={x.href} className="space-y-3 rounded-lg border p-4">
                  <div><p className="font-medium">{x.title}</p><p className="text-xs text-muted-foreground">{x.text}</p></div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-xs">From<Input type="date" name="from" /></label>
                    <label className="space-y-1 text-xs">To<Input type="date" name="to" /></label>
                  </div>
                  <Button type="submit" variant="outline" size="sm">Download CSV</Button>
                </form>
              ))}
            </div>
          </Section>
          <Section title="Previous runs">
            {recon.length === 0 ? <p className="text-sm text-muted-foreground">No runs yet.</p> : (
              <div className="space-y-3">
                {recon.map((r) => {
                  const issues: { kind: string; ref: string; detail: string }[] = r.discrepancies ? JSON.parse(r.discrepancies) : [];
                  return (
                    <div key={r.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>{formatDate(r.created_at)} · {r.mode} · {formatDate(r.range_start)} → {formatDate(r.range_end)} · by {r.run_by_name ?? "—"}</span>
                        <span className="font-mono text-xs">Stripe {r.stripe_count} / {formatCents(Number(r.stripe_cents))} · Fattixx {r.db_count} / {formatCents(Number(r.db_cents))}</span>
                        {issues.length ? <Badge variant="destructive">{issues.length} discrepancies</Badge> : <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">Balanced</Badge>}
                      </div>
                      {issues.length ? <ul className="mt-2 space-y-1 text-xs text-muted-foreground">{issues.slice(0, 20).map((i, n) => <li key={n}><span className="font-mono">{i.ref}</span> · {i.kind.replace(/_/g, " ")} · {i.detail}</li>)}</ul> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="stripe" className="pt-4">
          <StripeSettingsPanel
            canEdit={isSuper}
            mode={stripe.mode}
            webhookUrl={webhookUrl}
            webhook={webhook}
            appUrlMissing={env.IS_ADMIN_APP && !process.env.APP_URL?.trim()}
            test={{ secret: maskKey(stripe.test.secretKey), publishable: stripe.test.publishableKey, webhook: maskKey(stripe.test.webhookSecret) }}
            live={{ secret: maskKey(stripe.live.secretKey), publishable: stripe.live.publishableKey, webhook: maskKey(stripe.live.webhookSecret) }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
