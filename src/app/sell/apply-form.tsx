"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitApplication } from "@/lib/applications/actions";
import { BotFields } from "@/components/bot-fields";
import { CheckField, FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Separator } from "@/components/ui/separator";

export function ApplyForm({ defaultName, defaultEmail }: { defaultName?: string; defaultEmail?: string }) {
  const [state, action] = useActionState(submitApplication, undefined);
  if (state?.ok) return <FormStatus state={state} successText={state.message} />;
  return (
    <form action={action} className="relative space-y-5 rounded-xl border p-5">
      <FormStatus state={state} />
      <BotFields />
      <p className="text-sm font-medium">You</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Your name" id="ap-name" name="contact_name" required maxLength={160} autoComplete="name" defaultValue={defaultName} />
        <TextField label="Email" id="ap-email" name="contact_email" type="email" required autoComplete="email" defaultValue={defaultEmail} />
        <TextField label="Phone" id="ap-phone" name="contact_phone" type="tel" autoComplete="tel" />
      </div>
      <Separator />
      <p className="text-sm font-medium">Your organization</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name buyers will see" id="ap-org" name="org_name" required maxLength={160} />
        <SelectField label="Type" id="ap-type" name="business_type" defaultValue="company" options={[{ value: "company", label: "Company / promoter" }, { value: "venue", label: "Venue" }, { value: "nonprofit", label: "Nonprofit" }, { value: "individual", label: "Individual" }]} />
        <TextField label="Legal name (for payouts)" id="ap-legal" name="legal_name" required maxLength={200} hint="Person or registered business that will be paid" />
        <TextField label="Tax ID (last 4 digits)" id="ap-tax" name="tax_id_last4" inputMode="numeric" maxLength={4} pattern="\d{4}" hint="EIN or SSN; we never ask for the full number here" />
        <TextField label="Website or social page" id="ap-web" name="website" type="url" placeholder="https://" className="sm:col-span-2" />
        <TextField label="Business address" id="ap-addr" name="address" required maxLength={300} autoComplete="street-address" className="sm:col-span-2" />
        <TextAreaField label="What events will you sell?" id="ap-events" name="expected_events" rows={3} maxLength={500} className="sm:col-span-2" hint="Type of events, typical size, how often" />
      </div>
      <CheckField id="ap-agree" name="agree" required label={<>I have read and accept the <Link href="/organizer-agreement" target="_blank" className="underline">Organizer Agreement</Link></>} />
      <SubmitButton className="w-full" pendingText="Sending…">Apply to sell tickets</SubmitButton>
    </form>
  );
}
