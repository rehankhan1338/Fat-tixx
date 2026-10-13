import type { Metadata } from "next";
import { Trash2Icon } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/guard";
import { countAudit, listAudit } from "@/lib/admin/queries";
import { clearAuditLog } from "@/lib/admin/actions";
import { DEFAULT_PER_PAGE, parsePagination } from "@/lib/pagination";
import { PageHeader, formatDate, EmptyState } from "@/components/shared";
import { ConfirmButton } from "@/components/confirm-button";
import { TablePagination } from "@/components/table-pagination";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.replace(/[^a-z_.]/gi, "") : "";
  const { page, perPage, offset } = parsePagination(sp);
  const [rows, total] = await Promise.all([listAudit(perPage, q, offset), countAudit(q)]);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Audit log"
        description="Record of sign-ins, administrative actions, refunds and check-in overrides."
        actions={total > 0 ? (
          <ConfirmButton
            action={clearAuditLog}
            title="Clear the entire audit log?"
            description={`All ${total.toLocaleString()} entries will be permanently deleted. A single "audit.cleared" entry is written afterwards so the wipe itself stays on record.`}
            confirmText="Clear audit log"
            successText="Audit log cleared"
          ><Trash2Icon /> Clear logs</ConfirmButton>
        ) : null}
      />
      <Card><CardContent className="space-y-4 pt-6">
        <form className="flex gap-2" action="/admin/audit">
          <Input name="q" defaultValue={q} placeholder="Filter by action prefix, e.g. order. or checkin.override" className="max-w-sm font-mono text-xs" />
          {perPage !== DEFAULT_PER_PAGE ? <input type="hidden" name="per" value={perPage} /> : null}
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {rows.length === 0 ? <EmptyState title={q ? "No entries match this filter" : "Nothing recorded yet"} /> : (
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Target</TableHead><TableHead>Details</TableHead><TableHead>IP</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="text-xs">{r.actor_email ?? <span className="text-muted-foreground">system</span>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.target_type ? `${r.target_type} #${r.target_id}` : "—"}</TableCell>
                  <TableCell className="max-w-md truncate font-mono text-[11px] text-muted-foreground" title={r.metadata ?? ""}>{r.metadata ?? ""}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{r.ip}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <TablePagination page={page} perPage={perPage} total={total} params={{ q }} />
      </CardContent></Card>
    </div>
  );
}
