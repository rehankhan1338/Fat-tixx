"use client";

import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { staffPublishMap } from "@/lib/seating/actions";
import { Button } from "@/components/ui/button";

/** Publish a map a Super Admin built, optionally listing it in the Venue Library. */
export function PublishMapForm({ mapId, forOrg }: { mapId: number; forOrg: string | null }) {
  const [listed, setListed] = useState(!forOrg);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      {forOrg ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} /> Also list it in the Venue Library (every Pro organizer can use it)
        </label>
      ) : <span className="text-sm text-muted-foreground">Built for no organization, so it is listed in the Venue Library.</span>}
      <Button type="button" disabled={pending} onClick={() => start(async () => {
        const fd = new FormData();
        fd.set("map_id", String(mapId));
        fd.set("listed", listed ? "1" : "0");
        const r = await staffPublishMap(fd);
        if (r?.error) toast.error(r.error); else toast.success(r?.message ?? "Published");
      })}>
        {pending ? <Loader2Icon className="animate-spin" /> : null} Publish map
      </Button>
    </div>
  );
}
