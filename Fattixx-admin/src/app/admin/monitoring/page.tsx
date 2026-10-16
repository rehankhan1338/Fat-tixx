import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guard";
import { monitoringSnapshot } from "@/lib/admin/finance-queries";
import { checkWebhookEndpoint, getActiveStripe, type WebhookEndpointStatus } from "@/lib/payments/stripe";
import { emailDeliveryStatus } from "@/lib/email";
import { env } from "@/lib/env";
import { setUserStatus } from "@/lib/admin/actions";
import { PageHeader, Section, Stat, formatDate } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmButton } from "@/components/confirm-button";

export const metadata: Metadata = { title: "Monitoring" };

/** Card payments in the last 7 days but no webhook event in that time means Stripe is not reaching us. */
function isWebhookStale(last: Date | null, cardPayments7d: number): boolean {
  return cardPayments7d > 0 && (!last || Date.now() - last.getTime() > 7 * 86_400_000);
}

/** One line explaining the webhook state, from the endpoint Stripe actually has registered. */
function webhookDetail(w: WebhookEndpointStatus, m: { lastWebhookAt: Date | null; lastWebhookType: string | null; webhooks24h: number }): string {
  if (w.error) return `Could not query Stripe: ${w.error}`;
  if (!w.endpoint) return `No endpoint for ${w.url} in Stripe — register it under Payments → Stripe keys`;
  const problems: string[] = [];
  if (w.endpoint.status !== "enabled") problems.push(`endpoint is ${w.endpoint.status}`);
  if (w.endpoint.missingEvents.length) problems.push(`missing events: ${w.endpoint.missingEvents.join(", ")}`);
  if (!w.secretSaved) problems.push("signing secret not saved");
  if (problems.length) return `Registered in Stripe but ${problems.join("; ")}`;
  return m.lastWebhookAt ? `Registered · last event ${formatDate(m.lastWebhookAt)} (${m.lastWebhookType}) · ${m.webhooks24h} in 24h` : "Registered and enabled in Stripe · no event received yet";
}

function Health({ ok, label, detail, href }: { ok: boolean | null; label: string; detail: string; href?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
      <span className="min-w-0">{label}<span className="block text-xs text-muted-foreground wrap-anywhere">{href ? <Link href={href} className="hover:underline">{detail}</Link> : detail}</span></span>
      <Badge variant="outline" className={`shrink-0 ${ok === null ? "border-amber-500/40 text-amber-700" : ok ? "border-emerald-500/40 text-emerald-700" : "border-red-500/40 text-red-700"}`}>{ok === null ? "Not configured" : ok ? "OK" : "Attention"}</Badge>
    </li>
  );
}

export default async function MonitoringPage() {
  await requireSuperAdmin();
  const [m, stripe, email] = await Promise.all([monitoringSnapshot(), getActiveStripe(), emailDeliveryStatus()]);
  const webhook = stripe ? await checkWebhookEndpoint(stripe, `${env.APP_URL}/api/stripe/webhook`) : null;
  const webhookOk = webhook ? webhook.ok && !isWebhookStale(m.lastWebhookAt, m.cardPayments7d) : null;
  const emailDetail = email.configured
    ? `${email.provider === "brevo" ? "Brevo" : "SMTP"} · ${email.from}${email.source === "env" ? " · key from environment" : ""} · ${m.failedEmails.length} failed, ${m.queuedEmails} queued`
    : "No Brevo key saved — emails are only logged. Configure under Settings → Integrations";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Security, fraud & system monitoring" description="Operational health at a glance: sign-in abuse, locked accounts, email delivery, Stripe webhooks, inventory holds and check-in overrides." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Failed sign-ins · 24h" value={m.failedLogins24h} hint={`${m.throttledIps.length} IP(s) with 10+ failures`} />
        <Stat label="Locked / suspended accounts" value={m.locked.length} />
        <Stat label="Active checkout holds" value={m.pendingHolds} hint={`${m.expiredHolds24h} expired in 24h`} />
        <Stat label="Open disputes" value={m.disputesOpen} />
      </div>

      <Section title="System health">
        <ul className="grid gap-2 sm:grid-cols-2">
          <Health ok={m.dbOk} label="Database" detail="MariaDB connection and queries" />
          <Health ok={email.configured ? m.failedEmails.length === 0 : null} label="Email delivery" detail={emailDetail} href={email.configured ? undefined : "/admin/settings?tab=integrations"} />
          <Health ok={webhookOk} label="Stripe webhook" detail={webhook ? (webhookOk === false && webhook.ok ? `No event in 7 days despite ${m.cardPayments7d} card payment(s) — check the endpoint in Stripe` : webhookDetail(webhook, m)) : "Stripe keys not set — add them under Payments → Stripe keys"} href={webhook && !webhook.ok ? "/admin/payments?tab=stripe" : undefined} />
          <Health ok={stripe ? true : null} label="Stripe mode" detail={stripe ? `${stripe.mode.toUpperCase()} keys active` : "Not connected"} />
        </ul>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Locked or suspended accounts" description="Accounts lock after 5 failed passwords (15 min, doubling). Suspended accounts were set by an admin.">
          {m.locked.length === 0 ? <p className="text-sm text-muted-foreground">None right now.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Failures</TableHead><TableHead>Locked until</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {m.locked.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.name}<span className="block text-xs text-muted-foreground">{u.email}</span></TableCell>
                    <TableCell className="tabular-nums">{u.failed_login_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.status !== "active" ? <Badge variant="destructive">{u.status}</Badge> : formatDate(u.locked_until)}</TableCell>
                    <TableCell className="text-right">{u.status !== "active" ? <ConfirmButton action={setUserStatus} fields={{ user_id: u.id, status: "active" }} title={`Reactivate ${u.name}?`} confirmText="Reactivate" variant="outline" successText="Reactivated">Reactivate</ConfirmButton> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section title="Suspicious sign-in sources" description="IP addresses with 10 or more failed sign-ins in the last 24 hours. Blocking happens automatically at 50 failures per 15 minutes.">
          {m.throttledIps.length === 0 ? <p className="text-sm text-muted-foreground">No abusive sources detected.</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>IP</TableHead><TableHead className="text-right">Failures · 24h</TableHead></TableRow></TableHeader>
              <TableBody>{m.throttledIps.map((r) => <TableRow key={r.ip}><TableCell className="font-mono text-xs">{r.ip}</TableCell><TableCell className="text-right tabular-nums">{r.n}</TableCell></TableRow>)}</TableBody>
            </Table>
          )}
        </Section>

        <Section title="Failed emails" description="Delivery failures reported by the mail provider.">
          {m.failedEmails.length === 0 ? <p className="text-sm text-muted-foreground">No failures.</p> : (
            <ul className="space-y-2 text-sm">{m.failedEmails.map((e) => <li key={e.id}><Link href={`/admin/emails/${e.id}`} className="hover:underline">{e.subject}</Link><span className="block text-xs text-muted-foreground">{e.to_email} · {formatDate(e.created_at)} · {e.error}</span></li>)}</ul>
          )}
        </Section>

        <Section title="Check-in overrides & undos · 7 days" description="Every override is a potential fraud signal; each one carries a reason and the staff member.">
          {m.overrides.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
            <ul className="space-y-2 text-sm">{m.overrides.map((o) => <li key={o.id}><Badge variant="outline" className="mr-2">{o.result}</Badge>{o.event_title} · <span className="font-mono text-xs">{o.code ?? "—"}</span><span className="block text-xs text-muted-foreground">{formatDate(o.created_at)} · {o.staff ?? "—"}{o.reason ? ` · ${o.reason}` : ""}</span></li>)}</ul>
          )}
        </Section>
      </div>
    </div>
  );
}
