"use client";

import { useActionState } from "react";
import { registerAttendee } from "@/lib/auth/actions";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { BotFields } from "@/components/bot-fields";

export function RegisterForm() {
  const [state, action] = useActionState(registerAttendee, undefined);
  if (state?.ok) return <FormStatus state={state} successText={state.message} />;
  return (
    <form action={action} className="relative space-y-4">
      <FormStatus state={state} />
      <BotFields />
      <TextField label="Your name" id="name" name="name" autoComplete="name" required minLength={2} maxLength={120} autoFocus />
      <TextField label="Email" id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
      <TextField label="Password" id="password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} hint="At least 12 characters." />
      <SubmitButton className="w-full" pendingText="Creating…">Create account</SubmitButton>
    </form>
  );
}
