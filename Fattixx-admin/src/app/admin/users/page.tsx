import type { Metadata } from "next";
import { requirePlatformStaff, hasPlatformRole } from "@/lib/auth/guard";
import { listUsers } from "@/lib/admin/queries";
import { PageHeader, formatDate } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UsersTable, NewPlatformUserDialog } from "./users-table";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const session = await requirePlatformStaff(["super_admin", "support"]);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const users = await listUsers(q);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Users" description="Every account on the platform: attendees, organization teams and platform staff." actions={hasPlatformRole(session, "super_admin") ? <NewPlatformUserDialog /> : null} />
      <Card>
        <CardContent className="pt-6">
          <form className="mb-4 flex gap-2" action="/admin/users">
            <Input name="q" defaultValue={q} placeholder="Search by name or email" className="max-w-sm" />
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          <UsersTable users={users.map((u) => ({ ...u, last_login_at: u.last_login_at ? formatDate(u.last_login_at) : null, created_at: formatDate(u.created_at) }))} currentUserId={session.user.id} canManage={hasPlatformRole(session, "super_admin")} />
        </CardContent>
      </Card>
    </div>
  );
}
