"use client";

import { useActionState } from "react";
import { setPasswordWithToken } from "@/lib/auth/actions";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function SetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(setPasswordWithToken, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} />
      <input type="hidden" name="token" value={token} />
      <TextField label="New password" id="password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} hint="At least 12 characters. Checked against known breached passwords." autoFocus />
      <TextField label="Confirm password" id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      <SubmitButton className="w-full" pendingText="Saving…">Save password and sign in</SubmitButton>
    </form>
  );
}
