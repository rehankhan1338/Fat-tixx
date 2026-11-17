import Link from "next/link";
import { cn } from "@/lib/utils";

const ITEMS = [
  { key: "tickets", href: "/account", label: "Tickets" },
  { key: "profile", href: "/account/profile", label: "Profile & privacy" },
  { key: "friends", href: "/account/friends", label: "Friends" },
  { key: "following", href: "/account/following", label: "Organizers" },
  { key: "referrals", href: "/account/referrals", label: "Referral rewards" },
] as const;

/** Tabs across the account pages. */
export function AccountNav({ active }: { active: (typeof ITEMS)[number]["key"] }) {
  return (
    <nav aria-label="Account" className="no-scrollbar mt-4 flex gap-1 overflow-x-auto border-b">
      {ITEMS.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.key === active ? "page" : undefined}
          className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium", i.key === active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
