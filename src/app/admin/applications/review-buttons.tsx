"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { approveApplication, rejectApplication } from "@/lib/applications/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ReviewButtons({ id, name }: { id: number; name: string }) {
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: typeof approveApplication) => start(async () => {
    const fd = new FormData(); fd.set("id", String(id)); fd.set("notes", notes);
    const r = await fn(fd);
    if (r?.error) toast.error(r.error); else toast.success(r?.message ?? "Done");
  });
  return (
    <div className="space-y-2">
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Review notes (required to decline; sent to the applicant)" aria-label={`Review notes for ${name}`} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => run(approveApplication)}>Verify & approve</Button>
        <Button variant="outline" disabled={pending} onClick={() => run(rejectApplication)}>Decline</Button>
      </div>
    </div>
  );
}
