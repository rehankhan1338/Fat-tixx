"use client";

import { useActionState, useState } from "react";
import { deleteSitePage, saveSenderName, saveSitePage } from "@/lib/pro/white-label-actions";
import { CheckField, FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import DescriptionEditor from "@/components/create/DescriptionEditor";

export function SenderNameForm({ org, value, orgName, disabled }: { org: string; value: string; orgName: string; disabled: boolean }) {
  const [state, action] = useActionState(saveSenderName, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={org} />
      <TextField label="Email sender name" id="wl-sender" name="email_sender_name" maxLength={80} defaultValue={value} placeholder={orgName} disabled={disabled} className="min-w-64 flex-1"
        hint="Shown as “From” on ticket, reminder and refund emails. Replies go to your contact email." />
      <SubmitButton pendingText="Saving…" disabled={disabled}>Save</SubmitButton>
    </form>
  );
}

export type PageValues = { id?: number; title: string; slug: string; body: string; published: boolean; sort_order: number };

/** Add or edit one page. The body uses the event description editor (bold, italic, links, lists). */
export function SitePageForm({ org, page, disabled }: { org: string; page: PageValues; disabled: boolean }) {
  const [state, action] = useActionState(saveSitePage, undefined);
  const [body, setBody] = useState(page.body);
  const key = page.id ?? "new";
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={org} />
      {page.id ? <input type="hidden" name="id" value={page.id} /> : null}
      <input type="hidden" name="body" value={body} />
      <div className="grid gap-4 sm:grid-cols-[1fr_220px_110px]">
        <TextField label="Title" id={`sp-title-${key}`} name="title" required maxLength={120} defaultValue={page.title} disabled={disabled} />
        <TextField label="Address" id={`sp-slug-${key}`} name="slug" maxLength={64} defaultValue={page.slug} placeholder="from the title" disabled={disabled} hint="/p/<address>" />
        <TextField label="Order" id={`sp-order-${key}`} name="sort_order" type="number" defaultValue={page.sort_order} disabled={disabled} />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`sp-body-${key}`} className="text-sm font-medium">Content</label>
        <DescriptionEditor id={`sp-body-${key}`} value={body} onChange={setBody} />
      </div>
      <CheckField id={`sp-pub-${key}`} name="published" label="Published" hint="Unpublished pages are not shown or linked." defaultChecked={page.published} />
      <div className="flex justify-end gap-2">
        {page.id ? <ConfirmButton action={deleteSitePage} fields={{ org, id: page.id }} title="Delete this page?" description="Links to it stop working." confirmText="Delete" variant="ghost">Delete</ConfirmButton> : null}
        <SubmitButton pendingText="Saving…" disabled={disabled}>{page.id ? "Save page" : "Add page"}</SubmitButton>
      </div>
    </form>
  );
}
