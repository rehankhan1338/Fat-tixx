"use client";

import { useEffect, useState } from "react";
import { liveCounts } from "@/lib/checkin/actions";
import { Stat } from "@/components/shared";

/** "Checked in" tile that refreshes every 15 s (same cadence as the scanner) while the tab is visible. */
export function LiveCheckinStat({ orgSlug, eventId, initial }: { orgSlug: string; eventId: number; initial: { total: number; used: number } }) {
  const [counts, setCounts] = useState(initial);
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") liveCounts(orgSlug, eventId).then(setCounts).catch(() => {}); };
    const iv = setInterval(tick, 15000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", tick); };
  }, [orgSlug, eventId]);
  const pct = counts.total ? Math.round((counts.used / counts.total) * 100) : null;
  return (
    <Stat
      label="Checked in"
      value={<>{counts.used}<span className="text-base font-normal text-muted-foreground"> / {counts.total}</span></>}
      hint={<span className="inline-flex items-center gap-1.5"><span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden /> Live{pct != null ? ` · ${pct}% of active tickets` : ""}</span>}
    />
  );
}
