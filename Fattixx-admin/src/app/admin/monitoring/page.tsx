import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guard";
import { monitoringSnapshot } from "@/lib/admin/finance-queries";
import { getActiveStripe } from "@/lib/payments/stripe";
import { isSmtpConfigured } from "@/lib/email";
import { setUserStatus } from "@/lib/admin/actions";
import { PageHeader, Section, Stat, formatDate } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmButton } from "@/components/confirm-button";

export const metadata: Metadata = { title: "Monitoring" };

/** No webhook in 7 days while Stripe is configured usually means the endpoint is misconfigured. */
function isWebhookStale(last: Date | null): boolean {
  return !last || Date.now() - last.getTime() > 7 * 86_400_000;
}

function Health({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <li className="flex items-center justify-between rounded-lg border p-3 text-sm">
      <span>{label}<span className="block text-xs text-muted-foreground">{detail}</span></span>
      <Badge variant="outline" className={ok === null ? "border-amber-500/40 text-amber-700" : ok ? "border-emerald-500/40 text-emerald-700" : "border-red-500/40 text-red-700"}>{ok === null ? "Not configured" : ok ? "OK" : "Attention"}</Badge>
    </li>
  );
}

export default async function MonitoringPage() {
  await requireSuperAdmin();
  const [m, stripe] = await Promise.all([monitoringSnapshot(), getActiveStripe()]);
  const smtp = isSmtpConfigured();
  const webhookStale = stripe ? isWebhookStale(m.lastWebhookAt) : null;

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
          <Health ok={smtp ? m.failedEmails.length === 0 : null} label="Email delivery" detail={smtp ? `${m.failedEmails.length} failed, ${m.queuedEmails} queued` : "BREVO_API_KEY not set — emails are only logged"} />
          <Health ok={stripe ? !webhookStale : null} label="Stripe webhook" detail={stripe ? (m.lastWebhookAt ? `Last event ${formatDate(m.lastWebhookAt)} (${m.lastWebhookType}) · ${m.webhooks24h} in 24h` : "No webhook event received yet") : "Stripe keys not set"} />
          <Health ok={stripe ? stripe.mode === "test" || true : null} label="Stripe mode" detail={stripe ? `${stripe.mode.toUpperCase()} keys active` : "Not connected"} />
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

        <Section title="Failed emails" description="Delivery failures reported by the mail server.">
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
