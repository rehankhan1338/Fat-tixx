"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { ExternalLinkIcon, MinusIcon, PlusIcon, TagIcon } from "lucide-react";
import { startCheckout } from "@/lib/orders/actions";
import { formatCents } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CheckField, FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { BotFields } from "@/components/bot-fields";
import { Captcha } from "@/components/captcha";

/** Promoter / UTM attribution passed through from the event page URL. */
export interface Attribution { ref?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string }

export interface TicketOption { id: number; name: string; description: string | null; kind: string; priceCents: number; allInCents: number; available: number; min: number; max: number; seats: number; onSale: boolean; reason?: string; salesStart: string | null; presale?: boolean; dayLabel?: string | null }
export interface AddonOption { id: number; name: string; description: string | null; priceCents: number; allInCents: number; available: number | null; max: number }
export interface QuestionView { id: number; label: string; kind: "text" | "textarea" | "select" | "checkbox"; required: boolean; options: string[] }

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size="icon-sm" aria-label="Fewer" disabled={value === 0} onClick={() => onChange(value <= min ? 0 : value - 1)}><MinusIcon /></Button>
      <span className="w-6 text-center font-mono text-sm tabular-nums">{value}</span>
      <Button type="button" variant="outline" size="icon-sm" aria-label="More" disabled={value >= max} onClick={() => onChange(value === 0 ? Math.min(min, max) : value + 1)}><PlusIcon /></Button>
    </div>
  );
}

export function TicketSelector({ eventSlug, currency, options, addons = [], questions = [], accessCode = "", ageRestriction, defaultEmail, defaultName, hasPromo = false, attribution = {}, channel = "web", smsEnabled = false }: {
  eventSlug: string; currency: string; options: TicketOption[]; addons?: AddonOption[]; questions?: QuestionView[]; accessCode?: string; ageRestriction: number | null; defaultEmail?: string; defaultName?: string;
  hasPromo?: boolean; attribution?: Attribution; channel?: "web" | "embed"; smsEnabled?: boolean;
}) {
  const [qty, setQty] = useState<Record<number, number>>({});
  const [addonQty, setAddonQty] = useState<Record<number, number>>({});
  const [state, action] = useActionState(startCheckout, undefined);
  const ticketTotal = useMemo(() => options.reduce((n, o) => n + (qty[o.id] ?? 0) * o.allInCents, 0), [options, qty]);
  const addonTotal = useMemo(() => addons.reduce((n, a) => n + (addonQty[a.id] ?? 0) * a.allInCents, 0), [addons, addonQty]);
  const total = ticketTotal + addonTotal;
  const count = Object.values(qty).reduce((a, b) => a + b, 0);
  const addonCount = Object.values(addonQty).reduce((a, b) => a + b, 0);

  // Embedded widget: continue checkout in a new tab (payment is never taken inside a third-party iframe).
  const checkoutUrl = state?.checkoutUrl;
  useEffect(() => { if (checkoutUrl) window.open(checkoutUrl, "_blank", "noopener"); }, [checkoutUrl]);

  const set = (o: TicketOption, next: number) => setQty((q) => ({ ...q, [o.id]: Math.max(0, Math.min(next, o.max, o.available)) }));
  const setAddon = (a: AddonOption, next: number) => setAddonQty((q) => ({ ...q, [a.id]: Math.max(0, Math.min(next, a.max, a.available ?? Infinity)) }));

  return (
    <form action={action} className="relative space-y-4">
      <FormStatus state={state} />
      {checkoutUrl ? <p className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">Your tickets are reserved for 10 minutes. <a href={checkoutUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium underline">Continue to secure checkout <ExternalLinkIcon className="size-3.5" /></a></p> : null}
      <BotFields />
      <input type="hidden" name="event" value={eventSlug} />
      <input type="hidden" name="channel" value={channel} />
      {Object.entries(attribution).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {accessCode ? <input type="hidden" name="access_code" value={accessCode} /> : null}
      <ul className="space-y-3">
        {options.map((o) => {
          const n = qty[o.id] ?? 0;
          return (
            <li key={o.id} className={`rounded-xl border p-3 ${o.onSale ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{o.name}{o.kind === "table" ? <span className="ml-1 text-xs text-muted-foreground">· table of {o.seats}</span> : null}{o.presale ? <Badge variant="outline" className="ml-2 text-[10px]">presale</Badge> : null}</p>
                  {o.dayLabel ? <p className="text-xs text-muted-foreground">Valid {o.dayLabel} only</p> : null}
                  {o.description ? <p className="text-xs text-muted-foreground">{o.description}</p> : null}
                  <p className="mt-1 text-sm">{o.allInCents === 0 ? <span className="font-semibold">Free</span> : <><span className="font-semibold">{formatCents(o.allInCents, currency)}</span>{o.allInCents !== o.priceCents ? <span className="ml-1 text-xs text-muted-foreground">all-in ({formatCents(o.priceCents, currency)} + fees)</span> : null}</>}</p>
                  {!o.onSale ? <p className="mt-1 text-xs text-muted-foreground">{o.reason === "sold_out" ? "Sold out" : o.reason === "not_yet" ? `On sale ${o.salesStart}` : "Sales ended"}</p> : o.available <= 10 ? <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Only {o.available} left</p> : null}
                </div>
                {o.onSale ? (
                  <div>
                    <Stepper value={n} min={o.min} max={Math.min(o.max, o.available)} onChange={(v) => set(o, v)} />
                    <input type="hidden" name={`qty_${o.id}`} value={n} />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {count > 0 && addons.length > 0 ? (
        <>
          <Separator />
          <div>
            <p className="mb-2 text-sm font-medium">Add-ons <span className="text-xs font-normal text-muted-foreground">(optional)</span></p>
            <ul className="space-y-2">
              {addons.map((a) => {
                const n = addonQty[a.id] ?? 0;
                const gone = a.available !== null && a.available <= 0;
                return (
                  <li key={a.id} className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${gone ? "opacity-60" : ""}`}>
                    <div className="min-w-0">
                      <p className="font-medium">{a.name}</p>
                      {a.description ? <p className="text-xs text-muted-foreground">{a.description}</p> : null}
                      <p className="mt-1 text-sm">{a.allInCents === 0 ? <span className="font-semibold">Free</span> : <span className="font-semibold">{formatCents(a.allInCents, currency)}</span>}{gone ? <span className="ml-2 text-xs text-muted-foreground">Sold out</span> : a.available !== null && a.available <= 10 ? <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">Only {a.available} left</span> : null}</p>
                    </div>
                    {!gone ? <div><Stepper value={n} min={1} max={Math.min(a.max, a.available ?? a.max)} onChange={(v) => setAddon(a, v)} /><input type="hidden" name={`addon_${a.id}`} value={n} /></div> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}

      {count > 0 ? (
        <>
          <Separator />
          <div className="flex items-center justify-between text-sm"><span>{count} ticket{count === 1 ? "" : "s"}{addonCount ? ` + ${addonCount} add-on${addonCount === 1 ? "" : "s"}` : ""}</span><span className="font-semibold">{formatCents(total, currency)}</span></div>
          <div className="grid gap-3">
            <TextField label="Your name" id="name" name="name" required autoComplete="name" defaultValue={defaultName} />
            <TextField label="Email for your tickets" id="email" name="email" type="email" required autoComplete="email" defaultValue={defaultEmail} />
            <TextField label="Phone (optional)" id="phone" name="phone" type="tel" autoComplete="tel" />
            {smsEnabled ? <CheckField id="sms" name="sms" label="Text me my ticket link and a reminder" hint="Uses the phone number above. Message rates may apply." /> : null}
            {questions.map((q) => {
              const id = `q-${q.id}`, name = `q_${q.id}`;
              const label = q.required ? <>{q.label} <span className="text-destructive">*</span></> : q.label;
              if (q.kind === "checkbox") return <CheckField key={q.id} id={id} name={name} label={label} />;
              if (q.kind === "select") return <SelectField key={q.id} id={id} name={name} label={label} required={q.required} options={[{ value: "", label: "— Choose —" }, ...q.options.map((o) => ({ value: o, label: o }))]} />;
              if (q.kind === "textarea") return <TextAreaField key={q.id} id={id} name={name} label={label} required={q.required} rows={3} maxLength={1000} />;
              return <TextField key={q.id} id={id} name={name} label={label} required={q.required} maxLength={500} />;
            })}
            {hasPromo ? <TextField label={<span className="inline-flex items-center gap-1.5"><TagIcon className="size-3.5" /> Promo code (optional)</span>} id="promo_code" name="promo_code" maxLength={40} autoComplete="off" className="font-mono uppercase" hint="The discount is applied on the next step." /> : null}
            <CheckField id="marketing" name="marketing" label="Email me about future events from this organizer" />
            {ageRestriction ? <p className="text-xs text-amber-700 dark:text-amber-300">This event is {ageRestriction}+. Every attendee must show a valid photo ID at the door.</p> : null}
          </div>
          <Captcha />
          <SubmitButton className="w-full" size="lg" pendingText="Reserving…">{total === 0 ? "Get free tickets" : `Continue to payment · ${formatCents(total, currency)}`}</SubmitButton>
          <p className="text-center text-xs text-muted-foreground">Your tickets are held for 10 minutes while you check out.</p>
        </>
      ) : null}
    </form>
  );
}
