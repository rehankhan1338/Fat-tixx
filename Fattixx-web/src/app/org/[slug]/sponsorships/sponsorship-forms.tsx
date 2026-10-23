"use client";

import { useActionState } from "react";
import { decideDeal, deletePackage, savePackage } from "@/lib/sponsorships/actions";
import { CheckField, FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";

export type PackageValues = { id?: number; title: string; description: string; perks: string; price: string; quantity: number; event_id: string; includes_ad: boolean; status: string };
export const EMPTY_PACKAGE: PackageValues = { title: "", description: "", perks: "", price: "", quantity: 1, event_id: "", includes_ad: false, status: "listed" };

/** Create or edit a sponsorship package. Listed packages appear on /sponsorships. */
export function PackageForm({ org, values, events }: { org: string; values: PackageValues; events: { id: number; title: string }[] }) {
  const [state, action] = useActionState(savePackage, undefined);
  const k = values.id ?? "new";
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={org} />
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Title" id={`pk-title-${k}`} name="title" required maxLength={160} defaultValue={values.title} placeholder="Main stage sponsor" className="sm:col-span-2" />
        <SelectField label="For" id={`pk-event-${k}`} name="event_id" defaultValue={values.event_id} options={[{ value: "", label: "Our whole season (no single event)" }, ...events.map((e) => ({ value: String(e.id), label: e.title }))]} />
        <SelectField label="Status" id={`pk-status-${k}`} name="status" defaultValue={values.status} options={[{ value: "listed", label: "Listed on the marketplace" }, { value: "draft", label: "Draft (hidden)" }, { value: "closed", label: "Closed" }]} />
        <TextField label="Price (USD)" id={`pk-price-${k}`} name="price" inputMode="decimal" required defaultValue={values.price} placeholder="500.00" />
        <TextField label="How many to sell" id={`pk-qty-${k}`} name="quantity" type="number" min={1} max={1000} required defaultValue={values.quantity} />
        <TextAreaField label="Description" id={`pk-desc-${k}`} name="description" rows={3} maxLength={2000} defaultValue={values.description} className="sm:col-span-2" />
        <TextAreaField label="What the sponsor gets (one per line)" id={`pk-perks-${k}`} name="perks" rows={4} maxLength={2000} defaultValue={values.perks} className="sm:col-span-2" placeholder={"Logo on the stage banner\nShout-out from the MC\n4 VIP tickets"} />
      </div>
      <CheckField id={`pk-ad-${k}`} name="includes_ad" label="Includes an on-page sponsor ad" hint="When paid, a sponsor ad is created on the event page and order confirmations; you add the sponsor's image and Fattixx approves it." defaultChecked={values.includes_ad} />
      <div className="flex justify-end gap-2">
        {values.id ? <ConfirmButton action={deletePackage} fields={{ org, id: values.id }} title="Delete this package?" description="Only packages without accepted or paid deals can be deleted." confirmText="Delete" variant="ghost">Delete</ConfirmButton> : null}
        <SubmitButton pendingText="Saving…">{values.id ? "Save package" : "Add package"}</SubmitButton>
      </div>
    </form>
  );
}

/** Organization Admin: answer a sponsor's request. */
export function DecideForm({ org, id }: { org: string; id: number }) {
  const [state, action] = useActionState(decideDeal, undefined);
  if (state?.ok) return <FormStatus state={state} successText={state.message} />;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <FormStatus state={state} />
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="id" value={id} />
      <TextField label="Note to the sponsor (optional)" id={`dd-note-${id}`} name="note" maxLength={1000} className="min-w-56 flex-1" />
      <SubmitButton size="sm" name="decision" value="accept" pendingText="…">Accept</SubmitButton>
      <SubmitButton size="sm" variant="outline" name="decision" value="decline" pendingText="…">Decline</SubmitButton>
    </form>
  );
}
