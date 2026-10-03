"use client";

import { useActionState, useState } from "react";
import { BellRingIcon } from "lucide-react";
import { joinWaitlist } from "@/lib/waitlist/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

/** Shown when the event (or some ticket types) sold out and the organizer enabled the waitlist. */
export function WaitlistForm({ eventSlug, soldOutTypes, allSoldOut, defaultEmail, defaultName }: { eventSlug: string; soldOutTypes: { id: number; name: string }[]; allSoldOut: boolean; defaultEmail?: string; defaultName?: string }) {
  const [open, setOpen] = useState(allSoldOut);
  const [state, action] = useActionState(joinWaitlist, undefined);
  if (state?.ok) return <Alert className="mt-4 border-emerald-500/40"><BellRingIcon className="text-emerald-500" /><AlertTitle>{state.message}</AlertTitle></Alert>;
  if (!open) return <Button type="button" variant="outline" className="mt-4 w-full" onClick={() => setOpen(true)}><BellRingIcon /> Join the waitlist for sold-out tickets</Button>;
  return (
    <form action={action} className="mt-4 space-y-3 rounded-xl border p-3">
      <p className="flex items-center gap-2 text-sm font-medium"><BellRingIcon className="size-4" /> {allSoldOut ? "Sold out — join the waitlist" : "Join the waitlist"}</p>
      <p className="text-xs text-muted-foreground">We email you if tickets free up (refunds, extra capacity). First come, first served.</p>
      <FormStatus state={state} />
      <input type="hidden" name="event" value={eventSlug} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" id="wl-name" name="name" autoComplete="name" defaultValue={defaultName} />
        <TextField label="Email" id="wl-email" name="email" type="email" required autoComplete="email" defaultValue={defaultEmail} />
        {soldOutTypes.length > 1 ? <SelectField label="Ticket" id="wl-tt" name="ticket_type_id" options={[{ value: "", label: "Any ticket" }, ...soldOutTypes.map((t) => ({ value: String(t.id), label: t.name }))]} /> : soldOutTypes[0] ? <input type="hidden" name="ticket_type_id" value={soldOutTypes[0].id} /> : null}
        <TextField label="How many" id="wl-qty" name="quantity" type="number" min={1} max={10} defaultValue={1} />
      </div>
      <SubmitButton className="w-full" variant="secondary" pendingText="Joining…">Notify me</SubmitButton>
    </form>
  );
}
