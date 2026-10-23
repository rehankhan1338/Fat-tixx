"use client";

import { useState, type FormEvent } from "react";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/form-validation";
import { SelectField, TextAreaField, TextField } from "@/components/form-fields";

/**
 * "Request a seat map": the venue, a name for the layout, the floor plan (PDF or image, up to 4 MB) and notes. Posted to
 * /api/seating/requests (a Route Handler: floor plans are bigger than a Server Action accepts), which answers with
 * where to go next: Stripe Checkout for the set-up fee, or the new request's page.
 */
export function SeatMapRequestForm({ org, venues, feeLabel }: { org: string; venues: { id: number; name: string; city: string | null }[]; feeLabel: string | null }) {
  const [venue, setVenue] = useState(venues[0] ? String(venues[0].id) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get("floor_plan");
    if (file instanceof File && file.size > 4 * 1024 * 1024) { setError("The floor plan must be 4 MB or smaller. Export a smaller PDF or image."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/seating/requests", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string };
      if (!res.ok || !data.redirect) { setError(data.error ?? "The request could not be sent. Try again."); setBusy(false); return; }
      window.location.assign(data.redirect);
    } catch {
      setError("The request could not be sent. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? <ErrorAlert message={error} result={{ error }} /> : null}
      <input type="hidden" name="org" value={org} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Venue" id="smr-venue" name="venue_id" value={venue} onChange={(e) => setVenue(e.target.value)}
          options={[...venues.map((v) => ({ value: String(v.id), label: [v.name, v.city].filter(Boolean).join(", ") })), { value: "", label: "Another venue…" }]} />
        <TextField label="Name of this layout" id="smr-name" name="map_name" maxLength={160} placeholder="e.g. Main hall, theatre layout" hint="Useful when a venue has more than one layout." />
        {venue === "" ? (
          <>
            <TextField label="Venue name" id="smr-vname" name="venue_name" required maxLength={160} />
            <TextField label="City" id="smr-vcity" name="venue_city" maxLength={120} />
          </>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="smr-file" className="text-sm font-medium">Floor plan or official seating chart</label>
        <input id="smr-file" name="floor_plan" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp"
          className="block w-full cursor-pointer rounded-lg border bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-fx-red file:px-3 file:py-1.5 file:text-fx-ivory" />
        <p className="text-xs text-muted-foreground">PDF, JPG or PNG, up to 4 MB. The venue usually has one; it should show every section, row and seat number.</p>
      </div>
      <TextAreaField label="Notes for our team" id="smr-notes" name="notes" rows={4} maxLength={5000}
        hint="Anything the plan doesn't show: wheelchair spaces and companion seats, restricted-view seats, sections you never sell, how tables are numbered." />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />} {busy ? "Sending…" : feeLabel ? `Send request and pay ${feeLabel}` : "Send request"}</Button>
        {feeLabel ? <p className="text-xs text-muted-foreground">One-time set-up fee, paid securely with Stripe. Maps from the Venue Library are free to use.</p> : null}
      </div>
    </form>
  );
}
