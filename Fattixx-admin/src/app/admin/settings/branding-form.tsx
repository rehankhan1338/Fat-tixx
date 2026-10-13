"use client";

import { useActionState, useState } from "react";
import { saveBranding } from "@/lib/admin/finance-actions";
import { CheckField, FieldWrap, FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";

export function BrandingForm({ name, color, supportEmail, logoUrl }: { name: string; color: string; supportEmail: string; logoUrl: string | null }) {
  const [state, action] = useActionState(saveBranding, undefined);
  const [c, setC] = useState(color);
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} successText={state?.message} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Platform name" id="platform_name" name="platform_name" required defaultValue={name} />
        <TextField label="Support email" id="support_email" name="support_email" type="email" required defaultValue={supportEmail} hint="Shown in email footers and on tickets." />
        <FieldWrap label="Accent colour" htmlFor="brand_color" hint="Buttons, links and highlights.">
          <div className="flex items-center gap-3">
            <input id="brand_color" name="brand_color" type="color" value={c} onChange={(e) => setC(e.target.value)} className="h-9 w-14 cursor-pointer rounded border bg-transparent" />
            <code className="text-sm">{c}</code>
            <span className="inline-block rounded-md px-3 py-1 text-sm font-semibold text-zinc-900" style={{ background: c }}>Preview button</span>
          </div>
        </FieldWrap>
        <FieldWrap label="Logo" htmlFor="logo" hint="PNG, JPG or WebP; shown in the header and on emails. Transparent PNG works best.">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logoUrl ? <img src={logoUrl} alt="" className="h-10 rounded-md bg-zinc-900 p-1" /> : null}
            <Input id="logo" name="logo" type="file" accept="image/*" />
          </div>
          {logoUrl ? <CheckField id="remove_logo" name="remove_logo" label="Remove current logo" /> : null}
        </FieldWrap>
      </div>
      <SubmitButton pendingText="Saving…">Save branding</SubmitButton>
    </form>
  );
}
