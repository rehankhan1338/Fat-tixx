"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { sendAudienceMessage, type OrgSocialState } from "@/lib/social/org-actions";
import { resolveOrgReport } from "@/lib/social/moderation";
import type { AudienceFilters } from "@/lib/social/audience";
import { CheckField, FormStatus, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";

export function AudienceMessageForm({ slug, filters, recipients, smsRecipients }: { slug: string; filters: AudienceFilters; recipients: number; smsRecipients: number }) {
  const [state, action] = useActionState<OrgSocialState, FormData>(sendAudienceMessage, undefined);
  return (
    <form action={action} className="space-y-4" onSubmit={(e) => { if (!confirm(`Send this to ${recipients} people?`)) e.preventDefault(); }}>
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={slug} />
      <input type="hidden" name="kind" value={filters.kind} />
      {filters.eventId ? <input type="hidden" name="event" value={filters.eventId} /> : null}
      {filters.city ? <input type="hidden" name="city" value={filters.city} /> : null}
      {filters.from ? <input type="hidden" name="from" value={filters.from} /> : null}
      {filters.to ? <input type="hidden" name="to" value={filters.to} /> : null}
      <TextField label="Subject" id="am-subject" name="subject" required maxLength={200} />
      <TextAreaField label="Message" id="am-body" name="body" required rows={6} maxLength={5000} hint="Plain text. Each email says why the person gets it, with a link to mute or unsubscribe." />
      {smsRecipients ? <CheckField id="am-sms" name="with_sms" label={`Also send a text to the ${smsRecipients} people who opted in to texts`} /> : null}
      <SubmitButton disabled={!recipients} pendingText="Sending…">Send to {recipients} {recipients === 1 ? "person" : "people"}</SubmitButton>
    </form>
  );
}

export function OrgReportActions({ slug, reportId }: { slug: string; reportId: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (a: "remove" | "dismiss") => start(async () => { const r = await resolveOrgReport(slug, reportId, a); if (r?.error) toast.error(r.error); router.refresh(); });
  return (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="destructive" disabled={pending} onClick={() => act("remove")}>Remove post</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("dismiss")}>Dismiss</Button>
    </div>
  );
}
