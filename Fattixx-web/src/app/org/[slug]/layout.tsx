import { requireOrg, listMemberships } from "@/lib/authz";
import { logout } from "@/lib/auth/actions";
import { AppShell } from "@/components/app-shell";
import { ORG_ROLE_LABEL, orgNavGroups } from "@/lib/org-nav";
import { Badge } from "@/components/ui/badge";
import { uploadUrl } from "@/lib/uploads";
import { ALL_PLATFORM_ROLES, hasPlatformRole } from "@/lib/auth/guard";
import { AdminShell } from "@/components/admin-shell";
import Link from "next/link";

export default async function OrgLayout({ children, params }: LayoutProps<"/org/[slug]">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const base = `/org/${slug}`;
  const groups = orgNavGroups(ctx);

  // Platform staff reach org pages from the admin area: keep the admin sidebar, with this org's pages as an extra section.
  if (hasPlatformRole(ctx.session, ...ALL_PLATFORM_ROLES)) {
    return (
      <AdminShell
        session={ctx.session}
        extraGroups={[{ label: ctx.org.name, items: groups.flatMap((g) => g.items) }]}
        headerRight={<>
          {ctx.org.status !== "active" ? <Badge variant="destructive">Suspended</Badge> : null}
          <Badge variant="outline" render={<Link href={`/admin/organizations/${slug}`} />}>Viewing: {ctx.org.name}</Badge>
        </>}
      >
        {children}
      </AdminShell>
    );
  }
  const memberships = await listMemberships(ctx.session.user.id);


  return (
    <AppShell
      brand={ctx.org.name} brandHref={base} areaLabel={ORG_ROLE_LABEL[ctx.role]} groups={groups} user={ctx.session.user} onSignOut={logout}
      orgSwitcher={{ current: slug, items: memberships.map((m) => ({ slug: m.slug, name: m.name, role: m.role })) }}
      headerRight={ctx.org.status !== "active" ? <Badge variant="destructive">Suspended</Badge> : null}
      logoUrl={uploadUrl(ctx.org.logo_path)}
    >
      {children}
    </AppShell>
  );
}
