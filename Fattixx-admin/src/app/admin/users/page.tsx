import type { Metadata } from "next";
import { requirePlatformStaff, hasPlatformRole } from "@/lib/auth/guard";
import { countUsers, listUsers } from "@/lib/admin/queries";
import { DEFAULT_PER_PAGE, parsePagination } from "@/lib/pagination";
import { PageHeader, formatDate } from "@/components/shared";
import { TablePagination } from "@/components/table-pagination";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UsersTable, NewPlatformUserDialog } from "./users-table";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const session = await requirePlatformStaff(["super_admin", "support"]);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const { page, perPage, offset } = parsePagination(sp);
  const [users, total] = await Promise.all([listUsers(q, perPage, offset), countUsers(q)]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Users" description="Every account on the platform: attendees, organization teams and platform staff." actions={hasPlatformRole(session, "super_admin") ? <NewPlatformUserDialog /> : null} />
      <Card>
        <CardContent className="space-y-4 pt-6">
          <form className="flex gap-2" action="/admin/users">
            <Input name="q" defaultValue={q} placeholder="Search by name or email" className="max-w-sm" />
            {perPage !== DEFAULT_PER_PAGE ? <input type="hidden" name="per" value={perPage} /> : null}
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          <UsersTable users={users.map((u) => ({ ...u, last_login_at: u.last_login_at ? formatDate(u.last_login_at) : null, created_at: formatDate(u.created_at) }))} currentUserId={session.user.id} canManage={hasPlatformRole(session, "super_admin")} />
          <TablePagination page={page} perPage={perPage} total={total} params={{ q }} />
        </CardContent>
      </Card>
    </div>
  );
}
