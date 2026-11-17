"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOrgFollow, setOrgMuted } from "@/lib/social/actions";
import { Button } from "@/components/ui/button";

export function OrgFollowControls({ slug, muted }: { slug: string; muted: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { await setOrgMuted(slug, !muted); router.refresh(); })}>{muted ? "Unmute" : "Mute"}</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { await setOrgFollow(slug, false); router.refresh(); })}>Unfollow</Button>
    </div>
  );
}
