import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformStaff, hasPlatformRole } from "@/lib/auth/guard";
import { listOrganizations } from "@/lib/admin/queries";
import { formatCents } from "@/lib/money";
import { PageHeader, StatusBadge, formatDate, EmptyState } from "@/components/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NewOrganizationDialog } from "./new-organization-dialog";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteOrganization } from "@/lib/admin/crud-actions";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrganizationsPage({ searchParams }: PageProps<"/admin/organizations">) {
  const session = await requirePlatformStaff(["super_admin", "finance"]);
  const isSuper = hasPlatformRole(session, "super_admin");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const orgs = await listOrganizations(q);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Organizations" description="Companies, promoters and venues that sell tickets on Fat Tixx." actions={isSuper ? <NewOrganizationDialog defaultOpen={sp.new === "1"} /> : null} />
      {sp.deleted === "1" ? <p role="status" className="rounded-md border bg-muted/50 px-4 py-3 text-sm">Organization deleted.</p> : null}
      <Card>
        <CardContent className="pt-6">
          <form className="mb-4 flex gap-2" action="/admin/organizations">
            <Input name="q" defaultValue={q} placeholder="Search by name, slug or email" className="max-w-sm" />
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          {orgs.length === 0 ? <EmptyState title={q ? "No matches" : "No organizations yet"} description={q ? "Try a different search." : "Create the first organization to start selling tickets."} action={!q && isSuper ? <NewOrganizationDialog /> : undefined} /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Organization</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Members</TableHead><TableHead className="text-right">Events</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Gross sales</TableHead><TableHead>Created</TableHead>{isSuper ? <TableHead className="w-0" /> : null}</TableRow></TableHeader>
              <TableBody>
                {orgs.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link href={`/admin/organizations/${o.slug}`} className="font-medium hover:underline">{o.name}</Link>
                      <span className="block text-xs text-muted-foreground">/{o.slug} · {o.contact_email}</span>
                    </TableCell>
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                    <TableCell className="text-right tabular-nums">{o.members}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.events}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.orders}</TableCell>
                    <TableCell className="text-right font-mono">{formatCents(Number(o.gross_cents))}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(o.created_at)}</TableCell>
                    {isSuper ? (
                      <TableCell className="text-right">
                        <ConfirmButton action={deleteOrganization} fields={{ org: o.slug }} title={`Delete ${o.name}?`} description={`This permanently removes its venues, ${o.events} event(s), ${o.orders} order(s), tickets and team memberships. No refunds are issued. To keep its records, suspend it instead.`} confirmText="Delete organization" variant="ghost">Delete</ConfirmButton>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
