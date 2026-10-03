import { requireOrg, listMemberships } from "@/lib/authz";
import { logout } from "@/lib/auth/actions";
import { AppShell, type NavGroup, type NavItem } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { uploadUrl } from "@/lib/uploads";
import { ALL_PLATFORM_ROLES, hasPlatformRole } from "@/lib/auth/guard";
import { AdminShell } from "@/components/admin-shell";
import Link from "next/link";

export default async function OrgLayout({ children, params }: LayoutProps<"/org/[slug]">) {
  const { slug } = await params;
  const ctx = await requireOrg(slug);
  const base = `/org/${slug}`;

  const overview: NavItem[] = [{ href: base, label: "Overview", icon: "home", exact: true }];
  const events: NavItem[] = [
    { href: `${base}/events`, label: "Events", icon: "calendar" },
    ...(ctx.role !== "staff" ? [{ href: `${base}/venues`, label: "Venues", icon: "map" as const }] : []),
    { href: `${base}/scan`, label: "Check-in / Scan", icon: "scan" },
  ];
  const sales: NavItem[] = ctx.role !== "staff" ? [
    { href: `${base}/orders`, label: "Orders", icon: "receipt" },
    { href: `${base}/analytics`, label: "Analytics", icon: "chart" },
    { href: `${base}/marketing`, label: "Marketing", icon: "megaphone" },
  ] : [];
  const organization: NavItem[] = ctx.isOrgAdmin ? [
    { href: `${base}/team`, label: "Team", icon: "users" },
    { href: `${base}/settings`, label: "Settings", icon: "settings" },
  ] : [];

  // Platform staff reach org pages from the admin area: keep the admin sidebar, with this org's pages as an extra section.
  if (hasPlatformRole(ctx.session, ...ALL_PLATFORM_ROLES)) {
    return (
      <AdminShell
        session={ctx.session}
        extraGroups={[{ label: ctx.org.name, items: [...overview, ...events, ...sales, ...organization] }]}
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

  const groups: NavGroup[] = [
    { items: overview },
    { label: "Events", items: events },
    ...(sales.length ? [{ label: "Sales", items: sales }] : []),
    ...(organization.length ? [{ label: "Organization", items: organization }] : []),
  ];

  const roleLabel: Record<string, string> = { super_admin: "Super Admin", org_admin: "Organization Admin", organizer: "Organizer", staff: "Staff / Scanner" };

  return (
    <AppShell
      brand={ctx.org.name} brandHref={base} areaLabel={roleLabel[ctx.role]} groups={groups} user={ctx.session.user} onSignOut={logout}
      orgSwitcher={{ current: slug, items: memberships.map((m) => ({ slug: m.slug, name: m.name, role: m.role })) }}
      headerRight={ctx.org.status !== "active" ? <Badge variant="destructive">Suspended</Badge> : null}
      logoUrl={uploadUrl(ctx.org.logo_path)}
    >
      {children}
    </AppShell>
  );
}
