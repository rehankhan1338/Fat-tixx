"use client";

import { useActionState } from "react";
import { updateOrganizationPlatformSettings } from "@/lib/orgs/actions";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function OrgPlatformSettingsForm({ orgSlug, feeBps, feeFixedCents, status }: { orgSlug: string; feeBps: number | null; feeFixedCents: number | null; status: string }) {
  const [state, action] = useActionState(updateOrganizationPlatformSettings, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} successText="Saved." />
      <input type="hidden" name="org" value={orgSlug} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Platform fee override (basis points)" id="fee_bps_override" name="fee_bps_override" type="number" min={0} max={5000} defaultValue={feeBps ?? ""} placeholder="e.g. 350 = 3.50%" />
        <TextField label="Fixed fee override (cents)" id="fee_fixed_cents_override" name="fee_fixed_cents_override" type="number" min={0} defaultValue={feeFixedCents ?? ""} placeholder="e.g. 75" />
        <SelectField label="Status" id="status" name="status" defaultValue={status} options={[{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended — team cannot sign in, events hidden" }]} />
      </div>
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
