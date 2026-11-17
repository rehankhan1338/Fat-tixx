"use client";

/*
 * Follow / Following for an organizer (organizer page, the event page's host card and organizer card, the order page).
 * Saved on the server (org_follows); followers get one email when the organizer publishes a new public event
 * (src/lib/social/notify.ts). Signed-out visitors are sent to sign in and come back to the same page.
 */

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { setOrgFollow } from "@/lib/social/actions";
import { CheckIcon, PlusIcon } from "@/components/event/icons";
import { button, cx } from "@/components/ui/styles";

export default function FollowButton({
  organizerId, name, className, initialFollowing = false, signedIn = false, source = "page", followers = null, compact = false,
}: {
  /** organization slug */
  organizerId: string; name: string; className?: string; initialFollowing?: boolean; signedIn?: boolean; source?: string;
  /** follower count to show under the button (null = hidden by the organizer, or not shown here) */
  followers?: number | null; compact?: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(followers);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const path = usePathname();
  const router = useRouter();

  function toggle() {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(path + window.location.search)}`);
      return;
    }
    const next = !following;
    setFollowing(next);
    setError(null);
    start(async () => {
      const r = await setOrgFollow(organizerId, next, source);
      if (!r.ok) {
        setFollowing(!next);
        if (r.error === "signin") router.push(`/login?next=${encodeURIComponent(path)}`);
        else setError(r.error ?? "Couldn’t save that. Try again.");
        return;
      }
      setCount((c) => (c == null ? c : Math.max(0, c + (next ? 1 : -1))));
    });
  }

  return (
    <span className={cx("inline-flex flex-col items-center", compact ? "" : "gap-1")}>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={following}
        className={cx(compact ? button(following ? "outline" : "red", "sm") : button(following ? "outline" : "red"), compact ? "min-w-[104px] px-4 text-[14px]" : "min-w-[132px]", "disabled:opacity-70", className)}
      >
        {following ? <CheckIcon size={compact ? 16 : 18} /> : <PlusIcon size={compact ? 16 : 18} />}
        {following ? "Following" : "Follow"}
        <span className="sr-only"> {name}</span>
      </button>
      {count != null && !compact && (
        <span className="text-[13px] text-fx-red/70 tabular-nums">
          {count.toLocaleString()} {count === 1 ? "follower" : "followers"}
        </span>
      )}
      {error && <span role="alert" className="text-[13px] text-fx-red">{error}</span>}
    </span>
  );
}
