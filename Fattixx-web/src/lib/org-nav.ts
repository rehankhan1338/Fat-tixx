import type { OrgContext } from "./authz";
import type { NavGroup, NavItem } from "@/components/app-shell";

/** The pages of an organization's panel, by role. Shared by the organization layout and the create-event page. */
export function orgNavGroups(ctx: OrgContext): NavGroup[] {
  const base = `/org/${ctx.org.slug}`;
  const overview: NavItem[] = [{ href: base, label: "Overview", icon: "home", exact: true }];
  const events: NavItem[] = [
    { href: `${base}/events`, label: "Events", icon: "calendar" },
    ...(ctx.role !== "staff" ? [{ href: `${base}/venues`, label: "Venues", icon: "map" as const }] : []),
    // Reserved seating (Fattixx Pro, plan 5.7.3–5.7.13): seat maps, the Venue Library and map requests
    ...(ctx.role !== "staff" ? [{ href: `${base}/seating`, label: "Seat maps", icon: "seats" as const }] : []),
    { href: `${base}/scan`, label: "Check-in / Scan", icon: "scan" },
  ];
  const sales: NavItem[] = ctx.role !== "staff" ? [
    { href: `${base}/orders`, label: "Orders", icon: "receipt" },
    { href: `${base}/analytics`, label: "Analytics", icon: "chart" },
    { href: `${base}/marketing`, label: "Marketing", icon: "megaphone" },
    // Fattixx Pro (plan 5.7.2); the pages explain Pro to organizations that are not on it
    { href: `${base}/email`, label: "Email", icon: "mail" },
    { href: `${base}/reports`, label: "Reports", icon: "list" },
    // Sponsorship marketplace (Phase 3): packages listed on /sponsorships and the requests sponsors send
    { href: `${base}/sponsorships`, label: "Sponsorships", icon: "handshake" },
  ] : [];
  const organization: NavItem[] = [
    ...(ctx.isOrgAdmin ? [
      { href: `${base}/team`, label: "Team", icon: "users" as const },
      { href: `${base}/settings`, label: "Settings", icon: "settings" as const },
      // Stripe Connect payouts (Phase 3)
      { href: `${base}/payouts`, label: "Payouts", icon: "banknote" as const },
      { href: `${base}/pro`, label: "Fattixx Pro", icon: "sparkles" as const },
    ] : []),
    ...(ctx.role !== "staff" ? [{ href: `${base}/support`, label: "Help", icon: "lifebuoy" as const }] : []),
  ];
  return [
    { items: overview },
    { label: "Events", items: events },
    ...(sales.length ? [{ label: "Sales", items: sales }] : []),
    ...(organization.length ? [{ label: "Organization", items: organization }] : []),
  ];
}

export const ORG_ROLE_LABEL: Record<string, string> = { super_admin: "Super Admin", org_admin: "Organization Admin", organizer: "Organizer", staff: "Staff / Scanner" };
