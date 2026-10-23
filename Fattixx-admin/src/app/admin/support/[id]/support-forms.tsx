"use client";

import { useActionState } from "react";
import { useClearOnSuccess } from "@/components/form-validation";
import { replySupportAsStaff, updateSupportRequest } from "@/lib/pro/support-actions";
import { FormStatus, SelectField, TextAreaField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

const STATUS_OPTIONS = [
  { value: "waiting", label: "Waiting on the organizer" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "open", label: "Open" },
];

export function StaffReplyForm({ requestId }: { requestId: number }) {
  const [state, action] = useActionState(replySupportAsStaff, undefined);
  const form = useClearOnSuccess(state);
  return (
    <form ref={form} action={action} className="space-y-3">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="request_id" value={requestId} />
      <TextAreaField label="Reply (emailed to the organizer)" id="reply" name="body" required rows={6} maxLength={10_000} />
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="Then mark as" id="reply-status" name="status" defaultValue="waiting" options={STATUS_OPTIONS} />
        <SubmitButton pendingText="Sending…">Send reply</SubmitButton>
      </div>
    </form>
  );
}

export function StaffUpdateForm({ requestId, status, priority, assignee }: { requestId: number; status: string; priority: string; assignee: string | null }) {
  const [state, action] = useActionState(updateSupportRequest, undefined);
  return (
    <form action={action} className="space-y-3">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="request_id" value={requestId} />
      <SelectField label="Status" id="st" name="status" defaultValue={status} options={STATUS_OPTIONS} />
      <SelectField label="Priority" id="pr" name="priority" defaultValue={priority} options={[{ value: "priority", label: "Priority (Pro)" }, { value: "normal", label: "Normal" }]} />
      <SelectField label="Assigned to" id="as" name="assigned_to" defaultValue="keep"
        options={[{ value: "keep", label: assignee ? `Keep: ${assignee}` : "Keep: nobody" }, { value: "me", label: "Me" }, { value: "", label: "Nobody" }]} />
      <SubmitButton size="sm" pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
