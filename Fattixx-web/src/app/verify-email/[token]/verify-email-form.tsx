"use client";

import Link from "next/link";
import { useActionState } from "react";
import { verifyEmail } from "@/lib/auth/actions";
import { FormStatus } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";

export function VerifyEmailForm({ token }: { token: string }) {
  const [state, action] = useActionState(verifyEmail, undefined);
  if (state?.ok) {
    return (
      <div className="space-y-4">
        <FormStatus state={state} successText={state.message} />
        <Button className="w-full" render={<Link href="/account" />}>Go to my account</Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} />
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-muted-foreground">Confirming your email also adds any tickets you bought earlier as a guest with this address to your account.</p>
      <SubmitButton className="w-full" pendingText="Confirming…">Confirm email</SubmitButton>
    </form>
  );
}
