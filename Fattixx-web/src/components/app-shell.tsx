"use client";

/*
 * Shell of the organizer, organization admin and staff / scanner panels, in the public site's design language: the
 * same sticky top bar as the create-event page (logo, the panel's pages as pill links, the organization switcher and
 * the user menu), then the page in a centered column on ivory. The Super Admin area has its own shell.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BuildingIcon, CalendarIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, HomeIcon, LogOutIcon, MailIcon, MapPinIcon, ReceiptIcon, ScanLineIcon,
  SettingsIcon, ShieldIcon, TicketIcon, UsersIcon, ListIcon, ExternalLinkIcon, MegaphoneIcon, ChartColumnIcon, ClipboardCheckIcon, LinkIcon, TagIcon, GlobeIcon, type LucideIcon,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import Logo from "@/components/home/Logo";
import { cx } from "@/components/ui/styles";
import { clearOfflineScanData } from "@/lib/offline-scan-store";

/** Sign-out removes downloaded ticket lists and cached scanner pages from this device (plan 10.3). */
async function clearDeviceData() {
  await clearOfflineScanData();
  try { navigator.serviceWorker?.controller?.postMessage("fx-clear"); } catch { /* no service worker */ }
}

const ICONS: Record<string, LucideIcon> = {
  home: HomeIcon, building: BuildingIcon, users: UsersIcon, calendar: CalendarIcon, ticket: TicketIcon, receipt: ReceiptIcon,
  mail: MailIcon, settings: SettingsIcon, shield: ShieldIcon, scan: ScanLineIcon, map: MapPinIcon, list: ListIcon,
  megaphone: MegaphoneIcon, chart: ChartColumnIcon, clipboard: ClipboardCheckIcon, link: LinkIcon, tag: TagIcon, globe: GlobeIcon,
};

export interface NavItem { href: string; label: string; icon: keyof typeof ICONS; exact?: boolean; badge?: string | number }
export interface NavGroup { label?: string; items: NavItem[] }
export interface ShellUser { name: string; email: string }
export interface OrgSwitchItem { slug: string; name: string; role: string }

const menuItem = "min-h-10 rounded-[10px] text-[14px] font-medium";

/** "jane DOE" -> "Jane Doe"; words typed with mixed case (McDonald, DeVito) are left as they are */
function displayName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (w === w.toLowerCase() || w === w.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** How close to an edge (px) still counts as "at the edge", so sub-pixel scroll positions do not flicker an arrow. */
const EDGE = 2;
/** Space kept between the current page's pill and the row's edge when it is scrolled into view. */
const PEEK = 48;

/**
 * The panel's pages as pill links in one row. When there are more links than fit, the row scrolls sideways and a round
 * arrow appears on each side that has links out of view, so it reads as a slider rather than a cut-off list.
 */
function PanelNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const listRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/"));

  // which sides have links out of view: re-measured on scroll and whenever the row or its content changes size
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { left: el.scrollLeft > EDGE, right: el.scrollLeft < max - EDGE };
      setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };
    const frame = requestAnimationFrame(measure);
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [items]);

  // keep the current page's pill in view when the page changes (e.g. the last link on a phone)
  useEffect(() => {
    const el = listRef.current;
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !current) return;
    const row = el.getBoundingClientRect(), pill = current.getBoundingClientRect();
    if (pill.left < row.left + PEEK) el.scrollBy({ left: pill.left - row.left - PEEK });
    else if (pill.right > row.right - PEEK) el.scrollBy({ left: pill.right - row.right + PEEK });
  }, [pathname]);

  const slide = (dir: -1 | 1) => {
    const el = listRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
  };

  const arrow = "pointer-events-auto grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-fx-red/20 bg-white text-fx-red shadow-[0_2px_8px_rgba(168,18,26,0.12)] transition-colors hover:border-fx-red hover:bg-fx-yellow";

  return (
    <nav aria-label="Panel" className="relative min-w-0 flex-1">
      <ul ref={listRef} className="no-scrollbar flex items-center gap-1 overflow-x-auto py-2">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(item);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold whitespace-nowrap transition-colors",
                  active ? "bg-fx-red text-fx-ivory" : "text-fx-red/78 hover:bg-white hover:text-fx-red",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
                {item.badge != null ? <span className={cx("rounded-full px-2 py-[1px] text-[11px]", active ? "bg-fx-ivory/20" : "bg-fx-red/10")}>{item.badge}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* the arrows sit on a fade so the half-hidden pill under them reads as "more this way" */}
      {edges.left ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center bg-linear-to-r from-fx-ivory from-45% to-transparent pr-7">
          <button type="button" className={arrow} onClick={() => slide(-1)} aria-label="Show previous links">
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {edges.right ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center bg-linear-to-l from-fx-ivory from-45% to-transparent pl-7">
          <button type="button" className={arrow} onClick={() => slide(1)} aria-label="Show more links">
            <ChevronRightIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </nav>
  );
}

export function AppShell({
  groups, user, onSignOut, children, orgSwitcher, headerRight,
}: {
  brand: string; brandHref?: string; areaLabel: string; groups: NavGroup[]; user: ShellUser; logoUrl?: string | null;
  onSignOut: () => Promise<void>; children: ReactNode; orgSwitcher?: { current: string; items: OrgSwitchItem[] }; headerRight?: ReactNode;
}) {
  const name = displayName(user.name) || user.name;
  const email = user.email.toLowerCase();
  const initials = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?";
  const items = groups.flatMap((g) => g.items);

  return (
    <div className="fx-home fx-app min-h-dvh bg-fx-ivory text-fx-ink">
      <header className="sticky top-0 z-30 border-b border-fx-red/10 bg-fx-ivory/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1840px] items-center gap-4 px-[clamp(12px,3vw,40px)]">
          <Link href="/" className="flex shrink-0 items-center" aria-label="Fattixx home">
            <Logo height={32} />
          </Link>

          <PanelNav items={items} />

          <div className="flex shrink-0 items-center gap-2">
            {headerRight}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex min-h-12 cursor-pointer items-center gap-3 rounded-full border border-fx-red/20 bg-white py-[6px] pr-4 pl-[6px] text-[14px] font-semibold text-fx-red transition-colors hover:border-fx-red max-[641px]:pr-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-fx-yellow text-[12px] font-bold text-fx-red" aria-hidden="true">{initials}</span>
                <span className="max-w-[160px] truncate max-[641px]:hidden">{name}</span>
                <ChevronDownIcon className="size-4 shrink-0 text-fx-red/78" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel data-plain="" className="font-normal">
                    <span className="block truncate text-[14px] font-semibold text-fx-red">{name}</span>
                    <span className="block truncate text-[12px] text-fx-red/78">{email}</span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                {orgSwitcher && orgSwitcher.items.length > 1 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Switch organization</DropdownMenuLabel>
                      {orgSwitcher.items.map((o) => (
                        <DropdownMenuItem key={o.slug} className={menuItem} render={<Link href={`/org/${o.slug}`} />}>
                          <span className="flex-1 truncate">{o.name}</span>
                          {o.slug === orgSwitcher.current ? <Badge variant="outline" className="ml-2 text-[10px]">current</Badge> : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem className={menuItem} render={<Link href="/" />}><ExternalLinkIcon /> Public site</DropdownMenuItem>
                <DropdownMenuItem className={menuItem} render={<Link href="/dashboard" />}><HomeIcon /> My organizations</DropdownMenuItem>
                <DropdownMenuItem className={menuItem} render={<Link href="/account" />}><TicketIcon /> My tickets</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className={menuItem} variant="destructive" onClick={() => void clearDeviceData().finally(() => onSignOut())}><LogOutIcon /> Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

      </header>

      <main className="fx-content mx-auto w-full max-w-[1240px] px-(--pad) pt-8 pb-10 max-[641px]:pt-6 max-[641px]:pb-8">{children}</main>
    </div>
  );
}
