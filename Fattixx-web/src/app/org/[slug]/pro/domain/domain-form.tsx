"use client";

import { useActionState } from "react";
import { addCustomDomain } from "@/lib/pro/site-actions";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function AddDomainForm({ org }: { org: string }) {
  const [state, action] = useActionState(addCustomDomain, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormStatus state={state} />
      <input type="hidden" name="org" value={org} />
      <TextField label="Domain" id="hostname" name="hostname" required placeholder="tickets.yourbrand.com" autoComplete="off" spellCheck={false} className="min-w-[260px] flex-1" />
      <SubmitButton pendingText="Adding…">Add domain</SubmitButton>
    </form>
  );
}
