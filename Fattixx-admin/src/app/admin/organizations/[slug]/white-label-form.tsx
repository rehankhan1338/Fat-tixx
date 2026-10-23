"use client";

import { useActionState } from "react";
import { setWhiteLabel } from "@/lib/pro/white-label-actions";
import { FormStatus, SelectField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

/** Super Admin: the white-label add-on (works only while the organization is on Fattixx Pro). */
export function WhiteLabelForm({ orgSlug, on }: { orgSlug: string; on: boolean }) {
  const [state, action] = useActionState(setWhiteLabel, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={orgSlug} />
      <SelectField label="White-label" id="wl-on" name="white_label" defaultValue={on ? "1" : "0"} options={[{ value: "0", label: "Off" }, { value: "1", label: "On" }]}
        hint="The organizer's name instead of Fattixx's on their pages, tickets, wallet passes, emails and texts, plus their own site pages." />
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
