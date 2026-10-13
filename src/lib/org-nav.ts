import type { OrgContext } from "./authz";
import type { NavGroup, NavItem } from "@/components/app-shell";

/** The pages of an organization's panel, by role. Shared by the organization layout and the create-event page. */
export function orgNavGroups(ctx: OrgContext): NavGroup[] {
  const base = `/org/${ctx.org.slug}`;
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
  return [
    { items: overview },
    { label: "Events", items: events },
    ...(sales.length ? [{ label: "Sales", items: sales }] : []),
    ...(organization.length ? [{ label: "Organization", items: organization }] : []),
  ];
}

export const ORG_ROLE_LABEL: Record<string, string> = { super_admin: "Super Admin", org_admin: "Organization Admin", organizer: "Organizer", staff: "Staff / Scanner" };
