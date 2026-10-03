import type { Metadata } from "next";
import { requireSuperAdmin } from "@/lib/auth/guard";
import { listAudit } from "@/lib/admin/queries";
import { PageHeader, formatDate, EmptyState } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.replace(/[^a-z_.]/gi, "") : "";
  const rows = await listAudit(300, q);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Audit log" description="Immutable record of sign-ins, administrative actions, refunds and check-in overrides." />
      <Card><CardContent className="pt-6">
        <form className="mb-4 flex gap-2" action="/admin/audit">
          <Input name="q" defaultValue={q} placeholder="Filter by action prefix, e.g. order. or checkin.override" className="max-w-sm font-mono text-xs" />
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
        {rows.length === 0 ? <EmptyState title="Nothing recorded yet" /> : (
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
      </CardContent></Card>
    </div>
  );
}
