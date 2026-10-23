import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { query, type Row } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { proState, stateIsPro, type ProState, type SubscriptionSnapshot } from "@/lib/pro/status";
import { graceDays, PRICE_CENTS } from "@/lib/pro/subscription";
import { PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Pro subscriptions" };

const LABEL: Record<ProState["kind"], string> = { none: "Standard", pending: "Checkout started", active: "Active", canceling: "Cancels at period end", grace: "Payment failed (grace)", lapsed: "Lapsed (unpaid)", ended: "Ended", comp: "Complimentary" };
const BADGE: Record<ProState["kind"], string> = { none: "draft", pending: "pending", active: "active", canceling: "paused", grace: "pending", lapsed: "failed", ended: "expired", comp: "approved" };

/** Every organization with a Pro subscription or a complimentary grant, with the status the rules give it (lib/pro/status.ts). */
export default async function SubscriptionsPage() {
  await requirePlatformStaff(["super_admin", "finance"]);
  const [rows, grace] = await Promise.all([
    query<Row & SubscriptionSnapshot & { org_id: number; slug: string; name: string; pro_comp_until: Date | null; stripe_mode: string | null; created_at: Date | null; has_sub: number; domain: string | null }>(
      `SELECT o.id AS org_id, o.slug, o.name, o.pro_comp_until, s.organization_id IS NOT NULL AS has_sub, s.status, s.billing_interval, s.cancel_at_period_end, s.current_period_end,
              s.past_due_since, s.ended_at, s.stripe_mode, s.created_at, d.live_hostname AS domain
         FROM organizations o LEFT JOIN org_subscriptions s ON s.organization_id = o.id LEFT JOIN org_domains d ON d.organization_id = o.id
        WHERE s.organization_id IS NOT NULL OR o.pro_comp_until IS NOT NULL ORDER BY o.name`),
    graceDays(),
  ]);
  const list = rows.map((r) => ({ ...r, state: proState(Number(r.has_sub) ? r : null, r.pro_comp_until, grace) }));
  const paying = list.filter((r) => ["active", "canceling", "grace"].includes(r.state.kind));
  const mrr = paying.reduce((n, r) => n + (r.billing_interval === "year" ? PRICE_CENTS.year / 12 : PRICE_CENTS.month), 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Pro subscriptions" description={`Billed through Stripe. After a failed renewal, Pro stays on for ${grace} days (Fees & Settings).`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="On Pro now" value={list.filter((r) => stateIsPro(r.state)).length} />
        <Stat label="Paying" value={paying.length} hint={`${paying.filter((r) => r.billing_interval === "year").length} yearly`} />
        <Stat label="Monthly recurring revenue" value={formatCents(Math.round(mrr))} hint="Yearly plans counted as 1/12" />
        <Stat label="Payment problems" value={list.filter((r) => r.state.kind === "grace" || r.state.kind === "lapsed").length} />
      </div>
      <Section>
        {list.length === 0 ? <p className="text-sm text-muted-foreground">No organization has subscribed yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Organization</TableHead><TableHead>Status</TableHead><TableHead>Billing</TableHead><TableHead>Period ends</TableHead><TableHead>Domain</TableHead><TableHead>Since</TableHead></TableRow></TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.org_id}>
                  <TableCell><Link href={`/admin/organizations/${r.slug}`} className="font-medium hover:underline">{r.name}</Link></TableCell>
                  <TableCell><span className="flex items-center gap-2"><StatusBadge status={BADGE[r.state.kind]} /><span className="text-sm">{LABEL[r.state.kind]}</span></span></TableCell>
                  <TableCell className="text-sm">{Number(r.has_sub) ? `${r.billing_interval === "year" ? "Yearly" : "Monthly"}${r.stripe_mode === "test" ? " (test)" : ""}` : "—"}</TableCell>
                  <TableCell className="text-sm">{r.state.kind === "comp" ? formatDate(r.pro_comp_until) : formatDate(r.current_period_end)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.domain ?? "—"}</TableCell>
                  <TableCell className="text-sm">{formatDate(r.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
