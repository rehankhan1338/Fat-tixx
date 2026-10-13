"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "@/lib/auth/actions";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function ForgotForm() {
  const [state, action] = useActionState(requestPasswordReset, undefined);
  if (state?.ok) return <FormStatus state={state} successText={state.message} />;
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} />
      <TextField label="Email" id="email" name="email" type="email" autoComplete="username" required maxLength={254} autoFocus />
      <SubmitButton className="w-full" pendingText="Sending…">Send reset link</SubmitButton>
    </form>
  );
}
