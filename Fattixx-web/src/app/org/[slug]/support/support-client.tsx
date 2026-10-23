"use client";

import { useActionState } from "react";
import { useClearOnSuccess } from "@/components/form-validation";
import { openSupportRequest, replySupportAsOrganizer } from "@/lib/pro/support-actions";
import { FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function NewRequestForm({ org, categories }: { org: string; categories: { value: string; label: string }[] }) {
  const [state, action] = useActionState(openSupportRequest, undefined);
  const form = useClearOnSuccess(state);
  return (
    <form ref={form} action={action} className="space-y-4">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={org} />
      <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
        <SelectField label="Topic" id="sr-cat" name="category" defaultValue="events" options={categories} />
        <TextField label="Subject" id="sr-subject" name="subject" required maxLength={200} />
        <TextAreaField label="How can we help?" id="sr-body" name="body" required rows={6} maxLength={10_000} hint="Include the event or order number if it is about one." className="sm:col-span-2" />
      </div>
      <SubmitButton pendingText="Sending…">Send</SubmitButton>
    </form>
  );
}

export function ReplyForm({ org, requestId, resolved }: { org: string; requestId: number; resolved: boolean }) {
  const [state, action] = useActionState(replySupportAsOrganizer, undefined);
  const form = useClearOnSuccess(state);
  return (
    <form ref={form} action={action} className="space-y-3">
      <FormStatus state={state} />
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="request_id" value={requestId} />
      <TextAreaField label={resolved ? "Reopen with a message" : "Add a message"} id="sr-reply" name="body" required rows={4} maxLength={10_000} />
      <SubmitButton size="sm" pendingText="Sending…">Send</SubmitButton>
    </form>
  );
}
