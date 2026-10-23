"use client";

/*
 * Ticket selection and checkout inside the event page's ticket pop-up. Posts to the same startCheckout action as the
 * embeddable widget: quantities, the buyer's details, checkout questions, add-ons, promo and access codes. Checkout
 * then continues on /checkout/<code> (Stripe), or completes at once for free tickets.
 */

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { BotFields } from "@/components/bot-fields";
import { Captcha } from "@/components/captcha";
import { button, cx } from "@/components/ui/styles";
import type { AddonType, QuestionView, SeatingView, TicketType } from "@/lib/home/event-page";
import SeatPicker from "./SeatPicker";
import type { FeePayer } from "@/lib/home/pricing";
import { startCheckout } from "@/lib/orders/actions";
import { formatCents } from "@/lib/money";
import { WaitlistForm } from "@/app/events/[slug]/waitlist-form";
import { WaitingRoom } from "@/app/events/[slug]/waiting-room";
import { LockIcon, MinusIcon, PlusIcon } from "./icons";
import { useEventEnded } from "./useEventEnded";

const LOW = 20; // show "Only N left" at or below this

/** Promoter / UTM attribution passed through from the event page URL. */
export type Attribution = { ref?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string };

export type TicketPanelProps = {
  eventId: number;
  eventSlug: string;
  currency: string;
  feePayer: FeePayer;
  rsvp: boolean;
  /** the event's end, ISO with timezone offset */
  endIso: string;
  refundText: string;
  /** what the pop-up shows: the ticket list, the virtual waiting room, or a message */
  mode: "tickets" | "queue" | "unpublished" | "none" | "presale_only";
  tickets: TicketType[];
  addons: AddonType[];
  questions: QuestionView[];
  accessCode: string;
  ageRestriction: number | null;
  defaultEmail?: string;
  defaultName?: string;
  hasPromo: boolean;
  attribution: Attribution;
  smsEnabled: boolean;
  presale: { enabled: boolean; linkKey: string | null; codeRejected: boolean; unlocked: string[] };
  waitlist: { show: boolean; soldOutTypes: { id: number; name: string }[]; allSoldOut: boolean };
  /** reserved seating: seated tiers are bought by picking seats on this map */
  seating?: SeatingView | null;
};

const input =
  "w-full min-h-12 rounded-[14px] border border-fx-red/20 bg-white px-4 text-[15px] text-fx-ink outline-none transition-colors placeholder:text-fx-red/55 focus:border-fx-red aria-invalid:border-fx-red-second";
const labelCls = "block text-[13px] font-semibold text-fx-red/78";

function Field({ id, label, children, hint }: { id: string; label: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint && <p className="mt-1 text-[12px] text-fx-red/78">{hint}</p>}
    </div>
  );
}

function Check({ id, name, label, hint }: { id: string; name: string; label: ReactNode; hint?: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-[14px] border border-fx-red/14 bg-white px-4 py-3">
      <input id={id} name={name} type="checkbox" value="1" className="mt-[3px] size-4 accent-[#A8121A]" />
      <span className="grid gap-[2px] text-[14px] leading-[1.4]">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-[12px] text-fx-red/78">{hint}</span>}
      </span>
    </label>
  );
}

/** Nothing chosen yet: one button (`label`) that picks the first ticket(s); after that the minus / count / plus controls. */
function Stepper({ value, min, max, name, label = "Buy", onChange }: { value: number; min: number; max: number; name: string; label?: string; onChange: (n: number) => void }) {
  if (value === 0) {
    return (
      <button
        type="button"
        onClick={() => onChange(Math.min(Math.max(min, 1), max))}
        aria-label={`${label} ${name}`}
        className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full bg-fx-red px-5 text-[14px] font-semibold text-fx-ivory transition-opacity hover:opacity-88"
      >
        {label}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`${name} quantity`}>
      <button
        type="button"
        onClick={() => onChange(value <= min ? 0 : value - 1)}
        disabled={value === 0}
        aria-label={`Remove one ${name} ticket`}
        className="grid size-10 cursor-pointer place-items-center rounded-full border border-fx-red/25 text-fx-red transition-colors hover:border-fx-red disabled:cursor-not-allowed disabled:opacity-35"
      >
        <MinusIcon />
      </button>
      <output aria-live="polite" aria-label={`${name} selected`} className="w-8 text-center text-[17px] font-semibold tabular-nums">
        {value}
      </output>
      <button
        type="button"
        onClick={() => onChange(value === 0 ? Math.min(Math.max(min, 1), max) : value + 1)}
        disabled={value >= max}
        aria-label={`Add one ${name} ticket`}
        className="grid size-10 cursor-pointer place-items-center rounded-full bg-fx-red text-fx-ivory transition-opacity hover:opacity-88 disabled:cursor-not-allowed disabled:opacity-35"
      >
        <PlusIcon />
      </button>
    </div>
  );
}

function CheckoutButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      className="inline-flex min-h-[54px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-fx-red px-9 text-[16px] font-semibold text-fx-ivory transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 max-[481px]:px-6"
    >
      {pending ? "Reserving…" : label}
    </button>
  );
}

function Heading({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 pr-14 pb-2 max-[721px]:pr-0">
      <h2 id="tickets-h" tabIndex={-1} className="font-display text-[24px] font-semibold tracking-[-0.02em] outline-none">
        {children}
      </h2>
      {note && <span className="text-[13px] text-fx-red/78">{note}</span>}
    </div>
  );
}

export default function TicketPanel(p: TicketPanelProps) {
  const [qty, setQty] = useState<Record<number, number>>({});
  const [addonQty, setAddonQty] = useState<Record<number, number>>({});
  const [seatSel, setSeatSel] = useState<number[]>([]);
  const [state, action] = useActionState(startCheckout, undefined);
  const ended = useEventEnded(p.endIso);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state?.error) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [state]);

  const rows = useMemo(
    () =>
      // seated tiers are picked on the seat map instead
      p.tickets.filter((t) => !t.seated || !p.seating).map((t) => {
        const limit = Math.max(0, Math.min(t.maxPerOrder, t.remaining));
        return { t, limit, buyable: t.status === "on_sale" && limit > 0 };
      }),
    [p.tickets, p.seating],
  );
  const seatTier = (id: number) => {
    const tier = p.seating?.seats.find((s) => s.id === id)?.tier;
    return tier ? p.seating?.tiers.find((t) => t.id === tier) : undefined;
  };
  const seatTiers = seatSel.map(seatTier);
  const count = rows.reduce((n, r) => n + (qty[r.t.id] ?? 0), 0) + seatSel.length;
  const addonCount = p.addons.reduce((n, a) => n + (addonQty[a.id] ?? 0), 0);
  const ticketTotal = rows.reduce((n, r) => n + (qty[r.t.id] ?? 0) * r.t.allInCents, 0) + seatTiers.reduce((n, t) => n + (t?.allInCents ?? 0), 0);
  const addonTotal = p.addons.reduce((n, a) => n + (addonQty[a.id] ?? 0) * a.allInCents, 0);
  const total = ticketTotal + addonTotal;
  const fees = p.feePayer === "buyer"
    ? rows.reduce((n, r) => n + (qty[r.t.id] ?? 0) * Math.max(0, r.t.allInCents - r.t.priceCents), 0) + seatTiers.reduce((n, t) => n + Math.max(0, (t?.allInCents ?? 0) - (t?.priceCents ?? 0)), 0)
    : 0;
  const seatsOnSale = !!p.seating?.tiers.some((t) => t.status === "on_sale");
  const anyBuyable = rows.some((r) => r.buyable) || seatsOnSale;
  const upcoming = rows.some((r) => r.t.status === "scheduled") || !!p.seating?.tiers.some((t) => t.status === "scheduled");
  const allFree = p.tickets.length > 0 && p.tickets.every((t) => t.allInCents === 0);

  const set = (t: TicketType, limit: number, next: number) => setQty((q) => ({ ...q, [t.id]: Math.max(0, Math.min(next, limit)) }));
  const setAddon = (a: AddonType, next: number) => setAddonQty((q) => ({ ...q, [a.id]: Math.max(0, Math.min(next, a.max, a.available ?? Infinity)) }));

  if (ended) {
    return (
      <div className="pt-2 pr-14 pb-2 max-[721px]:pr-0">
        <Heading>This event has ended</Heading>
        <p className="mt-2 text-[15px] text-fx-red/78">{p.rsvp ? "Registration is closed." : "Tickets are no longer on sale."}</p>
        <Link href="/events" className={cx(button("red"), "mt-5")}>
          Find more events
        </Link>
      </div>
    );
  }

  if (p.mode === "unpublished") {
    return (
      <div className="pt-2 pr-14 pb-2 max-[721px]:pr-0">
        <Heading>Tickets</Heading>
        <p className="mt-2 text-[15px] text-fx-red/78">Tickets go on sale when this event is published.</p>
      </div>
    );
  }

  if (p.mode === "queue") {
    return (
      <div className="pt-2 pr-14 pb-4 max-[721px]:pr-0">
        <Heading>Tickets</Heading>
        <div className="fx-form mt-4 rounded-[18px] bg-white p-5">
          <WaitingRoom eventId={p.eventId} />
        </div>
      </div>
    );
  }

  const presaleForm = p.presale.enabled && (
    <form method="get" className="mt-5 rounded-[18px] border border-dashed border-fx-red/25 bg-white p-4">
      {p.presale.linkKey && <input type="hidden" name="key" value={p.presale.linkKey} />}
      <label htmlFor="access-code" className={labelCls}>
        Have an access or presale code?
      </label>
      <div className="mt-2 flex gap-2 max-[481px]:flex-col">
        <input id="access-code" name="code" defaultValue={p.accessCode} placeholder="Enter code" autoComplete="off" className={cx(input, "font-mono uppercase")} />
        <button type="submit" className={cx(button("outline"), "shrink-0 bg-white")}>
          Unlock
        </button>
      </div>
      {p.presale.codeRejected ? (
        <p className="mt-2 text-[13px] font-semibold text-fx-red-second">That code is not valid for this event.</p>
      ) : p.presale.unlocked.length ? (
        <p className="mt-2 text-[13px] text-fx-red/78">Code accepted: {p.presale.unlocked.join(", ")} unlocked.</p>
      ) : null}
    </form>
  );

  if (p.mode === "none" || p.mode === "presale_only") {
    return (
      <div className="pt-2 pr-14 pb-2 max-[721px]:pr-0">
        <Heading>Tickets</Heading>
        <p className="mt-2 text-[15px] text-fx-red/78">{p.mode === "none" ? "No tickets are available." : "Tickets are available with an access code."}</p>
        {presaleForm}
      </div>
    );
  }

  return (
    <>
    <form action={action} className="relative">
      <BotFields />
      <input type="hidden" name="event" value={p.eventSlug} />
      <input type="hidden" name="channel" value="web" />
      {Object.entries(p.attribution).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {p.accessCode && <input type="hidden" name="access_code" value={p.accessCode} />}

      <Heading note={!p.rsvp && p.feePayer === "buyer" ? "Prices include fees" : undefined}>{p.rsvp ? "Registration" : p.seating ? "Choose your seats" : "Tickets"}</Heading>

      {p.seating ? (
        <div className="pt-2 pb-5">
          <SeatPicker eventSlug={p.eventSlug} seating={p.seating} currency={p.currency} selected={seatSel} onChange={setSeatSel} />
        </div>
      ) : null}

      <ul>
        {rows.map(({ t, limit, buyable }) => {
          const n = qty[t.id] ?? 0;
          const free = t.allInCents === 0;
          return (
            <li key={t.id} className="flex items-start gap-4 border-b border-fx-red/10 py-5 last:border-b-0">
              <div className={cx("min-w-0 flex-1", !buyable && "text-fx-red/78")}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-[16px] font-semibold">
                    {t.name}
                    {t.kind === "table" && <span className="ml-1 text-[13px] font-normal text-fx-red/78">· table of {t.seats}</span>}
                  </h3>
                  {t.presale && <span className="rounded-full border border-fx-red/25 px-2 py-[1px] text-[11px] font-semibold uppercase">Presale</span>}
                  {t.status === "on_sale" && t.remaining <= LOW && t.remaining > 0 && <span className="text-[13px] font-semibold text-fx-red-second">Only {t.remaining} left</span>}
                </div>
                <p className={cx("mt-1 font-display text-[20px] font-semibold tracking-[-0.01em] tabular-nums", (t.status === "sold_out" || limit === 0) && "line-through decoration-2")}>
                  {free ? "Free" : formatCents(t.allInCents, p.currency)}
                </p>
                {!free && t.allInCents !== t.priceCents && (
                  <p className="text-[12px] text-fx-red/78 tabular-nums">
                    {formatCents(t.priceCents, p.currency)} + {formatCents(t.allInCents - t.priceCents, p.currency)} fees
                  </p>
                )}
                {t.dayLabel && <p className="mt-1 text-[13px] text-fx-red/78">Valid {t.dayLabel} only</p>}
                {t.description && <p className="mt-2 text-[14px] leading-[1.5] text-fx-red/78">{t.description}</p>}
              </div>

              <div className="shrink-0 pt-[2px]">
                {buyable ? (
                  <>
                    <Stepper value={n} min={t.minPerOrder} max={limit} name={t.name} label={p.rsvp ? "Register" : free ? "Get" : "Buy"} onChange={(v) => set(t, limit, v)} />
                    <input type="hidden" name={`qty_${t.id}`} value={n} />
                    {n >= limit && limit > 1 && <p className="mt-1 text-right text-[11px] text-fx-red/78">Max {limit} per order</p>}
                  </>
                ) : (
                  <span className="inline-block rounded-full border border-fx-red/20 px-3 py-[6px] text-[13px] font-semibold text-fx-red/78">
                    {t.status === "sold_out" || limit === 0 ? "Sold out" : t.status === "scheduled" ? (t.salesStart ? `On sale ${t.salesStart}` : "On sale soon") : "Sales ended"}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {count > 0 && p.addons.length > 0 && (
        <div className="mt-2 border-t border-fx-red/10 pt-5">
          <p className="text-[13px] font-semibold tracking-[.08em] text-fx-red/78 uppercase">Add-ons (optional)</p>
          <ul className="mt-2">
            {p.addons.map((a) => {
              const n = addonQty[a.id] ?? 0;
              const gone = a.available !== null && a.available <= 0;
              return (
                <li key={a.id} className={cx("flex items-start gap-4 border-b border-fx-red/10 py-4 last:border-b-0", gone && "text-fx-red/78")}>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-semibold">{a.name}</h3>
                    {a.description && <p className="mt-1 text-[14px] leading-[1.5] text-fx-red/78">{a.description}</p>}
                    <p className="mt-1 text-[15px] font-semibold tabular-nums">
                      {a.allInCents === 0 ? "Free" : formatCents(a.allInCents, p.currency)}
                      {gone ? <span className="ml-2 text-[12px] font-normal">Sold out</span> : a.available !== null && a.available <= 10 ? <span className="ml-2 text-[12px] font-semibold text-fx-red-second">Only {a.available} left</span> : null}
                    </p>
                  </div>
                  {!gone && (
                    <div className="shrink-0">
                      <Stepper value={n} min={1} max={Math.min(a.max, a.available ?? a.max)} name={a.name} label="Add" onChange={(v) => setAddon(a, v)} />
                      <input type="hidden" name={`addon_${a.id}`} value={n} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {count > 0 && (
        <div className="mt-2 grid gap-4 border-t border-fx-red/10 pt-5">
          <p className="text-[13px] font-semibold tracking-[.08em] text-fx-red/78 uppercase">Your details</p>
          <Field id="tk-name" label="Your name">
            <input id="tk-name" name="name" required autoComplete="name" defaultValue={p.defaultName} className={input} />
          </Field>
          <Field id="tk-email" label="Email for your tickets">
            <input id="tk-email" name="email" type="email" required autoComplete="email" defaultValue={p.defaultEmail} className={input} />
          </Field>
          <Field id="tk-phone" label="Phone (optional)">
            <input id="tk-phone" name="phone" type="tel" autoComplete="tel" className={input} />
          </Field>
          {p.smsEnabled && <Check id="tk-sms" name="sms" label="Text me my ticket link and a reminder" hint="Uses the phone number above. Message rates may apply." />}
          {p.questions.map((q) => {
            const id = `tk-q-${q.id}`;
            const name = `q_${q.id}`;
            const label = q.required ? (
              <>
                {q.label} <span className="text-fx-red-second">*</span>
              </>
            ) : (
              q.label
            );
            if (q.kind === "checkbox") return <Check key={q.id} id={id} name={name} label={label} />;
            if (q.kind === "select")
              return (
                <Field key={q.id} id={id} label={label}>
                  <select id={id} name={name} required={q.required} defaultValue="" className={cx(input, "cursor-pointer")}>
                    <option value="">— Choose —</option>
                    {q.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            if (q.kind === "textarea")
              return (
                <Field key={q.id} id={id} label={label}>
                  <textarea id={id} name={name} required={q.required} rows={3} maxLength={1000} className={cx(input, "min-h-24 py-3 leading-[1.5]")} />
                </Field>
              );
            return (
              <Field key={q.id} id={id} label={label}>
                <input id={id} name={name} required={q.required} maxLength={500} className={input} />
              </Field>
            );
          })}
          {p.hasPromo && (
            <Field id="tk-promo" label="Promo code (optional)" hint="The discount is applied on the next step.">
              <input id="tk-promo" name="promo_code" maxLength={40} autoComplete="off" className={cx(input, "font-mono uppercase")} />
            </Field>
          )}
          <Check id="tk-marketing" name="marketing" label="Email me about future events from this organizer" />
          {p.ageRestriction ? <p className="text-[13px] leading-[1.5] text-fx-red-second">This event is {p.ageRestriction}+. Every attendee must show a valid photo ID at the door.</p> : null}
        </div>
      )}

      <Captcha className="mt-5" />

      {/* pinned to the bottom of the pop-up: total and checkout side by side, one line of small print */}
      <div className="sticky bottom-0 -mb-8 border-t border-dashed border-fx-red/25 bg-fx-ivory pt-4 pb-5 max-[721px]:-mx-5 max-[721px]:-mb-[max(20px,env(safe-area-inset-bottom))] max-[721px]:px-5 max-[721px]:pb-[max(16px,env(safe-area-inset-bottom))]">
        {state?.error && (
          <p ref={errorRef} role="alert" className="mb-3 rounded-[12px] bg-fx-red-second/10 px-3 py-2 text-[14px] font-semibold leading-[1.45] text-fx-red-second">
            {state.error}
          </p>
        )}
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1 leading-tight">
            <span className="block font-display text-[26px] font-semibold tracking-[-0.02em] tabular-nums" aria-live="polite">
              {allFree && !addonTotal ? "Free" : formatCents(total, p.currency)}
            </span>
            <span className="block text-[13px] text-fx-red/78 tabular-nums">
              {count ? `${count} ${seatSel.length === count ? (count === 1 ? "seat" : "seats") : count === 1 ? "ticket" : "tickets"}${addonCount ? ` + ${addonCount} add-on${addonCount === 1 ? "" : "s"}` : ""}` : p.rsvp ? "Choose how many are coming" : p.seating ? "Pick seats on the map" : "Choose your tickets"}
              {fees > 0 && ` · includes ${formatCents(fees, p.currency)} in fees`}
            </span>
          </div>
          <CheckoutButton disabled={!count} label={!anyBuyable ? (upcoming ? "Not on sale yet" : "Sold out") : p.rsvp || total === 0 ? (p.rsvp ? "Register" : "Get free tickets") : "Checkout"} />
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-[6px] text-[12px] leading-[1.5] text-fx-red/78">
          {p.rsvp ? (
            "Free to attend. Your ticket is emailed to you."
          ) : (
            <>
              {total > 0 && (
                <span className="inline-flex items-center gap-[6px]">
                  <LockIcon /> Secure checkout with Stripe ·
                </span>
              )}
              <span>{p.refundText}</span>
              {count > 0 && <span>· Your tickets are held for 10 minutes while you check out.</span>}
            </>
          )}
        </p>
      </div>
    </form>
    {/* their own forms, beside the checkout form: a form inside a form is invalid HTML (the browser drops the inner one) */}
    {presaleForm}
    {p.waitlist.show && (
      <div className="fx-form mt-5 rounded-[18px] bg-white p-1">
        <WaitlistForm eventSlug={p.eventSlug} soldOutTypes={p.waitlist.soldOutTypes} allSoldOut={p.waitlist.allSoldOut} defaultEmail={p.defaultEmail} defaultName={p.defaultName} />
      </div>
    )}
    </>
  );
}
