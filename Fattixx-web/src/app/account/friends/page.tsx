import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { env } from "@/lib/env";
import { getSocialUser, hasProfile } from "@/lib/social/core";
import { listBlocked, listFollowRequests, listFollowers, listFollowing, searchPeople } from "@/lib/social/queries";
import { CopyButton } from "@/components/copy-button";
import { EmptyState, PageHeader, Section } from "@/components/shared";
import { PublicShell } from "@/components/public-shell";
import { Button } from "@/components/ui/button";
import { AccountNav } from "../account-nav";
import { PeopleList } from "./people-list";

export const metadata: Metadata = { title: "Friends", robots: { index: false } };

/* Following other attendees (11.6): requests, followers, following, find friends by name or username, invite link, blocked. */
export default async function FriendsPage({ searchParams }: PageProps<"/account/friends">) {
  const session = await requireSession();
  const sp = await searchParams;
  const me = await getSocialUser(session.user.id);
  const q = typeof sp.q === "string" ? sp.q : "";
  if (!hasProfile(me)) {
    return (
      <PublicShell>
        <PageHeader title="Friends" />
        <AccountNav active="friends" />
        <div className="mt-6"><EmptyState title="Set up your profile first" description="Following other attendees and seeing which friends are going needs a profile." action={<Button render={<Link href="/account/profile?next=/account/friends" />}>Create my profile</Button>} /></div>
      </PublicShell>
    );
  }
  const [requests, followers, following, blocked, results] = await Promise.all([
    listFollowRequests(me.id), listFollowers(me.id), listFollowing(me.id), listBlocked(me.id), q ? searchPeople(q, me.id) : Promise.resolve([]),
  ]);
  const followingIds = new Set(following.filter((f) => !f.pending).map((f) => f.id));
  const pendingIds = new Set(following.filter((f) => f.pending).map((f) => f.id));
  const friends = following.filter((f) => f.mutual);
  const invite = `${env.APP_URL}/u/${me.username}`;
  return (
    <PublicShell>
      <PageHeader title="Friends" description="When two people follow each other, they’re friends. Friends who are going show first on Who’s Going and on event cards." />
      <AccountNav active="friends" />
      <div className="mt-6 space-y-8">
        <Section title="Find friends">
          <form className="flex gap-2" action="/account/friends">
            <input name="q" defaultValue={q} placeholder="Name or @username" aria-label="Search people" className="h-9 flex-1 rounded-md border bg-transparent px-3 text-sm" minLength={2} />
            <Button type="submit" variant="outline">Search</Button>
          </form>
          {q ? (results.length ? <div className="mt-4"><PeopleList people={results.map((p) => ({ ...p, state: p.state }))} mode="search" /></div> : <p className="mt-4 text-sm text-muted-foreground">Nobody found for “{q}”.</p>) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Invite friends with your profile link:</span>
            <code className="rounded bg-muted px-2 py-1">{invite}</code>
            <CopyButton value={invite} label="Copy link" />
          </div>
        </Section>
        {requests.length ? (
          <Section title={`Follow requests (${requests.length})`}>
            <PeopleList people={requests.map((p) => ({ ...p, state: "none" as const }))} mode="requests" />
          </Section>
        ) : null}
        <Section title={`Friends (${friends.length})`}>
          {friends.length ? <PeopleList people={friends.map((p) => ({ ...p, state: "active" as const }))} mode="following" /> : <p className="text-sm text-muted-foreground">Follow people back to become friends.</p>}
        </Section>
        <Section title={`Following (${following.length})`}>
          {following.length ? <PeopleList people={following.map((p) => ({ ...p, state: p.pending ? "pending" as const : "active" as const }))} mode="following" /> : <p className="text-sm text-muted-foreground">Nobody yet.</p>}
        </Section>
        <Section title={`Followers (${followers.length})`}>
          {followers.length ? <PeopleList people={followers.map((p) => ({ ...p, state: followingIds.has(p.id) ? "active" as const : pendingIds.has(p.id) ? "pending" as const : "none" as const }))} mode="followers" /> : <p className="text-sm text-muted-foreground">Nobody yet.</p>}
        </Section>
        {blocked.length ? (
          <Section title="Blocked" description="Blocked people can’t see your profile or posts, or follow you.">
            <PeopleList people={blocked.map((p) => ({ ...p, state: "none" as const }))} mode="blocked" />
          </Section>
        ) : null}
      </div>
    </PublicShell>
  );
}
