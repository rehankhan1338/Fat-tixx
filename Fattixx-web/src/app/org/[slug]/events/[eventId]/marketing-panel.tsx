"use client";

import { useActionState, useState } from "react";
import { useClearOnSuccess } from "@/components/form-validation";
import { PencilIcon, PlusIcon } from "lucide-react";
import { deletePromoCode, deleteSponsor, saveOnSaleSettings, savePromoCode, saveSponsor } from "@/lib/marketing/actions";
import { setCampaignStatus } from "@/lib/ads/actions";
import { CampaignForm, EMPTY_CAMPAIGN, type CampaignValues } from "@/components/ads/campaign-form";
import { CreativesPanel, type CreativeView } from "@/components/ads/creatives-panel";
import { ConfirmButton } from "@/components/confirm-button";
import { CopyButton } from "@/components/copy-button";
import { CheckField, FormStatus, SelectField, TextField } from "@/components/form-fields";
import { Section, StatusBadge } from "@/components/shared";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export type PromoView = { id: number; code: string; kind: "percent" | "amount"; valueInput: string; label: string; ticketTypeIds: number[]; maxUses: number | null; used: number; discountTotal: string; startsAt: string; endsAt: string; active: boolean; window: string };
export type SponsorView = { id: number; name: string; logoUrl: string | null; url: string | null; tier: string | null; visibleFrom: string; visibleUntil: string; sortOrder: number };
export type SponsorAdView = { values: CampaignValues; status: string; impressions: number; clicks: number; ctr: string; creatives: CreativeView[] };

type Ctx = { orgSlug: string; eventId: number };

function PromoDialog({ ctx, promo, ticketTypes, currency }: { ctx: Ctx; promo?: PromoView; ticketTypes: { id: number; name: string }[]; currency: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(savePromoCode, undefined);
  const form = useClearOnSuccess(promo ? undefined : state); // a new code: blank for the next one
  const [kind, setKind] = useState<"percent" | "amount">(promo?.kind ?? "percent");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={promo ? <Button size="sm" variant="ghost" /> : <Button size="sm" />}>{promo ? <><PencilIcon /> Edit</> : <><PlusIcon /> New promo code</>}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{promo ? `Edit ${promo.code}` : "New promo code"}</DialogTitle><DialogDescription>Discounts apply to the ticket price; fees and tax are recalculated on the discounted price.</DialogDescription></DialogHeader>
        <form ref={form} action={action} className="space-y-4">
          <FormStatus state={state} successText={state?.message} />
          <input type="hidden" name="org" value={ctx.orgSlug} /><input type="hidden" name="event_id" value={ctx.eventId} />
          {promo ? <input type="hidden" name="promo_id" value={promo.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Code" id="pc-code" name="code" required maxLength={40} defaultValue={promo?.code} className="[&_input]:font-mono [&_input]:uppercase" hint="What buyers type, e.g. EARLYBIRD" />
            <SelectField label="Discount type" id="pc-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as "percent" | "amount")} options={[{ value: "percent", label: "Percent off" }, { value: "amount", label: `Amount off per ticket (${currency})` }]} />
            <TextField label={kind === "percent" ? "Percent off" : "Amount off per ticket"} id="pc-value" name="value" required inputMode="decimal" defaultValue={promo?.valueInput} placeholder={kind === "percent" ? "10" : "5.00"} />
            <TextField label="Max uses (tickets)" id="pc-max" name="max_uses" type="number" min={1} defaultValue={promo?.maxUses ?? ""} hint="Blank = unlimited" />
            <TextField label="Valid from" id="pc-start" name="starts_at" type="datetime-local" defaultValue={promo?.startsAt} />
            <TextField label="Valid until" id="pc-end" name="ends_at" type="datetime-local" defaultValue={promo?.endsAt} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Applies to <span className="font-normal text-muted-foreground">(none selected = all paid ticket types)</span></legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ticketTypes.map((t) => (
                <label key={t.id} className="flex items-center gap-2 rounded-md border p-2 text-sm"><input type="checkbox" name="ticket_type_ids" value={t.id} defaultChecked={promo?.ticketTypeIds.includes(t.id)} className="size-4 accent-[var(--primary)]" />{t.name}</label>
              ))}
            </div>
          </fieldset>
          <CheckField id="pc-active" name="active" label="Active" defaultChecked={promo ? promo.active : true} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button><SubmitButton pendingText="Saving…">Save</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SponsorDialog({ ctx, sponsor }: { ctx: Ctx; sponsor?: SponsorView }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveSponsor, undefined);
  const form = useClearOnSuccess(sponsor ? undefined : state);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={sponsor ? <Button size="sm" variant="ghost" /> : <Button size="sm" />}>{sponsor ? <><PencilIcon /> Edit</> : <><PlusIcon /> Add sponsor</>}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{sponsor ? `Edit ${sponsor.name}` : "Add sponsor"}</DialogTitle><DialogDescription>Sponsor logos appear on the event page under “Sponsored by”, inside the visibility window.</DialogDescription></DialogHeader>
        <form ref={form} action={action} className="space-y-4">
          <FormStatus state={state} successText={state?.message} />
          <input type="hidden" name="org" value={ctx.orgSlug} /><input type="hidden" name="event_id" value={ctx.eventId} />
          {sponsor ? <input type="hidden" name="sponsor_id" value={sponsor.id} /> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Sponsor name" id="sp-name" name="name" required maxLength={160} defaultValue={sponsor?.name} />
            <TextField label="Tier" id="sp-tier" name="tier" maxLength={40} defaultValue={sponsor?.tier ?? ""} placeholder="Presenting, Gold…" />
            <TextField label="Website" id="sp-url" name="url" type="url" placeholder="https://" defaultValue={sponsor?.url ?? ""} className="sm:col-span-2" />
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="sp-logo">Logo {sponsor?.logoUrl ? "(leave empty to keep the current one)" : ""}</Label><Input id="sp-logo" name="logo" type="file" accept="image/jpeg,image/png,image/webp" /></div>
            <TextField label="Visible from" id="sp-from" name="visible_from" type="datetime-local" defaultValue={sponsor?.visibleFrom} />
            <TextField label="Visible until" id="sp-until" name="visible_until" type="datetime-local" defaultValue={sponsor?.visibleUntil} />
            <TextField label="Display order" id="sp-sort" name="sort_order" type="number" min={0} defaultValue={sponsor?.sortOrder ?? 0} />
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button><SubmitButton pendingText="Saving…">Save sponsor</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OnSaleForm({ ctx, enabled, rate, stats }: { ctx: Ctx; enabled: boolean; rate: number; stats: { waiting: number; admittedLastHour: number } }) {
  const [state, action] = useActionState(saveOnSaleSettings, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormStatus state={state} successText={state?.message} />
      <input type="hidden" name="org" value={ctx.orgSlug} /><input type="hidden" name="event_id" value={ctx.eventId} />
      <CheckField id="q-on" name="queue_enabled" label="Virtual waiting room" hint="Visitors get a place in line and are let through at the rate below, first come first served. Turn on shortly before a high-demand on-sale." defaultChecked={enabled} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="People let through per minute" id="q-rate" name="queue_rate_per_min" type="number" min={1} max={100000} defaultValue={rate} hint="Each admission lasts 20 minutes." />
        <div className="rounded-lg border p-3 text-sm"><p className="text-xs text-muted-foreground">Right now</p><p><span className="font-semibold tabular-nums">{stats.waiting}</span> waiting · <span className="font-semibold tabular-nums">{stats.admittedLastHour}</span> admitted in the last hour</p></div>
      </div>
      <div className="flex justify-end"><SubmitButton size="sm" pendingText="Saving…">Save</SubmitButton></div>
    </form>
  );
}

export function MarketingPanel({ ctx, currency, ticketTypes, promos, sponsors, sponsorAds, queue, embedSnippet, embedUrl }: {
  ctx: Ctx; currency: string; ticketTypes: { id: number; name: string }[]; promos: PromoView[]; sponsors: SponsorView[]; sponsorAds: SponsorAdView[];
  queue: { enabled: boolean; rate: number; stats: { waiting: number; admittedLastHour: number } }; embedSnippet: string; embedUrl: string;
}) {
  const fields = { org: ctx.orgSlug, event_id: ctx.eventId };
  return (
    <div className="space-y-6">
      <Section title="Promo codes" description="Discount codes buyers enter at checkout. Usage counts tickets, including those currently held in checkout." actions={<PromoDialog ctx={ctx} ticketTypes={ticketTypes} currency={currency} />}>
        {promos.length === 0 ? <p className="text-sm text-muted-foreground">No promo codes yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Discount</TableHead><TableHead>Valid</TableHead><TableHead className="text-right">Used</TableHead><TableHead className="text-right">Discount given</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {promos.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">{p.code} {!p.active ? <Badge variant="outline" className="ml-1">inactive</Badge> : null}</TableCell>
                  <TableCell>{p.label}{p.ticketTypeIds.length ? <span className="block text-xs text-muted-foreground">{ticketTypes.filter((t) => p.ticketTypeIds.includes(t.id)).map((t) => t.name).join(", ")}</span> : null}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.window}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.used}{p.maxUses ? ` / ${p.maxUses}` : ""}</TableCell>
                  <TableCell className="text-right font-mono">{p.discountTotal}</TableCell>
                  <TableCell className="text-right"><div className="flex justify-end gap-1"><PromoDialog ctx={ctx} promo={p} ticketTypes={ticketTypes} currency={currency} /><ConfirmButton action={deletePromoCode} fields={{ ...fields, promo_id: p.id }} title={`Delete ${p.code}?`} description="A code that has been used is deactivated instead, so reports stay complete." confirmText="Delete" variant="ghost">Delete</ConfirmButton></div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Sponsors" description="Shown on the event page. Logos are resized and converted for fast loading." actions={<SponsorDialog ctx={ctx} />}>
        {sponsors.length === 0 ? <p className="text-sm text-muted-foreground">No sponsors yet.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sponsors.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- sponsor logo preview */}
                {s.logoUrl ? <img src={s.logoUrl} alt="" className="h-10 w-16 object-contain" /> : <div className="flex h-10 w-16 items-center justify-center rounded bg-muted text-xs">no logo</div>}
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{s.name}</p><p className="truncate text-xs text-muted-foreground">{s.tier ?? "Sponsor"}{s.visibleUntil ? ` · until ${s.visibleUntil.replace("T", " ")}` : ""}</p></div>
                <SponsorDialog ctx={ctx} sponsor={s} />
                <ConfirmButton action={deleteSponsor} fields={{ ...fields, sponsor_id: s.id }} title={`Remove ${s.name}?`} confirmText="Remove" variant="ghost">Remove</ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Sponsor ads" description="Promote a sponsor with an image ad on this event's page and order confirmations. A Fat Tixx admin reviews every sponsor ad before it goes live; impressions and clicks are reported here.">
        <div className="space-y-6">
          {sponsorAds.map((a) => (
            <div key={a.values.id} className="space-y-4 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{a.values.name} <StatusBadge status={a.status} /></p>
                <p className="text-sm text-muted-foreground tabular-nums">{a.impressions.toLocaleString()} impressions · {a.clicks.toLocaleString()} clicks · CTR {a.ctr}</p>
                {a.status === "active" || a.status === "scheduled" ? <ConfirmButton action={setCampaignStatus} fields={{ org: ctx.orgSlug, event: ctx.eventId, id: a.values.id!, status: "paused" }} title="Pause this ad?" confirmText="Pause" variant="outline">Pause</ConfirmButton> : null}
              </div>
              <CreativesPanel campaignId={a.values.id!} creatives={a.creatives} scope={{ org: ctx.orgSlug, event: ctx.eventId }} />
              <details><summary className="cursor-pointer text-sm font-medium">Settings</summary><div className="pt-3"><CampaignForm values={a.values} scope={{ org: ctx.orgSlug, event: ctx.eventId }} /></div></details>
            </div>
          ))}
          <details className="rounded-xl border border-dashed p-4" open={sponsorAds.length === 0}>
            <summary className="cursor-pointer text-sm font-medium">New sponsor ad</summary>
            <div className="pt-3"><CampaignForm values={{ ...EMPTY_CAMPAIGN, kind: "sponsored", placements: ["event_detail"] }} scope={{ org: ctx.orgSlug, event: ctx.eventId }} /></div>
          </details>
        </div>
      </Section>

      <Section title="High-demand on-sale" description="Purchase limits are set per ticket type (Ticket types tab). Bot protection and inventory holds are always on.">
        <OnSaleForm ctx={ctx} enabled={queue.enabled} rate={queue.rate} stats={queue.stats} />
      </Section>

      <Section title="Embed on your website" description="Paste this where tickets should appear. Buyers choose tickets on your site; payment continues securely on Fat Tixx.">
        <div className="space-y-2">
          <Textarea readOnly value={embedSnippet} rows={2} className="font-mono text-xs" aria-label="Embed code" />
          <div className="flex flex-wrap gap-2"><CopyButton value={embedSnippet} label="Copy embed code" /><Button variant="outline" size="sm" nativeButton={false} render={<a href={embedUrl} target="_blank" rel="noopener" />}>Preview widget</Button></div>
        </div>
      </Section>
    </div>
  );
}
