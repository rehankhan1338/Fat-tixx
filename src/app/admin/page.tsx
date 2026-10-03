import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff, hasPlatformRole } from "@/lib/auth/guard";
import { platformOverview, recentOrders, listAudit } from "@/lib/admin/queries";
import { formatCents } from "@/lib/money";
import { PageHeader, Section, Stat, StatusBadge, formatDate, EmptyState } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AdminDashboard() {
  const session = await requirePlatformStaff();
  const [o, orders, audit] = await Promise.all([platformOverview(), recentOrders(8), listAudit(10)]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Platform dashboard"
        description={`Welcome back, ${session.user.name}. Everything across every organization.`}
        actions={hasPlatformRole(session, "super_admin") ? <Button render={<Link href="/admin/organizations?new=1" />}>New organization</Button> : null}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Gross sales · 30 days" value={formatCents(o.gross30d)} hint={`${o.orders30d} paid orders`} />
        <Stat label="Platform fees · 30 days" value={formatCents(o.fees30d)} hint={`Refunds: ${formatCents(o.refunds30d)}`} />
        <Stat label="Tickets issued" value={o.ticketsIssued} hint={`${o.checkedIn} checked in`} />
        <Stat label="Organizations" value={o.orgs} hint={`${o.upcomingEvents} upcoming events · ${o.users} users`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Recent orders" className="lg:col-span-2" actions={<Button variant="ghost" size="sm" render={<Link href="/admin/orders" />}>View all</Button>}>
          {orders.length === 0 ? <EmptyState title="No orders yet" description="Orders appear here as soon as tickets are sold." /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Event</TableHead><TableHead>Buyer</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {orders.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Link href={`/org/${r.org_slug}/orders/${r.code}`} className="font-mono text-xs hover:underline">{r.code}</Link></TableCell>
                    <TableCell className="max-w-56 truncate">{r.event_title}<span className="block text-xs text-muted-foreground">{r.org_name}</span></TableCell>
                    <TableCell className="text-muted-foreground">{r.buyer_email}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-right font-mono">{formatCents(r.total_cents, r.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section title="Recent activity" actions={<Button variant="ghost" size="sm" render={<Link href="/admin/audit" />}>Audit log</Button>}>
          {audit.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
            <ul className="space-y-3 text-sm">
              {audit.map((a) => (
                <li key={a.id} className="grid gap-0.5">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-xs text-muted-foreground">{a.actor_email ?? "system"} · {formatDate(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
