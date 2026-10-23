"use client";

import { useActionState } from "react";
import { confirmUnsubscribe } from "@/lib/pro/email-actions";
import { SubmitButton } from "@/components/submit-button";

export function UnsubscribeForm({ token, orgName }: { token: string; orgName: string }) {
  const [state, action] = useActionState(confirmUnsubscribe, undefined);
  if (state?.done) return <p role="status" className="text-sm">Done. {orgName} will not send you marketing emails any more.</p>;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <SubmitButton className="w-full" pendingText="Unsubscribing…">Unsubscribe</SubmitButton>
    </form>
  );
}
