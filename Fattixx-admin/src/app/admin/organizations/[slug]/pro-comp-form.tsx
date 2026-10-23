"use client";

import { useActionState } from "react";
import { setProComp } from "@/lib/pro/actions";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

/** Super Admin: complimentary Fattixx Pro until a date; empty removes it. */
export function ProCompForm({ orgSlug, until }: { orgSlug: string; until: string }) {
  const [state, action] = useActionState(setProComp, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={orgSlug} />
      <TextField label="Complimentary Pro until" id="pro-comp-until" name="until" type="date" defaultValue={until} hint="Leave empty to remove. Paid subscriptions are not affected." />
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
