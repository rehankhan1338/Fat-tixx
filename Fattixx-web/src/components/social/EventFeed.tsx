"use client";

/*
 * Event activity feed (11.7) on the event page, for signed-in ticket holders and the organizer's team. Posts, threaded
 * replies and emoji reactions; organizer alerts are pinned; the organizer's team can pin, delete, mute and remove people.
 */

import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { FeedPost } from "@/lib/social/feed";
import { createPost, deletePost, fetchFeed, moderateMember, react, setFeedNotificationsMuted, setPinned } from "@/lib/social/feed-actions";
import { reportContent } from "@/lib/social/moderation";
import { button, cx } from "@/components/ui/styles";
import PersonAvatar from "./PersonAvatar";

const REACTIONS = ["❤️", "🔥", "🙌", "😂", "😮", "👍"];

export type FeedAccessView = {
  canView: boolean; canPost: boolean; moderator: boolean; readOnly: boolean; notificationsMuted: boolean;
  reason: "off" | "signin" | "holders" | "profile" | "removed" | "muted" | null;
};

function ago(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function EventFeed({ eventId, initial, access, allowPhotos, closesText }: {
  eventId: number; initial: FeedPost[]; access: FeedAccessView; allowPhotos: boolean; closesText: string;
}) {
  const [posts, setPosts] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(access.notificationsMuted);
  const [more, setMore] = useState(initial.length >= 30);
  const [pending, start] = useTransition();
  const path = usePathname();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; posts?: FeedPost[] }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else if (r.posts) setPosts(r.posts);
    });
  };

  if (!access.canView) {
    const msg = access.reason === "signin"
      ? <>Ticket holders can see the event feed. <Link href={`/login?next=${encodeURIComponent(path)}`} className="font-semibold underline underline-offset-[3px]">Sign in</Link> to join.</>
      : access.reason === "removed" ? "The organizer removed you from this feed." : "The event feed is for ticket holders.";
    return (
      <section id="feed" aria-labelledby="feed-h" className="scroll-mt-[104px] text-fx-red">
        <h2 id="feed-h" className="font-display text-[28px] font-semibold tracking-[-0.02em]">Event feed</h2>
        <p className="mt-3 rounded-[18px] border border-fx-red/10 bg-white px-5 py-4 text-[15px] text-fx-red/80">{msg}</p>
      </section>
    );
  }

  return (
    <section id="feed" aria-labelledby="feed-h" className="scroll-mt-[104px] text-fx-red">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="feed-h" className="font-display text-[28px] font-semibold tracking-[-0.02em]">Event feed</h2>
        {!access.moderator && (
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-fx-red/80">
            <input type="checkbox" className="accent-fx-red" checked={muted} onChange={(e) => { const v = e.target.checked; setMuted(v); void setFeedNotificationsMuted(eventId, v); }} />
            Mute notifications
          </label>
        )}
      </div>
      <p className="mt-1 text-[14px] text-fx-red/70">{access.readOnly ? "This feed is read-only now." : closesText}</p>

      {access.canPost ? (
        <Composer eventId={eventId} moderator={access.moderator} allowPhotos={allowPhotos || access.moderator} pending={pending} onPosted={(p) => setPosts(p)} onError={setError} />
      ) : access.reason === "profile" ? (
        <p className="mt-4 rounded-[18px] border border-fx-red/10 bg-white px-5 py-4 text-[15px]">
          <Link href={`/account/profile?next=${encodeURIComponent(path)}`} className="font-semibold underline underline-offset-[3px]">Set up your profile</Link> to post and reply.
        </p>
      ) : access.reason === "muted" ? (
        <p className="mt-4 text-[14px] text-fx-red/70">The organizer turned off posting for you in this feed.</p>
      ) : null}
      {error && <p role="alert" className="mt-3 text-[14px]">{error}</p>}

      <ol className="mt-6 grid gap-4">
        {posts.length === 0 && <li className="rounded-[18px] border border-dashed border-fx-red/20 px-5 py-8 text-center text-[15px] text-fx-red/70">No posts yet. Say hi!</li>}
        {posts.map((p) => (
          <li key={p.id}>
            <Post p={p} eventId={eventId} access={access} pending={pending} run={run} />
          </li>
        ))}
      </ol>
      {more && posts.length > 0 && (
        <button type="button" disabled={pending} className={cx(button("outline", "sm"), "mt-4")}
          onClick={() => start(async () => {
            const last = [...posts].filter((x) => !x.pinned).at(-1);
            const r = await fetchFeed(eventId, last?.id);
            if (r.posts) { setPosts((cur) => [...cur, ...r.posts!.filter((n) => !cur.some((c) => c.id === n.id))]); setMore(r.posts.length >= 30); }
          })}>
          Load more
        </button>
      )}
    </section>
  );
}

function Composer({ eventId, moderator, allowPhotos, pending, onPosted, onError, parentId, compact = false }: {
  eventId: number; moderator: boolean; allowPhotos: boolean; pending: boolean; onPosted: (p: FeedPost[]) => void; onError: (e: string | null) => void; parentId?: number; compact?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [busy, start] = useTransition();
  return (
    <form ref={form} className={cx("grid gap-3", compact ? "mt-3" : "mt-4 rounded-[18px] border border-fx-red/10 bg-white p-4")}
      action={(fd) => start(async () => {
        onError(null);
        const r = await createPost(fd);
        if (r.ok && r.posts) { onPosted(r.posts); form.current?.reset(); } else onError(r.error ?? "Couldn’t post.");
      })}>
      <input type="hidden" name="event_id" value={eventId} />
      {parentId ? <input type="hidden" name="parent_id" value={parentId} /> : null}
      <label className="sr-only" htmlFor={`body-${parentId ?? "top"}`}>{parentId ? "Write a reply" : "Write a post"}</label>
      <textarea id={`body-${parentId ?? "top"}`} name="body" required maxLength={2000} rows={compact ? 2 : 3}
        placeholder={parentId ? "Write a reply…" : moderator ? "Post an update for ticket holders…" : "Say something to other ticket holders…"}
        className="w-full rounded-[14px] border border-fx-red/20 bg-fx-ivory/40 p-3 text-[15px] outline-none focus:border-fx-red" />
      <div className="flex flex-wrap items-center gap-3">
        {!parentId && allowPhotos && (
          <label className="cursor-pointer text-[14px] font-semibold underline underline-offset-[3px]">
            Add photo<input type="file" name="image" accept="image/jpeg,image/png,image/webp" className="sr-only" />
          </label>
        )}
        {!parentId && moderator && (
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="alert" className="accent-fx-red" /> Alert (pinned, emailed to ticket holders)</label>
        )}
        <button type="submit" disabled={busy || pending} className={cx(button("red", "sm"), "ml-auto disabled:opacity-60")}>{busy ? "Posting…" : parentId ? "Reply" : "Post"}</button>
      </div>
    </form>
  );
}

function Post({ p, eventId, access, pending, run, reply = false }: {
  p: FeedPost; eventId: number; access: FeedAccessView; pending: boolean; run: (fn: () => Promise<{ ok: boolean; error?: string; posts?: FeedPost[] }>) => void; reply?: boolean;
}) {
  const [replying, setReplying] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const a = p.author;
  const name = a.username && !a.organizer ? <Link href={`/u/${a.username}`} className="font-semibold hover:underline">{a.name}</Link> : <b className="font-semibold">{a.name}</b>;
  const canReact = access.canView && !access.readOnly && access.reason !== "muted";
  return (
    <article className={cx(reply ? "mt-3 border-l-2 border-fx-red/10 pl-4" : "rounded-[18px] border bg-white p-4", !reply && (p.kind === "alert" ? "border-fx-yellow bg-fx-yellow/15" : "border-fx-red/10"))}>
      <header className="flex items-start gap-3">
        <PersonAvatar src={a.avatar} name={a.name} initials={a.initials} size={reply ? 32 : 40} />
        <div className="min-w-0 flex-1 text-[14px]">
          <p className="flex flex-wrap items-center gap-x-2">
            {name}
            {a.organizer && <span className="rounded-full bg-fx-red px-2 py-[1px] text-[11px] font-semibold text-fx-ivory">Organizer</span>}
            {p.kind === "alert" && <span className="rounded-full bg-fx-yellow px-2 py-[1px] text-[11px] font-semibold">Alert</span>}
            {p.kind === "update" && <span className="rounded-full bg-fx-red/10 px-2 py-[1px] text-[11px] font-semibold">Event update</span>}
            {p.pinned && p.kind !== "alert" && <span className="text-[12px] text-fx-red/70">Pinned</span>}
            <span className="text-fx-red/60"><time dateTime={p.createdAt}>{ago(p.createdAt)}</time></span>
          </p>
        </div>
        {access.canView && (
          <div className="relative">
            <button type="button" aria-label="Post options" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="cursor-pointer rounded-full px-2 text-[18px] leading-none text-fx-red/70 hover:text-fx-red">⋯</button>
            {menu && (
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-[14px] border border-fx-red/12 bg-white p-1 text-[14px] shadow-lg">
                {(p.mine || access.moderator) && <MenuItem onClick={() => { setMenu(false); if (confirm("Delete this post?")) run(() => deletePost(eventId, p.id)); }}>Delete</MenuItem>}
                {access.moderator && !reply && <MenuItem onClick={() => { setMenu(false); run(() => setPinned(eventId, p.id, !p.pinned)); }}>{p.pinned ? "Unpin" : "Pin to top"}</MenuItem>}
                {access.moderator && a.id && !a.organizer && (
                  <>
                    <MenuItem onClick={() => { setMenu(false); run(() => moderateMember(eventId, a.id!, "muted")); }}>Mute {a.name.split(" ")[0]} (can read, can’t post)</MenuItem>
                    <MenuItem onClick={() => { setMenu(false); if (confirm(`Remove ${a.name} from this feed? Their posts are removed too.`)) run(() => moderateMember(eventId, a.id!, "removed")); }}>Remove from feed</MenuItem>
                  </>
                )}
                {!p.mine && <MenuItem onClick={() => { setMenu(false); setReporting(true); }}>Report</MenuItem>}
              </div>
            )}
          </div>
        )}
      </header>
      <p className="mt-2 text-[15px] leading-[1.55] break-words whitespace-pre-wrap">{p.body}</p>
      {p.image && (
        // eslint-disable-next-line @next/next/no-img-element -- uploaded image, already resized to WebP
        <img src={p.image} alt="" className="mt-3 max-h-[480px] w-full rounded-[14px] object-cover" loading="lazy" />
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {REACTIONS.map((e) => {
          const r = p.reactions.find((x) => x.emoji === e);
          if (!r && !canReact) return null;
          return (
            <button key={e} type="button" disabled={!canReact || pending} aria-pressed={!!r?.mine} aria-label={`React ${e}`}
              onClick={() => run(() => react(eventId, p.id, e))}
              className={cx("inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full border px-2 text-[14px] disabled:cursor-default",
                r?.mine ? "border-fx-red bg-fx-red/8" : r ? "border-fx-red/20 bg-white" : "border-transparent opacity-50 hover:opacity-100")}>
              {e}{r ? <span className="text-[12px] tabular-nums">{r.count}</span> : null}
            </button>
          );
        })}
        {!reply && access.canPost && (
          <button type="button" className="ml-2 cursor-pointer text-[14px] font-semibold text-fx-red/80 hover:text-fx-red" onClick={() => setReplying((r) => !r)}>Reply</button>
        )}
      </div>
      {reporting && (
        <form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); void reportContent("post", p.id, reason).then((r) => { setNote(r?.error ?? r?.message ?? "Sent"); if (r?.ok) setReporting(false); }); }}>
          <label htmlFor={`rp-${p.id}`} className="text-[14px] font-semibold">What’s wrong with this post?</label>
          <textarea id={`rp-${p.id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} required className="rounded-[10px] border border-fx-red/20 p-2 text-[14px]" />
          <div className="flex gap-2"><button type="submit" className={button("red", "sm")}>Send report</button><button type="button" className={button("outline", "sm")} onClick={() => setReporting(false)}>Cancel</button></div>
        </form>
      )}
      {note && <p role="status" className="mt-2 text-[13px] text-fx-red/80">{note}</p>}
      {p.replies.map((r) => <Post key={r.id} p={r} eventId={eventId} access={access} pending={pending} run={run} reply />)}
      {replying && (
        <Composer eventId={eventId} moderator={access.moderator} allowPhotos={false} pending={pending} parentId={p.id} compact
          onPosted={(posts) => { setReplying(false); run(async () => ({ ok: true, posts })); }}
          onError={(e) => setNote(e)} />
      )}
    </article>
  );
}

function MenuItem({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="block w-full cursor-pointer rounded-[10px] px-3 py-2 text-left hover:bg-fx-red/6">{children}</button>;
}
