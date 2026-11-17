"use client";

import { useState, type FormEvent } from "react";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/form-validation";
import { SelectField, TextField } from "@/components/form-fields";

/**
 * Super Admin: start a seat map without an organizer's request. Posted to /api/seating/maps (a Route Handler: the floor
 * plan can be bigger than a Server Action accepts), which answers with the new map's builder page.
 */
export function NewSeatMapDialog({ orgs }: { orgs: { id: number; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get("floor_plan");
    if (file instanceof File && file.size > 4 * 1024 * 1024) { setError("The floor plan must be 4 MB or smaller. Export a smaller file."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/seating/maps", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (!res.ok || !data.redirect) { setError(data.error ?? "The map could not be created. Try again."); setBusy(false); return; }
      window.location.assign(data.redirect);
    } catch {
      setError("The map could not be created. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}><PlusIcon /> New seat map</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New seat map</DialogTitle>
          <DialogDescription>Build a map yourself, without a request from an organizer. No set-up fee and no approval step: publish it when it&apos;s ready.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {error ? <ErrorAlert message={error} result={{ error }} /> : null}
          <SelectField label="Built for" id="nm-org" name="organization_id" defaultValue=""
            options={[{ value: "", label: "Venue Library (any Pro organizer)" }, ...orgs.map((o) => ({ value: String(o.id), label: o.name }))]}
            hint="A map built for an organization can be used by it once published; you can also list it in the Venue Library." />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Venue name" id="nm-venue" name="venue_name" required maxLength={160} />
            <TextField label="City" id="nm-city" name="venue_city" maxLength={120} />
            <TextField label="Region / state" id="nm-region" name="venue_region" maxLength={120} />
            <TextField label="Name of this layout" id="nm-name" name="map_name" maxLength={160} placeholder="e.g. Main hall, theatre layout" />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="nm-file" className="text-sm font-medium">Floor plan to trace (optional)</label>
            <input id="nm-file" name="floor_plan" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.xlsx,.xls,.csv"
              className="block w-full cursor-pointer rounded-lg border bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-fx-red file:px-3 file:py-1.5 file:text-fx-ivory" />
            <p className="text-xs text-muted-foreground">An image is shown under the builder&apos;s canvas. PDF, JPG, PNG, Excel or CSV, up to 4 MB.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? <Loader2Icon className="animate-spin" /> : null} {busy ? "Creating…" : "Create and open the builder"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
