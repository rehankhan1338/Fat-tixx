"use client";

import { useActionState } from "react";
import { adminLoginWithPassword } from "@/lib/auth/actions";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm({ next, forgotHref }: { next?: string; forgotHref: string }) {
  const [state, action] = useActionState(adminLoginWithPassword, undefined);
  return (
    <form action={action} className="space-y-4" autoComplete="on">
      <FormStatus state={state} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField label="Email" id="email" name="email" type="email" inputMode="email" autoComplete="username" required maxLength={254} autoFocus spellCheck={false} />
      <TextField
        label={<span className="flex w-full items-center justify-between">Password <a href={forgotHref} className="inline-flex min-h-8 items-center text-xs font-normal text-muted-foreground hover:text-foreground">Forgot password?</a></span>}
        id="password" name="password" type="password" autoComplete="current-password" required maxLength={128}
      />
      <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
