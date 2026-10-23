import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff } from "@/lib/auth/guard";
import { isOverdue, RESPONSE_TARGET_HOURS, supportQueue, supportQueueCounts, SUPPORT_STATUSES, type SupportStatus } from "@/lib/pro/support";
import { PageHeader, Section, Stat, StatusBadge, formatDate } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Support queue" };

/** Organizer support requests: Fattixx Pro (priority) first, then oldest first. Plan 5.7.2 "priority support". */
export default async function SupportQueuePage({ searchParams }: PageProps<"/admin/support">) {
  await requirePlatformStaff(["super_admin", "support"]);
  const sp = await searchParams;
  const status = (["active", "all", ...SUPPORT_STATUSES] as string[]).includes(String(sp.status)) ? (String(sp.status) as SupportStatus | "active" | "all") : "active";
  const priority = sp.priority === "priority" || sp.priority === "normal" ? sp.priority : null;
  const [rows, counts] = await Promise.all([supportQueue({ status, priority }), supportQueueCounts()]);
  const link = (p: Record<string, string>) => `/admin/support?${new URLSearchParams({ status, ...(priority ? { priority } : {}), ...p })}`;
  const filters: [string, string][] = [["active", "Open"], ["waiting", "Waiting on organizer"], ["resolved", "Resolved"], ["all", "All"]];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Support queue" description={`Fattixx Pro organizers are answered first: first response within ${RESPONSE_TARGET_HOURS.priority} business hours (others ${RESPONSE_TARGET_HOURS.normal}).`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Open requests" value={counts.open} />
        <Stat label="Open, Pro priority" value={counts.priorityOpen} />
        <Stat label="Past response target" value={counts.overdue} hint="No staff reply yet" />
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {filters.map(([k, label]) => <Link key={k} href={link({ status: k })} className={status === k ? "font-semibold underline" : "underline-offset-2 hover:underline"}>{label}</Link>)}
        <span className="text-muted-foreground">·</span>
        <Link href={`/admin/support?${new URLSearchParams({ status, ...(priority === "priority" ? {} : { priority: "priority" }) })}`} className={priority === "priority" ? "font-semibold underline" : "hover:underline"}>Pro only</Link>
      </div>
      <Section>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing here.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Organization</TableHead><TableHead>Status</TableHead><TableHead>Assigned</TableHead><TableHead>Opened</TableHead><TableHead>Last message</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      {r.priority === "priority" ? <StatusBadge status="priority" /> : null}
                      <Link href={`/admin/support/${r.id}`} className="font-medium hover:underline">{r.subject}</Link>
                      {isOverdue(r) ? <span className="text-xs font-semibold text-destructive">overdue</span> : null}
                    </span>
                    <span className="block text-xs text-muted-foreground">{r.category} · {r.email} · {r.messages} message{Number(r.messages) === 1 ? "" : "s"}</span>
                  </TableCell>
                  <TableCell className="text-sm">{r.org_slug ? <Link href={`/admin/organizations/${r.org_slug}`} className="hover:underline">{r.org_name}</Link> : "—"}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-sm">{r.assignee_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{formatDate(r.created_at)}</TableCell>
                  <TableCell className="text-sm">{formatDate(r.last_message_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
