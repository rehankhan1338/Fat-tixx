"use client";

import { useActionState } from "react";
import { revokeAllOtherSessions } from "@/lib/auth/actions";
import { FormStatus } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function RevokeAllButton() {
  const [state, action] = useActionState(revokeAllOtherSessions, undefined);
  return (
    <form action={action} className="space-y-3">
      <FormStatus state={state} successText="All other sessions were revoked." />
      <SubmitButton variant="destructive" pendingText="Revoking…">Sign out everywhere else</SubmitButton>
    </form>
  );
}
