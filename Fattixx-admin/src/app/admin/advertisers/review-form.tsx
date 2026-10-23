"use client";

import { useActionState } from "react";
import { reviewAdvertiser } from "@/lib/ads/advertiser-actions";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

/** Super Admin: approve, reject or suspend one advertiser. The note is emailed to them. */
export function ReviewAdvertiserForm({ id, status }: { id: number; status: string }) {
  const [state, action] = useActionState(reviewAdvertiser, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="id" value={id} />
      <SelectField label="Decision" id={`adv-st-${id}`} name="status" defaultValue={status === "pending" ? "approved" : status}
        options={[{ value: "approved", label: "Approve" }, { value: "rejected", label: "Reject" }, { value: "suspended", label: "Suspend" }]} />
      <TextField label="Note to the advertiser" id={`adv-note-${id}`} name="notes" maxLength={1000} className="min-w-56 flex-1" />
      <SubmitButton size="sm" pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
