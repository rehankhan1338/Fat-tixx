"use client";

/* Follow / Requested / Following for another attendee, plus Block and Report (11.6, 11.11). */

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { followUser, setBlocked, unfollowUser } from "@/lib/social/actions";
import { reportContent } from "@/lib/social/moderation";
import { button, cx } from "@/components/ui/styles";

type State = "none" | "pending" | "active";

export function PersonFollowButton({ userId, initial, signedIn, small = false, followsYou = false }: { userId: number; initial: State; signedIn: boolean; small?: boolean; followsYou?: boolean }) {
  const [state, setState] = useState<State>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const path = usePathname();
  const router = useRouter();

  function go() {
    if (!signedIn) { router.push(`/login?next=${encodeURIComponent(path)}`); return; }
    setError(null);
    start(async () => {
      if (state === "none") {
        const r = await followUser(userId);
        if (r.ok && r.state) setState(r.state);
        else if (r.error === "profile") router.push(`/account/profile?next=${encodeURIComponent(path)}`);
        else if (r.error === "signin") router.push(`/login?next=${encodeURIComponent(path)}`);
        else setError(r.error ?? "Couldn’t follow.");
      } else {
        await unfollowUser(userId);
        setState("none");
      }
    });
  }
  const label = state === "active" ? (followsYou ? "Friends" : "Following") : state === "pending" ? "Requested" : followsYou ? "Follow back" : "Follow";
  return (
    <span className="inline-flex flex-col items-center gap-1">
      <button type="button" onClick={go} disabled={pending} aria-pressed={state !== "none"}
        className={cx(button(state === "none" ? "red" : "outline", small ? "sm" : "md"), small ? "min-w-[96px] px-4 text-[14px]" : "min-w-[132px]", "disabled:opacity-70")}>
        {label}
      </button>
      {error && <span role="alert" className="text-[13px]">{error}</span>}
    </span>
  );
}

export function BlockReportMenu({ userId, name, blocked: initialBlocked, signedIn }: { userId: number; name: string; blocked: boolean; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlockedState] = useState(initialBlocked);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!signedIn) return null;
  return (
    <div className="relative inline-block text-left">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`More options for ${name}`}
        className="grid size-11 cursor-pointer place-items-center rounded-full border border-fx-red/20 bg-white text-[20px] leading-none text-fx-red hover:border-fx-red">
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-[16px] border border-fx-red/12 bg-white p-2 text-[14px] shadow-lg">
          {!reporting ? (
            <>
              <button type="button" disabled={pending} className="block w-full cursor-pointer rounded-[10px] px-3 py-2 text-left hover:bg-fx-red/6"
                onClick={() => start(async () => { await setBlocked(userId, !blocked); setBlockedState(!blocked); setOpen(false); router.refresh(); })}>
                {blocked ? `Unblock ${name}` : `Block ${name}`}
              </button>
              <button type="button" className="block w-full cursor-pointer rounded-[10px] px-3 py-2 text-left hover:bg-fx-red/6" onClick={() => setReporting(true)}>
                Report profile
              </button>
            </>
          ) : (
            <form className="grid gap-2 p-1" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await reportContent("profile", userId, reason); setMsg(r?.error ?? r?.message ?? "Sent"); if (r?.ok) setReporting(false); }); }}>
              <label htmlFor={`rep-${userId}`} className="font-semibold">What’s wrong with this profile?</label>
              <textarea id={`rep-${userId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} required className="rounded-[10px] border border-fx-red/20 p-2" />
              <button type="submit" disabled={pending} className={cx(button("red", "sm"), "w-full")}>Send report</button>
            </form>
          )}
          {msg && <p role="status" className="px-3 py-2 text-fx-red/80">{msg}</p>}
        </div>
      )}
    </div>
  );
}
