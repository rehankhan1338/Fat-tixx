import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicEventBySlug, publicEventPath } from "@/lib/events/queries";
import { eventUnlocked } from "@/lib/events/password";
import { getSession } from "@/lib/auth/session";
import { goingLine, whosGoing } from "@/lib/social/queries";
import { followingIds } from "@/lib/social/core";
import { PublicPage } from "@/components/layout/PublicPage";
import PersonAvatar from "@/components/social/PersonAvatar";
import { PersonFollowButton } from "@/components/social/PersonActions";
import { container, cx, sectionTitle } from "@/components/ui/styles";

/* The full Who's Going list (11.4): everyone who lets the guest list show them, people you follow first. */
export const metadata: Metadata = { title: "Who’s going", robots: { index: false, follow: false } };

export default async function GoingPage({ params, searchParams }: PageProps<"/events/[slug]/going">) {
  const { slug } = await params;
  const sp = await searchParams;
  const event = await getPublicEventBySlug(slug);
  if (!event || !["published", "postponed", "completed"].includes(event.status)) notFound();
  const key = typeof sp.key === "string" ? sp.key : null;
  if (event.visibility === "private" && (!event.private_key || key !== event.private_key)) notFound();
  if (!(await eventUnlocked(event))) notFound();
  const session = await getSession();
  const viewerId = session?.user.id ?? null;
  const data = await whosGoing(event, viewerId, 500);
  if (data.mode === "off" || data.hidden) notFound();
  const following = new Set(viewerId ? await followingIds(viewerId) : []);
  const back = publicEventPath(event);

  return (
    <PublicPage>
      <main className={cx(container, "max-w-[820px] pt-[128px] pb-24 text-fx-red max-[901px]:pt-[104px]")}>
        <Link href={back} className="text-[14px] font-semibold underline underline-offset-[3px]">← {event.title}</Link>
        <h1 className={cx(sectionTitle, "mt-4 text-[clamp(32px,4vw,46px)] leading-[1.05] tracking-[-0.03em]")}>Who’s going</h1>
        <p className="mt-2 text-[16px] text-fx-red/80">{goingLine(data) || "Nobody on the guest list yet."}</p>
        <ul className="mt-8 grid gap-3">
          {data.people.map((p) => (
            <li key={p.id} className="flex items-center gap-4 rounded-[18px] border border-fx-red/10 bg-white px-4 py-3">
              <PersonAvatar src={p.avatar} name={p.name} initials={p.initials} size={48} />
              <div className="min-w-0 flex-1">
                <Link href={`/u/${p.username}`} className="block truncate text-[16px] font-semibold hover:underline">{p.name}</Link>
                <span className="block truncate text-[14px] text-fx-red/70">@{p.username}{p.city ? ` · ${p.city}` : ""}</span>
              </div>
              {viewerId !== p.id && <PersonFollowButton userId={p.id} initial={following.has(p.id) ? "active" : "none"} signedIn={!!session} small />}
            </li>
          ))}
        </ul>
        {data.mode === "faces_total" && data.total != null && data.total > data.listed && (
          <p className="mt-6 text-[14px] text-fx-red/70">{data.total - data.listed} more {data.total - data.listed === 1 ? "person keeps" : "people keep"} their name off the list.</p>
        )}
      </main>
    </PublicPage>
  );
}
