"use client";

import { useActionState } from "react";
import { rejectAdvertiserCampaign } from "@/lib/ads/advertiser-actions";
import { FormStatus, TextAreaField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

/** Super Admin: reject an advertiser's campaign; a paid one with no impressions yet is refunded in full. */
export function RejectCampaignForm({ id, paid }: { id: number; paid: boolean }) {
  const [state, action] = useActionState(rejectAdvertiserCampaign, undefined);
  return (
    <form action={action} className="space-y-3">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="id" value={id} />
      <TextAreaField label="Reason (sent to the advertiser)" id="rej-notes" name="notes" rows={3} required minLength={3} maxLength={1000} />
      <SubmitButton variant="destructive" pendingText="Rejecting…">{paid ? "Reject and refund" : "Reject"}</SubmitButton>
    </form>
  );
}
