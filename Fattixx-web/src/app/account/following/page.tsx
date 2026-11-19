import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { listFollowedOrgs } from "@/lib/social/queries";
import { uploadUrl } from "@/lib/uploads";
import { EmptyState, PageHeader, Section } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { AccountNav } from "../account-nav";
import { OrgFollowControls } from "./org-follow-controls";

export const metadata: Metadata = { title: "Organizers you follow", robots: { index: false } };

/* Organizers the attendee follows (11.5): mute without unfollowing, or unfollow. */
export default async function FollowingPage() {
  const session = await requireSession();
  const orgs = await listFollowedOrgs(session.user.id);
  return (
    <PublicShell>
      <PageHeader title="Organizers you follow" description="You get one email (and a text, if you turned texts on) when an organizer you follow announces a new public event." />
      <AccountNav active="following" />
      <div className="mt-6">
        {orgs.length === 0 ? (
          <EmptyState title="You don’t follow any organizers yet" description="Tap Follow on an organizer’s page or an event page to hear about their next event." action={<Button render={<Link href="/events" />}>Browse events</Button>} />
        ) : (
          <Section>
            <ul className="divide-y rounded-lg border">
              {orgs.map((o) => (
                <li key={o.slug} className="flex flex-wrap items-center gap-3 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- uploaded image */}
                  {o.logo_path ? <img src={uploadUrl(o.logo_path)!} alt="" className="size-10 rounded-full object-cover" /> : <span className="grid size-10 place-items-center rounded-full bg-muted text-sm font-semibold">{o.name.slice(0, 2).toUpperCase()}</span>}
                  <Link href={`/o/${o.slug}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{o.name}</Link>
                  <OrgFollowControls slug={o.slug} muted={!!Number(o.muted)} />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </PublicShell>
  );
}
