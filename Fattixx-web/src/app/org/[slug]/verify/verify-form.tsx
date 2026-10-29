"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2Icon } from "lucide-react";
import { submitOrgVerification, type ActionState } from "@/lib/applications/actions";
import { CheckField, FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Defaults = { contactName: string; email: string; phone: string; legalName: string; businessType: string; taxLast4: string; website: string; address: string; events: string };

/** The "Start hosting" application's details for an existing organization, plus a required password when the account has none. */
export function VerifyForm({ org, orgName, needsPassword, defaults: d }: { org: string; orgName: string; needsPassword: boolean; defaults: Defaults }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitOrgVerification, undefined);
  if (state?.ok) {
    return (
      <Alert>
        <AlertTitle>Verification sent</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  return (
    <form action={action} className="space-y-6">
      <FormStatus state={state} />
      <input type="hidden" name="org" value={org} />

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">About you</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Your name" id="vf-name" name="contact_name" required minLength={2} maxLength={160} autoComplete="name" defaultValue={d.contactName} />
          <TextField label="Email" id="vf-email" name="contact_email" type="email" required maxLength={254} autoComplete="email" defaultValue={d.email} />
          <TextField label="Phone" id="vf-phone" name="contact_phone" type="tel" maxLength={40} autoComplete="tel" hint="Optional" defaultValue={d.phone} />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">{orgName}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Type" id="vf-type" name="business_type" defaultValue={d.businessType} options={[{ value: "company", label: "Company / promoter" }, { value: "venue", label: "Venue" }, { value: "nonprofit", label: "Nonprofit" }, { value: "individual", label: "Individual" }]} />
          <TextField label="Legal name (for payouts)" id="vf-legal" name="legal_name" required minLength={2} maxLength={200} defaultValue={d.legalName} hint="Person or registered business that will be paid" />
          <TextField label="Tax ID (last 4 digits)" id="vf-tax" name="tax_id_last4" inputMode="numeric" maxLength={4} pattern="\d{4}" defaultValue={d.taxLast4} hint="EIN or SSN; we never ask for the full number here" />
          <TextField label="Website or social page" id="vf-web" name="website" type="url" placeholder="https://" pattern="https?://\S+" title="Starts with http:// or https://" defaultValue={d.website} />
          <TextField label="Business address" id="vf-addr" name="address" required minLength={5} maxLength={300} autoComplete="street-address" defaultValue={d.address} className="sm:col-span-2" />
          <TextAreaField label="What events will you sell?" id="vf-events" name="expected_events" rows={3} maxLength={500} defaultValue={d.events} className="sm:col-span-2" hint="Optional. A sentence or two about your events" />
        </div>
      </fieldset>

      {needsPassword ? (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold">Set a password</legend>
          <p className="text-sm text-muted-foreground">Accounts that sell paid tickets sign in with a password as well as a one-time code.</p>
          <input type="email" name="username" autoComplete="username" value={d.email} readOnly hidden />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="New password" id="vf-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} hint="At least 12 characters" />
            <TextField label="Confirm password" id="vf-confirm" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          </div>
        </fieldset>
      ) : null}

      <CheckField id="vf-agree" name="agree" required label={<>I have read and accept the <Link href="/organizer-agreement" target="_blank" className="underline">Organizer Agreement</Link></>} />
      <Button type="submit" disabled={pending}>{pending ? <Loader2Icon className="animate-spin" /> : null} Send for verification</Button>
    </form>
  );
}
