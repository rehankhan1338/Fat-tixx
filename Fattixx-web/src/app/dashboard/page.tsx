import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guard";
import { listMemberships } from "@/lib/authz";
import { logout } from "@/lib/auth/actions";
import { env } from "@/lib/env";
import { AuthShell } from "@/components/auth-shell";
import { RoleBadge } from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle, ItemActions } from "@/components/ui/item";

export const metadata: Metadata = { title: "Your organizations" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const session = await requireSession();
  const sp = await searchParams;
  const memberships = await listMemberships(session.user.id);
  if (memberships.length === 0 && !session.user.roles.length && !sp.denied) redirect("/account");

  return (
    <AuthShell title="Your organizations" subtitle={`Signed in as ${session.user.email}`} footer={<form action={logout}><Button variant="link" type="submit">Sign out</Button></form>}>
      <div className="space-y-4">
        {sp.denied ? <Alert variant="destructive"><AlertDescription>You do not have access to that organization.</AlertDescription></Alert> : null}
        {sp.suspended ? <Alert variant="destructive"><AlertDescription>That organization is suspended. Contact Fattixx support.</AlertDescription></Alert> : null}
        {session.user.roles.length ? <Button className="w-full" nativeButton={false} render={<a href={`${env.ADMIN_URL}/admin`} />}>Open {session.user.roles.includes("super_admin") ? "Super Admin" : "platform staff"} console</Button> : null}
        {memberships.length === 0 ? <p className="text-center text-sm text-muted-foreground">You are not a member of any organization yet.</p> : (
          <ItemGroup>
            {memberships.map((m) => (
              <Item key={m.slug} variant="outline" render={<Link href={`/org/${m.slug}`} />}>
                <ItemContent><ItemTitle>{m.name}</ItemTitle><ItemDescription>/{m.slug}</ItemDescription></ItemContent>
                <ItemActions><RoleBadge role={m.role} /></ItemActions>
              </Item>
            ))}
          </ItemGroup>
        )}
        <Button variant="ghost" className="w-full" render={<Link href="/account" />}>My tickets</Button>
      </div>
    </AuthShell>
  );
}
