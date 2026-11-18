"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { resolveStaffReport } from "@/lib/social/moderation";
import { Button } from "@/components/ui/button";

export function ReportActions({ id, canSuspend }: { id: number; canSuspend: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (a: "remove" | "suspend" | "dismiss", ask?: string) => {
    if (ask && !confirm(ask)) return;
    start(async () => { const r = await resolveStaffReport(id, a); if (r?.error) toast.error(r.error); else toast.success("Done"); router.refresh(); });
  };
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => act("remove", "Remove this content?")}>Remove content</Button>
      {canSuspend ? <Button size="sm" variant="outline" disabled={pending} onClick={() => act("suspend", "Suspend this account? They are signed out everywhere and can’t sign in.")}>Suspend account</Button> : null}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("dismiss")}>Dismiss</Button>
    </div>
  );
}
