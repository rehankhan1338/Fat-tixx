"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginWithPassword } from "@/lib/auth/actions";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginWithPassword, undefined);
  return (
    <form action={action} className="space-y-4" autoComplete="on">
      <FormStatus state={state} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField label="Email" id="email" name="email" type="email" inputMode="email" autoComplete="username" required maxLength={254} autoFocus spellCheck={false} />
      <TextField
        label={<span className="flex w-full items-center justify-between">Password <Link href="/forgot-password" className="inline-flex min-h-8 items-center text-xs font-normal text-muted-foreground hover:text-foreground">Forgot password?</Link></span>}
        id="password" name="password" type="password" autoComplete="current-password" required maxLength={128}
      />
      <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
