import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { query, type Row } from "@/lib/db";
import { listPublicEventsByIds } from "@/lib/social/profile-events";
import { profileView } from "@/lib/social/queries";
import { handleUrl } from "@/lib/social/core";
import { PublicPage } from "@/components/layout/PublicPage";
import EventTile from "@/components/events/EventTile";
import PersonAvatar from "@/components/social/PersonAvatar";
import { BlockReportMenu, PersonFollowButton } from "@/components/social/PersonActions";
import { listUpcoming } from "@/lib/home/events";
import { button, container, cx, sectionTitle } from "@/components/ui/styles";

/*
 * Attendee profile (11.3): photo, name, @username, bio, city, Instagram / TikTok / X, and — only with "Show events I'm
 * attending" on — the public events they're going to and went to. Never ticket types, prices, orders or QR codes.
 */
export async function generateMetadata({ params }: PageProps<"/u/[username]">): Promise<Metadata> {
  const { username } = await params;
  const p = await profileView(username, null);
  if (!p) return { title: "Profile not found", robots: { index: false } };
  return { title: `${p.user.name} (@${p.user.username})`, robots: { index: !p.limited, follow: false } };
}

export default async function ProfilePage({ params }: PageProps<"/u/[username]">) {
  const { username } = await params;
  const session = await getSession();
  const p = await profileView(username, session?.user.id ?? null);
  if (!p) notFound();
  const u = p.user;
  const ids = p.eventIds ? [...p.eventIds.upcoming, ...p.eventIds.past] : [];
  const items = ids.length ? await listPublicEventsByIds(ids) : [];
  const upcoming = listUpcoming(items.filter((e) => p.eventIds!.upcoming.includes(e.id)), null);
  const past = listUpcoming(items.filter((e) => p.eventIds!.past.includes(e.id)), null).reverse();
  const mutualCount = session && !p.isMe ? await mutualFriends(session.user.id, u.id) : 0;
  const links = ([["instagram", u.instagram, "Instagram"], ["tiktok", u.tiktok, "TikTok"], ["x", u.x, "X"]] as const).filter(([, h]) => h);

  return (
    <PublicPage>
      <main className={cx(container, "max-w-[1120px] pt-[136px] pb-24 text-fx-red max-[901px]:pt-[116px]")}>
        <header className="text-center">
          <div className="mx-auto w-fit"><PersonAvatar src={u.avatar} name={u.name} initials={u.initials} size={120} /></div>
          <h1 className="mt-6 font-display text-[clamp(32px,4vw,46px)] leading-[1.05] font-semibold tracking-[-0.03em]">{u.name}</h1>
          <p className="mt-1 text-[16px] text-fx-red/75">@{u.username}{!p.limited && u.city ? ` · ${u.city}` : ""}</p>
          <p className="mt-3 text-[15px]">
            <b className="tabular-nums">{p.followers}</b> {p.followers === 1 ? "follower" : "followers"} · <b className="tabular-nums">{p.following}</b> following
            {mutualCount > 0 && <span className="text-fx-red/70"> · {mutualCount} mutual {mutualCount === 1 ? "friend" : "friends"}</span>}
          </p>
          <div className="mt-6 flex items-start justify-center gap-3">
            {p.isMe ? (
              <>
                <Link href="/account/profile" className={button("outline")}>Edit profile</Link>
                <Link href="/account/friends" className={button("outline")}>Friends</Link>
              </>
            ) : p.viewerBlocked ? (
              <p className="text-[15px] text-fx-red/80">You blocked {u.name.split(" ")[0]}.</p>
            ) : (
              <PersonFollowButton userId={u.id} initial={p.viewerFollows} signedIn={!!session} followsYou={p.followsViewer} />
            )}
            {!p.isMe && <BlockReportMenu userId={u.id} name={u.name.split(" ")[0]} blocked={p.viewerBlocked} signedIn={!!session} />}
          </div>
          {p.followsViewer && !p.isMe && <p className="mt-3 text-[13px] text-fx-red/70">Follows you</p>}
          {p.limited ? (
            <p className="mx-auto mt-8 max-w-[480px] rounded-[18px] border border-fx-red/10 bg-white px-5 py-4 text-[15px]">
              This profile is private. {p.needsApproval ? "Follow to send a request." : "Follow to see more."}
            </p>
          ) : (
            <>
              {u.bio && <p className="mx-auto mt-8 max-w-[560px] text-[16px] leading-[1.6] text-fx-red/85">{u.bio}</p>}
              {links.length > 0 && (
                <ul className="mt-6 flex flex-wrap justify-center gap-2">
                  {links.map(([net, handle, label]) => (
                    <li key={net}>
                      <a href={handleUrl(net, handle!)} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-11 items-center rounded-full border border-fx-red/20 bg-white px-4 text-[14px] font-semibold hover:border-fx-red">
                        {label} · @{handle}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </header>

        {!p.limited && p.eventIds && (
          <>
            <section aria-labelledby="up-h" className="mt-16 border-t border-fx-red/12 pt-12">
              <h2 id="up-h" className={cx(sectionTitle, "text-[clamp(24px,2.6vw,32px)]")}>Going to</h2>
              {upcoming.length ? (
                <div className="mt-8 grid grid-cols-4 gap-x-6 gap-y-10 max-[1101px]:grid-cols-3 max-[721px]:grid-cols-2 max-[721px]:gap-x-4">
                  {upcoming.map((e) => <EventTile key={e.id} e={e} />)}
                </div>
              ) : <p className="mt-4 text-[15px] text-fx-red/70">No upcoming events on the profile.</p>}
            </section>
            {past.length > 0 && (
              <section aria-labelledby="past-h" className="mt-16">
                <h2 id="past-h" className={cx(sectionTitle, "text-[clamp(24px,2.6vw,32px)]")}>Went to</h2>
                <div className="mt-8 grid grid-cols-4 gap-x-6 gap-y-10 max-[1101px]:grid-cols-3 max-[721px]:grid-cols-2 max-[721px]:gap-x-4">
                  {past.slice(0, 12).map((e) => <EventTile key={e.id} e={e} />)}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </PublicPage>
  );
}

async function mutualFriends(viewerId: number, targetId: number): Promise<number> {
  const r = await query<Row & { n: number }>(
    `SELECT COUNT(*) AS n FROM user_follows a
       JOIN user_follows b ON b.follower_id = a.followee_id AND b.followee_id = a.follower_id AND b.status = 'active'
       JOIN user_follows c ON c.follower_id = ? AND c.followee_id = a.followee_id AND c.status = 'active'
       JOIN user_follows d ON d.follower_id = a.followee_id AND d.followee_id = ? AND d.status = 'active'
      WHERE a.follower_id = ? AND a.status = 'active'`, [targetId, targetId, viewerId],
  );
  return Number(r[0]?.n ?? 0);
}
