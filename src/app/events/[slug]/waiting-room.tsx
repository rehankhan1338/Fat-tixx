"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HourglassIcon, Loader2Icon } from "lucide-react";
import { Progress } from "@/components/ui/progress";

type Status = { admitted: boolean; position: number; ahead: number; etaMinutes: number };

/** Shown instead of the ticket form while the event's virtual waiting room is on. Polls its place in line. */
export function WaitingRoom({ eventId }: { eventId: number }) {
  const router = useRouter();
  const [s, setS] = useState<Status | null>(null);
  const [start, setStart] = useState<number | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch(`/api/queue/${eventId}`, { method: "POST", cache: "no-store" });
        const j = (await r.json()) as Status;
        if (stop) return;
        setS(j);
        setStart((v) => v ?? j.ahead);
        if (j.admitted) { router.refresh(); return; }
      } catch { /* retry */ }
      if (!stop) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [eventId, router]);

  const pct = s && start ? Math.max(5, Math.round(((start - s.ahead) / Math.max(1, start)) * 100)) : 5;
  return (
    <div className="space-y-4 text-center" role="status" aria-live="polite">
      <HourglassIcon className="mx-auto size-8 text-primary" />
      <div>
        <p className="font-semibold">You are in line</p>
        <p className="text-sm text-muted-foreground">Demand is high, so we let people through a few at a time. Keep this page open; it updates automatically.</p>
      </div>
      {s ? (
        s.admitted ? <p className="flex items-center justify-center gap-2 text-sm"><Loader2Icon className="size-4 animate-spin" /> It is your turn. Loading tickets…</p> : (
          <>
            <Progress value={pct} className="h-2" />
            <p className="text-sm"><span className="text-2xl font-bold tabular-nums">{s.ahead.toLocaleString()}</span> {s.ahead === 1 ? "person" : "people"} ahead of you · about {s.etaMinutes} min</p>
          </>
        )
      ) : <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Joining the line…</p>}
      <p className="text-xs text-muted-foreground">Refreshing or opening more tabs does not move you forward.</p>
    </div>
  );
}
