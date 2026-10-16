import type { ReactNode } from "react";
import { hasPlatformRole } from "@/lib/auth/guard";
import type { CurrentSession } from "@/lib/auth/session";
import { adminLogout } from "@/lib/auth/actions";
import { brandingForLayout } from "@/lib/branding";
import { AppShell, type NavGroup, type NavItem } from "@/components/app-shell";

/**
 * Platform staff chrome. Used by the admin area and also by organization pages when platform
 * staff open them (an order, an event…), so the sidebar never switches to the organizer one;
 * the org layout passes that org's pages in as `extraGroups`.
 * Super Admin sees everything; Support and Finance see only the sections their job needs.
 */
export async function AdminShell({ session, extraGroups = [], headerRight, children }: { session: CurrentSession; extraGroups?: NavGroup[]; headerRight?: ReactNode; children: ReactNode }) {
  const brand = await brandingForLayout();
  const isSuper = hasPlatformRole(session, "super_admin");
  const isFinance = isSuper || hasPlatformRole(session, "finance");
  const isSupport = isSuper || hasPlatformRole(session, "support");

  const platform: NavItem[] = [
    ...(isSupport ? [{ href: "/admin/applications", label: "Organizer applications", icon: "clipboard" as const }] : []),
    ...(isFinance ? [
      { href: "/admin/organizations", label: "Organizations", icon: "building" as const },
      { href: "/admin/events", label: "Events", icon: "calendar" as const },
    ] : []),
    { href: "/admin/orders", label: "Orders & Tickets", icon: "receipt" },
    ...(isSupport ? [{ href: "/admin/users", label: "Users", icon: "users" as const }] : []),
    ...(isSuper ? [{ href: "/admin/ads", label: "Ads & sponsors", icon: "megaphone" as const }] : []),
  ];
  const money: NavItem[] = isFinance ? [
    { href: "/admin/payments", label: "Payments & Stripe", icon: "receipt" },
    { href: "/admin/payouts", label: "Payouts", icon: "ticket" },
    { href: "/admin/disputes", label: "Disputes", icon: "shield" },
  ] : [];
  const system: NavItem[] = [
    ...(isFinance ? [{ href: "/admin/settings", label: "Fees & Settings", icon: "settings" as const }] : []),
    ...(isSupport ? [{ href: "/admin/emails", label: "Emails", icon: "mail" as const }] : []),
    ...(isSuper ? [{ href: "/admin/monitoring", label: "Monitoring", icon: "scan" as const }, { href: "/admin/audit", label: "Audit Log", icon: "list" as const }] : []),
    { href: "/admin/security", label: "Security", icon: "shield" },
  ];
  const groups: NavGroup[] = [
    { items: [{ href: "/admin", label: "Dashboard", icon: "home", exact: true }] },
    { label: "Platform", items: platform },
    ...(money.length ? [{ label: "Money", items: money }] : []),
    { label: "System", items: system },
    ...extraGroups,
  ];
  const areaLabel = isSuper ? "Super Admin" : hasPlatformRole(session, "finance") ? "Finance" : "Support";

  return (
    <AppShell brand={brand.name} brandHref="/admin" areaLabel={areaLabel} groups={groups} user={session.user} onSignOut={adminLogout} logoUrl={brand.logoUrl} headerRight={headerRight}>
      {children}
    </AppShell>
  );
}
