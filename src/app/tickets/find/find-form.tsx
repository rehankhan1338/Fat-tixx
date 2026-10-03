"use client";

import { useActionState } from "react";
import { requestTicketsLink } from "@/lib/orders/actions";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function FindForm() {
  const [state, action] = useActionState(requestTicketsLink, undefined);
  if (state?.ok) return <FormStatus state={state} successText={state.message} />;
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} />
      <TextField label="Email" id="email" name="email" type="email" required autoComplete="email" autoFocus />
      <SubmitButton className="w-full" pendingText="Sending…">Email me my tickets</SubmitButton>
    </form>
  );
}
