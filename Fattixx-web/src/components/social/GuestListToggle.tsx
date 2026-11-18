"use client";

/* "Show me on the guest list" for one event (11.4): on the event page, the order confirmation and the ticket page. */

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setGuestListChoice } from "@/lib/social/actions";

export default function GuestListToggle({ eventId, initial, hasProfile }: { eventId: number; initial: boolean; hasProfile: boolean }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const path = usePathname();
  const router = useRouter();
  if (!hasProfile) {
    return (
      <p className="text-[14px] text-fx-red/80">
        Want to show up on the guest list?{" "}
        <Link href={`/account/profile?next=${encodeURIComponent(path)}`} className="font-semibold text-fx-red underline underline-offset-[3px]">
          Set up your profile
        </Link>
        .
      </p>
    );
  }
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-[15px]">
      <span>
        <b className="font-semibold">Show me on the guest list</b>
        <span className="block text-[13px] text-fx-red/70">Your name and photo only. Never your tickets or order.</span>
        {error && <span role="alert" className="block text-[13px]">{error}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="size-5 shrink-0 cursor-pointer accent-fx-red"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          setError(null);
          start(async () => {
            const r = await setGuestListChoice(eventId, next);
            if (!r.ok) { setOn(!next); setError(r.error === "profile" ? "Set up your profile first." : r.error ?? "Couldn’t save."); }
            else router.refresh();
          });
        }}
      />
    </label>
  );
}
