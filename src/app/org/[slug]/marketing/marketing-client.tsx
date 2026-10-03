"use client";

import { useActionState, useState } from "react";
import { useClearOnSuccess } from "@/components/form-validation";
import { PencilIcon, PlusIcon } from "lucide-react";
import { deleteTrackingLink, savePixels, saveTrackingLink } from "@/lib/marketing/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { CopyButton } from "@/components/copy-button";
import { CheckField, FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type LinkView = { id: number; code: string; name: string; eventId: number | null; eventTitle: string | null; utmSource: string; utmMedium: string; utmCampaign: string; clicks: number; orders: number; tickets: number; revenue: string; active: boolean; url: string };

function LinkDialog({ orgSlug, events, link }: { orgSlug: string; events: { id: number; title: string }[]; link?: LinkView }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveTrackingLink, undefined);
  const form = useClearOnSuccess(link ? undefined : state);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={link ? <Button size="sm" variant="ghost" /> : <Button />}>{link ? <><PencilIcon /> Edit</> : <><PlusIcon /> New tracking link</>}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{link ? `Edit “${link.name}”` : "New tracking link"}</DialogTitle><DialogDescription>Give each promoter, influencer or channel its own link. Clicks, orders and revenue are reported per link.</DialogDescription></DialogHeader>
        <form ref={form} action={action} className="space-y-4">
          <FormStatus state={state} successText={state?.message} />
          <input type="hidden" name="org" value={orgSlug} />
          {link ? <input type="hidden" name="link_id" value={link.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Promoter / channel name" id="tl-name" name="name" required maxLength={120} defaultValue={link?.name} className="sm:col-span-2" />
            <SelectField label="Event" id="tl-event" name="event_id" defaultValue={link?.eventId ? String(link.eventId) : ""} className="sm:col-span-2" options={[{ value: "", label: "Any event (link opens the home page)" }, ...events.map((e) => ({ value: String(e.id), label: e.title }))]} />
            <TextField label="utm_source" id="tl-src" name="utm_source" maxLength={80} defaultValue={link?.utmSource} placeholder="instagram" hint="Defaults to the name" />
            <TextField label="utm_medium" id="tl-med" name="utm_medium" maxLength={80} defaultValue={link?.utmMedium} placeholder="social" hint="Defaults to referral" />
            <TextField label="utm_campaign" id="tl-camp" name="utm_campaign" maxLength={120} defaultValue={link?.utmCampaign} placeholder="spring-onsale" className="sm:col-span-2" />
          </div>
          {link ? <CheckField id="tl-active" name="active" label="Active" defaultChecked={link.active} /> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button><SubmitButton pendingText="Saving…">Save link</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TrackingLinks({ orgSlug, events, links }: { orgSlug: string; events: { id: number; title: string }[]; links: LinkView[] }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><LinkDialog orgSlug={orgSlug} events={events} /></div>
      {links.length === 0 ? <p className="text-sm text-muted-foreground">No tracking links yet.</p> : (
        <Table>
          <TableHeader><TableRow><TableHead>Link</TableHead><TableHead>Event</TableHead><TableHead className="text-right">Clicks</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Tickets</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {links.map((l) => (
              <TableRow key={l.id}>
                <TableCell><span className="font-medium">{l.name}</span> {!l.active ? <Badge variant="outline">inactive</Badge> : null}<span className="block font-mono text-xs text-muted-foreground">{l.url}</span><span className="block text-xs text-muted-foreground">{l.utmSource} / {l.utmMedium}{l.utmCampaign ? ` / ${l.utmCampaign}` : ""}</span></TableCell>
                <TableCell className="text-sm">{l.eventTitle ?? "Any"}</TableCell>
                <TableCell className="text-right tabular-nums">{l.clicks}</TableCell>
                <TableCell className="text-right tabular-nums">{l.orders}</TableCell>
                <TableCell className="text-right tabular-nums">{l.tickets}</TableCell>
                <TableCell className="text-right font-mono">{l.revenue}</TableCell>
                <TableCell className="text-right"><div className="flex justify-end gap-1"><CopyButton value={l.url} label="Copy" /><LinkDialog orgSlug={orgSlug} events={events} link={l} /><ConfirmButton action={deleteTrackingLink} fields={{ org: orgSlug, link_id: l.id }} title={`Delete “${l.name}”?`} description="A link with orders is deactivated instead, so reports stay complete." confirmText="Delete" variant="ghost">Delete</ConfirmButton></div></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function PixelsForm({ orgSlug, meta, ga4, canEdit }: { orgSlug: string; meta: string; ga4: string; canEdit: boolean }) {
  const [state, action] = useActionState(savePixels, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={orgSlug} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Meta Pixel ID" id="px-meta" name="meta_pixel_id" defaultValue={meta} inputMode="numeric" disabled={!canEdit} placeholder="123456789012345" />
        <TextField label="Google Analytics 4 ID" id="px-ga" name="ga4_id" defaultValue={ga4} disabled={!canEdit} placeholder="G-XXXXXXXXXX" />
      </div>
      <p className="text-xs text-muted-foreground">Pixels load only on your public event pages, only after a visitor accepts the consent banner, and never on checkout or payment pages.</p>
      {canEdit ? <div className="flex justify-end"><SubmitButton size="sm" pendingText="Saving…">Save</SubmitButton></div> : <p className="text-xs text-muted-foreground">Only Organization Admins can change these.</p>}
    </form>
  );
}
