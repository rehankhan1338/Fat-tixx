"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BuildingIcon, CalendarIcon, ChevronsUpDownIcon, HomeIcon, LogOutIcon, MailIcon, MapPinIcon, ReceiptIcon, ScanLineIcon,
  SettingsIcon, ShieldIcon, TicketIcon, UsersIcon, ListIcon, ExternalLinkIcon, MegaphoneIcon, ChartColumnIcon, ClipboardCheckIcon, LinkIcon, TagIcon, type LucideIcon,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarSeparator, SidebarTrigger,
} from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { BrandMark } from "@/components/brand-mark";
import { clearOfflineScanData } from "@/lib/offline-scan-store";

/** Sign-out removes downloaded ticket lists and cached scanner pages from this device (plan 10.3). */
async function clearDeviceData() {
  await clearOfflineScanData();
  try { navigator.serviceWorker?.controller?.postMessage("fx-clear"); } catch { /* no service worker */ }
}

const ICONS: Record<string, LucideIcon> = {
  home: HomeIcon, building: BuildingIcon, users: UsersIcon, calendar: CalendarIcon, ticket: TicketIcon, receipt: ReceiptIcon,
  mail: MailIcon, settings: SettingsIcon, shield: ShieldIcon, scan: ScanLineIcon, map: MapPinIcon, list: ListIcon,
  megaphone: MegaphoneIcon, chart: ChartColumnIcon, clipboard: ClipboardCheckIcon, link: LinkIcon, tag: TagIcon,
};

export interface NavItem { href: string; label: string; icon: keyof typeof ICONS; exact?: boolean; badge?: string | number }
export interface NavGroup { label?: string; items: NavItem[] }
export interface ShellUser { name: string; email: string }
export interface OrgSwitchItem { slug: string; name: string; role: string }

export function AppShell({
  brand, brandHref = "/", areaLabel, groups, user, onSignOut, children, orgSwitcher, headerRight, logoUrl = null,
}: {
  brand: string; brandHref?: string; areaLabel: string; groups: NavGroup[]; user: ShellUser; logoUrl?: string | null;
  onSignOut: () => Promise<void>; children: ReactNode; orgSwitcher?: { current: string; items: OrgSwitchItem[] }; headerRight?: ReactNode;
}) {
  const pathname = usePathname();
  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/"));
  const initials = user.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" render={<Link href={brandHref} />}>
                <BrandMark name={brand} logoUrl={logoUrl} size="sm" />
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{brand}</span>
                  <span className="truncate text-xs text-muted-foreground">{areaLabel}</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {orgSwitcher && orgSwitcher.items.length > 1 ? (
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<SidebarMenuButton className="justify-between" />}>
                    <span className="truncate text-xs">Switch organization</span>
                    <ChevronsUpDownIcon className="size-3.5 opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-(--anchor-width) min-w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
                      {orgSwitcher.items.map((o) => (
                        <DropdownMenuItem key={o.slug} render={<Link href={`/org/${o.slug}`} />}>
                          <span className="flex-1 truncate">{o.name}</span>
                          <Badge variant="outline" className="ml-2 text-[10px]">{o.role.replace("_", " ")}</Badge>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          ) : null}
        </SidebarHeader>

        <SidebarContent>
          {groups.map((g, i) => (
            <SidebarGroup key={i}>
              {g.label ? <SidebarGroupLabel>{g.label}</SidebarGroupLabel> : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {g.items.map((item) => {
                    const Icon = ICONS[item.icon];
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton isActive={isActive(item)} tooltip={item.label} render={<Link href={item.href} />}>
                          <Icon />
                          <span>{item.label}</span>
                          {item.badge != null ? <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">{item.badge}</Badge> : null}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <SidebarSeparator />
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                  <Avatar className="size-8 rounded-lg"><AvatarFallback className="rounded-lg text-xs">{initials}</AvatarFallback></Avatar>
                  <span className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                  </span>
                  <ChevronsUpDownIcon className="ml-auto size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" className="w-(--anchor-width) min-w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="font-normal">
                      <span className="block truncate text-sm font-medium">{user.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<Link href="/" />}><ExternalLinkIcon /> Public site</DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/dashboard" />}><HomeIcon /> My organizations</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => void clearDeviceData().finally(() => onSignOut())}><LogOutIcon /> Sign out</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm text-muted-foreground">{areaLabel}</span>
          <div className="ml-auto flex items-center gap-2">{headerRight}</div>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
