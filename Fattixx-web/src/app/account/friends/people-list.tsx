"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { answerFollowRequest, followUser, setBlocked, unfollowUser } from "@/lib/social/actions";
import { Button } from "@/components/ui/button";

type Person = { id: number; username: string; name: string; avatar: string | null; initials: string; city?: string | null; state: "none" | "pending" | "active" };

export function PeopleList({ people, mode }: { people: Person[]; mode: "search" | "requests" | "following" | "followers" | "blocked" }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    const r = await fn();
    if (!r.ok) toast.error(r.error ?? "Couldn’t do that.");
    router.refresh();
  });
  return (
    <ul className="divide-y rounded-lg border">
      {people.map((p) => (
        <li key={p.id} className="flex items-center gap-3 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- uploaded image */}
          {p.avatar ? <img src={p.avatar} alt="" className="size-10 rounded-full object-cover" /> : <span className="grid size-10 place-items-center rounded-full bg-muted text-sm font-semibold">{p.initials}</span>}
          <div className="min-w-0 flex-1">
            <Link href={`/u/${p.username}`} className="block truncate font-medium hover:underline">{p.name}</Link>
            <span className="block truncate text-xs text-muted-foreground">@{p.username}{p.city ? ` · ${p.city}` : ""}</span>
          </div>
          <div className="flex shrink-0 gap-2">
            {mode === "requests" ? (
              <>
                <Button size="sm" disabled={pending} onClick={() => act(() => answerFollowRequest(p.id, true))}>Approve</Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => answerFollowRequest(p.id, false))}>Decline</Button>
              </>
            ) : mode === "blocked" ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => setBlocked(p.id, false))}>Unblock</Button>
            ) : (
              <>
                {p.state === "none" ? (
                  <Button size="sm" disabled={pending} onClick={() => act(async () => { const r = await followUser(p.id); return { ok: r.ok, error: r.error }; })}>{mode === "followers" ? "Follow back" : "Follow"}</Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => unfollowUser(p.id))}>{p.state === "pending" ? "Cancel request" : "Unfollow"}</Button>
                )}
                {mode === "followers" ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => answerFollowRequest(p.id, false))}>Remove</Button> : null}
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
