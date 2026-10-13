"use client";

/*
 * Follow / Following for an organizer (organizer page and the event page's organizer card).
 * Preview only: the choice is remembered in this browser.
 * TODO(accounts): ask visitors to sign in first, save follows on the server, and email followers when the
 * organizer publishes a new event (only followers who agreed to emails).
 */

import { useEffect, useState } from "react";
import { CheckIcon, PlusIcon } from "@/components/event/icons";
import { button, cx } from "@/components/ui/styles";

export default function FollowButton({ organizerId, name, className }: { organizerId: string; name: string; className?: string }) {
  const key = `fx-follow-${organizerId}`;
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        setFollowing(localStorage.getItem(key) === "1");
      } catch {
        /* storage blocked: start as not following */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [key]);

  function toggle() {
    const next = !following;
    setFollowing(next);
    try {
      if (next) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    } catch {
      /* storage blocked: the button still switches for this visit */
    }
  }

  return (
    <button type="button" onClick={toggle} className={cx(button(following ? "outline" : "red"), "min-w-[132px]", className)}>
      {following ? <CheckIcon size={18} /> : <PlusIcon size={18} />}
      {following ? "Following" : "Follow"}
      <span className="sr-only"> {name}</span>
    </button>
  );
}
