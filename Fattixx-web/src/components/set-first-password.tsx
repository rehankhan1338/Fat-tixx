"use client";

import { useActionState } from "react";
import { Loader2Icon } from "lucide-react";
import { setFirstPassword, type ActionState } from "@/lib/auth/actions";
import { FormStatus, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";

/** The first password for an account that signed up with a one-time code: after the first event, and as a dashboard reminder. */
export function SetFirstPassword({ email, onDone, skip }: { email: string; onDone?: () => void; skip?: React.ReactNode }) {
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await setFirstPassword(prev, fd);
    if (r?.ok) onDone?.();
    return r;
  }, undefined);
  if (state?.ok) return <p role="status" className="text-sm font-semibold">Password saved. You can now sign in with your email and password too.</p>;
  return (
    <form action={action} className="space-y-3">
      <FormStatus state={state} />
      {/* lets password managers save the new password against the right account */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="New password" id="fp-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} hint="At least 12 characters" />
        <TextField label="Confirm password" id="fp-confirm" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? <Loader2Icon className="animate-spin" /> : null} Set password</Button>
        {skip}
      </div>
    </form>
  );
}
