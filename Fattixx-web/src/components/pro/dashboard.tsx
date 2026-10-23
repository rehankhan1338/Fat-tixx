/* Building blocks of the Fattixx Pro pages in the organizer dashboard (plan 5.7.2). */

import Link from "next/link";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/styles";
import type { OrgContext } from "@/lib/authz";

/** Pill links between the pages of one Pro area (e.g. Plan / Branding / Domain). */
export function SubNav({ items, current }: { items: { href: string; label: string }[]; current: string }) {
  return (
    <nav aria-label="Section" className="flex flex-wrap gap-2">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.href === current ? "page" : undefined}
          className={cx(
            "inline-flex min-h-10 items-center rounded-full border px-4 text-[14px] font-semibold",
            i.href === current ? "border-fx-red bg-fx-red text-fx-ivory" : "border-fx-red/20 bg-white text-fx-red hover:border-fx-red",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Shown on a Pro page when the organization is not on Pro: what the feature does and where to get it. */
export function ProUpsell({ ctx, feature, text }: { ctx: OrgContext; feature: string; text: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-fx-yellow bg-fx-yellow/25 px-6 py-5">
      <div className="min-w-0 max-w-[620px]">
        <p className="flex items-center gap-2 font-display text-[18px] font-semibold text-fx-red">
          <SparklesIcon className="size-5" aria-hidden="true" /> {feature} is part of Fattixx Pro
        </p>
        <p className="mt-1 text-[15px] leading-[1.5] text-fx-red/85">{text}</p>
      </div>
      {ctx.isOrgAdmin ? (
        <Button nativeButton={false} render={<Link href={`/org/${ctx.org.slug}/pro`} />}>See Fattixx Pro</Button>
      ) : (
        <p className="text-sm text-fx-red/78">Ask your Organization Admin to upgrade.</p>
      )}
    </div>
  );
}

export const proNav = (slug: string) => [
  { href: `/org/${slug}/pro`, label: "Plan & billing" },
  { href: `/org/${slug}/pro/branding`, label: "Branding" },
  { href: `/org/${slug}/pro/domain`, label: "Custom domain" },
  { href: `/org/${slug}/pro/site`, label: "White-label site" },
];

export const emailNav = (slug: string) => [
  { href: `/org/${slug}/email`, label: "Campaigns" },
  { href: `/org/${slug}/email/audience`, label: "Contacts & audiences" },
  { href: `/org/${slug}/email/templates`, label: "Templates" },
];
