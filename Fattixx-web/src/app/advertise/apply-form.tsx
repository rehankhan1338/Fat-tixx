"use client";

import { useActionState } from "react";
import Link from "next/link";
import { applyAsAdvertiser } from "@/lib/ads/advertiser-actions";
import { BotFields } from "@/components/bot-fields";
import { Captcha } from "@/components/captcha";
import { CheckField, FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function AdvertiserApplyForm({ defaults }: { defaults: { company: string; contact: string; email: string; website: string } }) {
  const [state, action] = useActionState(applyAsAdvertiser, undefined);
  if (state?.ok) return <FormStatus state={state} successText={state.message} />;
  return (
    <form action={action} className="relative space-y-4">
      <FormStatus state={state} />
      <BotFields />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Company or brand" id="adv-company" name="company_name" required maxLength={160} defaultValue={defaults.company} autoComplete="organization" />
        <TextField label="Website" id="adv-web" name="website" type="url" placeholder="https://" defaultValue={defaults.website} />
        <TextField label="Contact name" id="adv-contact" name="contact_name" required maxLength={160} defaultValue={defaults.contact} autoComplete="name" />
        <TextField label="Contact email" id="adv-email" name="contact_email" type="email" required maxLength={254} defaultValue={defaults.email} autoComplete="email" />
      </div>
      <CheckField id="adv-agree" name="agree" required label={<>I accept the <Link href="/terms" target="_blank" className="underline">Terms of Service</Link>, and that ads are reviewed and may be refused (with a full refund).</>} />
      <Captcha />
      <SubmitButton pendingText="Sending…">Apply to advertise</SubmitButton>
    </form>
  );
}
