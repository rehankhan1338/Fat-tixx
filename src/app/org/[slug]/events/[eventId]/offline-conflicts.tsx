"use client";

import { useTransition } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { resolveOfflineConflict, type ConflictRow } from "@/lib/checkin/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Offline check-ins that clashed after sync (same ticket admitted twice, or refunded meanwhile). Kept as dispute evidence. */
export function OfflineConflicts({ orgSlug, eventId, conflicts, canResolve }: { orgSlug: string; eventId: number; conflicts: ConflictRow[]; canResolve: boolean }) {
  const [pending, start] = useTransition();
  if (!conflicts.length) return null;
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{conflicts.length} offline check-in conflict{conflicts.length === 1 ? "" : "s"} to review</AlertTitle>
      <AlertDescription>
        <p>These tickets were admitted by a scanner while it was offline, but the server already had them checked in (or refunded) when the device synced.</p>
        <ul className="mt-2 w-full space-y-1">
          {conflicts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 px-2 py-1.5 text-xs">
              <span><span className="font-mono">{c.code ?? "—"}</span>{c.name ? ` · ${c.name}` : ""} · {new Date(c.at).toLocaleString()} · {c.staff ?? "unknown staff"}{c.deviceId ? ` · device ${c.deviceId}` : ""}<br /><span className="text-muted-foreground">{c.reason}</span></span>
              {canResolve ? (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
                  const fd = new FormData(); fd.set("org", orgSlug); fd.set("event", String(eventId)); fd.set("id", String(c.id));
                  const r = await resolveOfflineConflict(fd);
                  if (r.error) toast.error(r.error); else toast.success("Marked as reviewed");
                })}>Mark reviewed</Button>
              ) : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
