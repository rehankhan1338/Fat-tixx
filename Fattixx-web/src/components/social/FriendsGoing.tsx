"use client";

/* "3 friends going" on event cards (11.6): the counts come from the page; tiles outside the provider show nothing. */

import { createContext, useContext, type ReactNode } from "react";

const Ctx = createContext<Record<number, number> | null>(null);

export function FriendsGoingProvider({ counts, children }: { counts: Record<number, number>; children: ReactNode }) {
  return <Ctx.Provider value={counts}>{children}</Ctx.Provider>;
}

export function FriendsGoingBadge({ eventId }: { eventId: number }) {
  const counts = useContext(Ctx);
  const n = counts?.[eventId] ?? 0;
  if (!n) return null;
  return (
    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-fx-yellow/60 px-2 py-[2px] text-[12px] font-semibold text-fx-red">
      {n} {n === 1 ? "friend" : "friends"} going
    </span>
  );
}
