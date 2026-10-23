"use client";

import { useActionState, useState } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
import { saveCampaign, saveMailingAddress, saveSegment, saveTemplate } from "@/lib/pro/email-actions";
import { FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function MailingAddressForm({ org, value }: { org: string; value: string }) {
  const [state, action] = useActionState(saveMailingAddress, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={org} />
      <TextField label="Postal address" id="mailing_address" name="mailing_address" required defaultValue={value} placeholder="123 King St, Charleston, SC 29401, USA" className="min-w-[280px] flex-1" />
      <SubmitButton size="sm" pendingText="Saving…">Save</SubmitButton>
    </form>
  );
}

const FORMAT_HINT = "**bold**, *italics*, [link text](https://…), and “- ” at the start of a line for a bullet. {{first_name}}, {{name}} and {{org_name}} are filled in for each person.";

export type CampaignDraft = { id: number; name: string; subject: string; preheader: string; body: string; eventId: number | null; segmentId: number | null; status: string; scheduledIso: string | null; startedAt: boolean };

/** Local "YYYY-MM-DDTHH:MM" for a datetime-local input. */
const localInput = (iso: string | null) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function CampaignEditor({ org, campaign, events, segments, everyone, templates }: {
  org: string; campaign: CampaignDraft | null; events: { id: number; title: string }[]; segments: { id: number; name: string; size: number }[]; everyone: number;
  templates: { key: string; name: string; subject: string; body: string }[];
}) {
  const [state, action] = useActionState(saveCampaign, undefined);
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [body, setBody] = useState(campaign?.body ?? "");
  const [when, setWhen] = useState(localInput(campaign?.scheduledIso ?? null));
  const scheduledIso = (() => { const d = new Date(when); return Number.isNaN(d.getTime()) ? "" : d.toISOString(); })();
  const pickTemplate = (key: string) => {
    const t = templates.find((x) => x.key === key);
    if (!t) return;
    if ((subject || body) && !window.confirm("Replace the subject and text with this template?")) return;
    setSubject(t.subject);
    setBody(t.body);
  };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <form action={action} className="space-y-5">
      <FormStatus state={state} />
      <input type="hidden" name="org" value={org} />
      {campaign ? <input type="hidden" name="campaign_id" value={campaign.id} /> : null}
      <input type="hidden" name="scheduled_iso" value={scheduledIso} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Start from a template" id="template" name="template" defaultValue="" onChange={(e) => { pickTemplate(e.target.value); e.target.value = ""; }}
          options={[{ value: "", label: "Choose a template…" }, ...templates.map((t) => ({ value: t.key, label: t.name }))]} />
        <TextField label="Campaign name (only you see it)" id="name" name="name" maxLength={120} defaultValue={campaign?.name ?? ""} placeholder="Spring announcement" />
        <TextField label="Subject" id="subject" name="subject" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} className="sm:col-span-2" />
        <TextField label="Preview text (optional)" id="preheader" name="preheader" maxLength={200} defaultValue={campaign?.preheader ?? ""} hint="Shown next to the subject in most inboxes." className="sm:col-span-2" />
        <TextAreaField label="Email" id="body" name="body" required rows={14} value={body} onChange={(e) => setBody(e.target.value)} hint={FORMAT_HINT} className="sm:col-span-2" />
        <SelectField label="“Get tickets” button" id="event_id" name="event_id" defaultValue={campaign?.eventId ? String(campaign.eventId) : ""}
          options={[{ value: "", label: "No button" }, ...events.map((e) => ({ value: String(e.id), label: e.title }))]} hint="Links to the event page (on your custom domain when you have one)." />
        <SelectField label="Send to" id="segment_id" name="segment_id" defaultValue={campaign?.segmentId ? String(campaign.segmentId) : ""}
          options={[{ value: "", label: `Everyone subscribed (${everyone.toLocaleString()})` }, ...segments.map((s) => ({ value: String(s.id), label: `${s.name} (${s.size.toLocaleString()})` }))]}
          hint="Only people who opted in at checkout and have not unsubscribed. The list is fixed when sending starts." />
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-fx-red/10 bg-white p-4">
        <SubmitButton name="intent" value="draft" variant="outline" pendingText="Saving…">Save draft</SubmitButton>
        <div className="grid gap-1">
          <label htmlFor="when" className="text-xs font-medium">Send at ({tz})</label>
          <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-10 rounded-lg border bg-white px-3 text-sm" />
        </div>
        <SubmitButton name="intent" value="schedule" variant="outline" pendingText="Scheduling…">Schedule</SubmitButton>
        <SubmitButton name="intent" value="send" pendingText="Starting…" onClick={(e) => { if (!window.confirm("Send this campaign now?")) e.preventDefault(); }}>Send now</SubmitButton>
      </div>
    </form>
  );
}

export type SegmentView = { id: number; name: string; eventIds: number[]; excludeEventIds: number[]; minOrders?: number; boughtWithinDays?: number; notBoughtWithinDays?: number; minSpent?: string; cities: string };

export function SegmentDialog({ org, events, segment }: { org: string; events: { id: number; title: string }[]; segment?: SegmentView }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveSegment, undefined);
  const eventBoxes = (name: string, picked: number[]) => (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border bg-white p-2">
      {events.length === 0 ? <p className="text-xs text-muted-foreground">No events yet.</p> : events.map((e) => (
        <label key={e.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} value={e.id} defaultChecked={picked.includes(e.id)} className="size-4" />{e.title}</label>
      ))}
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={segment ? <Button size="sm" variant="ghost" /> : <Button />}>{segment ? <><PencilIcon /> Edit</> : <><PlusIcon /> New audience</>}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{segment ? `Edit “${segment.name}”` : "New audience"}</DialogTitle><DialogDescription>Subscribed contacts who match every rule you fill in. Leave a rule empty to ignore it.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} successText={state?.message} />
          <input type="hidden" name="org" value={org} />
          {segment ? <input type="hidden" name="segment_id" value={segment.id} /> : null}
          <TextField label="Name" id="sg-name" name="name" required maxLength={120} defaultValue={segment?.name} placeholder="Came to last summer's shows" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5"><span className="text-sm font-medium">Bought tickets to any of</span>{eventBoxes("event_ids", segment?.eventIds ?? [])}</div>
            <div className="grid gap-1.5"><span className="text-sm font-medium">But not to</span>{eventBoxes("exclude_event_ids", segment?.excludeEventIds ?? [])}</div>
            <TextField label="At least this many orders" id="sg-min" name="min_orders" type="number" min={1} defaultValue={segment?.minOrders ?? ""} />
            <TextField label="Spent at least ($)" id="sg-spent" name="min_spent" inputMode="decimal" defaultValue={segment?.minSpent ?? ""} />
            <TextField label="Bought in the last … days" id="sg-recent" name="bought_within_days" type="number" min={1} defaultValue={segment?.boughtWithinDays ?? ""} />
            <TextField label="No order in the last … days" id="sg-lapsed" name="not_bought_within_days" type="number" min={1} defaultValue={segment?.notBoughtWithinDays ?? ""} />
            <TextField label="Went to events in (cities, comma separated)" id="sg-cities" name="cities" defaultValue={segment?.cities ?? ""} className="sm:col-span-2" />
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button><SubmitButton pendingText="Saving…">Save audience</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TemplateDialog({ org, template, from }: { org: string; template?: { id: number; name: string; subject: string; body: string }; from?: { name: string; subject: string; body: string } }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveTemplate, undefined);
  const t = template ?? from;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={template || from ? <Button size="sm" variant="ghost" /> : <Button />}>{template ? <><PencilIcon /> Edit</> : from ? <><PlusIcon /> Save a copy</> : <><PlusIcon /> New template</>}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{template ? `Edit “${template.name}”` : "New template"}</DialogTitle><DialogDescription>Templates appear in the campaign editor under “Start from a template”.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} successText={state?.message} />
          <input type="hidden" name="org" value={org} />
          {template ? <input type="hidden" name="template_id" value={template.id} /> : null}
          <TextField label="Name" id="tp-name" name="name" required maxLength={120} defaultValue={from ? `${from.name} (mine)` : t?.name} />
          <TextField label="Subject" id="tp-subject" name="subject" required maxLength={200} defaultValue={t?.subject} />
          <TextAreaField label="Email" id="tp-body" name="body" required rows={10} defaultValue={t?.body} hint={FORMAT_HINT} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button><SubmitButton pendingText="Saving…">Save template</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

