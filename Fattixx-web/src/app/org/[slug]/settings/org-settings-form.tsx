"use client";

import { useActionState } from "react";
import { updateOrganization } from "@/lib/orgs/actions";
import { FormStatus, TextAreaField, TextField, FieldWrap } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";

export function OrgSettingsForm({ org }: { org: { slug: string; name: string; legal_name: string | null; contact_email: string; contact_phone: string | null; website: string | null; description: string | null; logoUrl: string | null } }) {
  const [state, action] = useActionState(updateOrganization, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} successText="Saved." />
      <input type="hidden" name="org" value={org.slug} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" id="name" name="name" required defaultValue={org.name} />
        <TextField label="Legal name" id="legal_name" name="legal_name" defaultValue={org.legal_name ?? ""} hint="Shown on settlement statements" />
        <TextField label="Contact email" id="contact_email" name="contact_email" type="email" required defaultValue={org.contact_email} />
        <TextField label="Phone" id="contact_phone" name="contact_phone" defaultValue={org.contact_phone ?? ""} />
        <TextField label="Website" id="website" name="website" type="url" defaultValue={org.website ?? ""} className="sm:col-span-2" />
        <TextAreaField label="About" id="description" name="description" rows={4} defaultValue={org.description ?? ""} className="sm:col-span-2" />
        <FieldWrap label="Logo" htmlFor="logo" hint="JPG, PNG or WebP. Re-encoded and resized automatically.">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {org.logoUrl ? <img src={org.logoUrl} alt="" className="size-12 rounded-lg object-cover" /> : null}
            <Input id="logo" name="logo" type="file" accept="image/*" />
          </div>
        </FieldWrap>
      </div>
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}
