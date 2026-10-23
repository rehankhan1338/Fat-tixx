"use client";

import { useActionState } from "react";
import { requestSponsorship } from "@/lib/sponsorships/actions";
import { BotFields } from "@/components/bot-fields";
import { Captcha } from "@/components/captcha";
import { FormStatus, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function RequestSponsorshipForm({ packageId, defaults }: { packageId: number; defaults: { contact: string; email: string } }) {
  const [state, action] = useActionState(requestSponsorship, undefined);
  if (state?.ok) return <FormStatus state={state} successText={state.message} />;
  return (
    <form action={action} className="relative space-y-4">
      <FormStatus state={state} />
      <BotFields />
      <input type="hidden" name="package_id" value={packageId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Sponsor (company or brand)" id="sr-sponsor" name="sponsor_name" required maxLength={160} autoComplete="organization" hint="Shown as the sponsor" />
        <TextField label="Website" id="sr-web" name="website" type="url" placeholder="https://" hint="Where the sponsor ad links to" />
        <TextField label="Contact name" id="sr-contact" name="contact_name" required maxLength={160} defaultValue={defaults.contact} autoComplete="name" />
        <TextField label="Contact email" id="sr-email" name="contact_email" type="email" required maxLength={254} defaultValue={defaults.email} autoComplete="email" />
      </div>
      <TextAreaField label="Message to the organizer" id="sr-msg" name="message" rows={4} maxLength={2000} hint="Optional: what you would like, timing, questions" />
      <Captcha />
      <SubmitButton pendingText="Sending…">Send request</SubmitButton>
    </form>
  );
}
