"use client";

import { useState } from "react";
import { cx } from "@/components/ui/styles";
import { fromRefundChoice, legacyRefundLabel, newTicket, REFUND_OPTIONS, refundChoice } from "@/lib/home/create";
import type { EventDraft, SeatMapOption, TicketDraft, VenueOption } from "@/lib/home/create";
import { useFees } from "@/lib/home/fees-context";
import { cleanerPrices, feeBreakdown, feeCapLabel, formatCents, parseDollars, priceForBuyerTotal, priceForEarn } from "@/lib/home/pricing";
import SeatMapField from "./SeatMapField";
import { input, labelCls, Switch } from "./ui";

type Patch = (p: Partial<EventDraft>) => void;
type PriceField = "earn" | "total";

const toDollars = (cents: number) => (cents / 100).toFixed(2);

function MoneyInput({ id, value, onChange, onBlur, highlight }: { id: string; value: string; onChange: (text: string) => void; onBlur: () => void; highlight?: boolean }) {
  return (
    <div className="relative mt-2">
      <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[15px] font-semibold text-fx-red/78">
        $
      </span>
      <input id={id} className={cx(input, "pl-8 font-semibold", highlight && "border-fx-yellow! bg-fx-yellow/15!")} inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </div>
  );
}

/** A ticket type the dashboard manages (VIP, tables, comps, presale, day tickets): listed, not edited here. */
export type LockedTicket = { id: number; name: string; detail: string };

/**
 * `venue`: the saved venue chosen under Location, if any (its tax rate is the default).
 * `locked` / `manageHref`: when editing a saved event, the ticket types edited on its dashboard tab instead.
 * `seatMaps` / `onPickMap` / `seatMapName` / `seatingHref` / `mapsHref`: a seated event has a map instead of ticket cards.
 */
export default function TicketsEditor({ d, patch, venue, locked = [], manageHref, seatMaps = [], onPickMap, seatMapName, seatingHref, mapsHref }: {
  d: EventDraft;
  patch: Patch;
  venue: VenueOption | null;
  locked?: LockedTicket[];
  manageHref?: string;
  seatMaps?: SeatMapOption[];
  onPickMap?: (id: string) => void;
  seatMapName?: string | null;
  seatingHref?: string;
  mapsHref?: string;
}) {
  const fees = useFees();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: PriceField; text: string } | null>(null);
  const refundValue = refundChoice(d);
  const cap = feeCapLabel(fees);

  if (d.mode === "rsvp") {
    return (
      <div className="grid gap-4">
        <p className="m-0 text-[15px] leading-[1.55] text-fx-red/78">Guests RSVP for free with their name and email. There’s no fee on RSVP events.</p>
        <div className="max-w-[260px]">
          <label htmlFor="rsvp-cap" className={labelCls}>
            Capacity <span className="font-normal text-fx-red/78">(optional)</span>
          </label>
          <input id="rsvp-cap" className={cx(input, "mt-2")} inputMode="numeric" placeholder="Unlimited" value={d.capacity} onChange={(e) => patch({ capacity: e.target.value.replace(/\D/g, "") })} />
        </div>
        <Switch checked={d.waitlist} onChange={(v) => patch({ waitlist: v })} label="Waitlist when full" hint="Guests can join a waitlist once the event is full." />
      </div>
    );
  }

  const setTicket = (id: string, p: Partial<TicketDraft>) => patch({ tickets: d.tickets.map((t) => (t.id === id ? { ...t, ...p } : t)) });

  /* The ticket stores its price; "earn" and "total" are both worked out from it, and typing in either sets it. */
  const shown = (t: TicketDraft, field: PriceField, cents: number) => {
    if (editing?.id === t.id && editing.field === field) return editing.text;
    if (cents > 0) return toDollars(cents);
    return t.price.trim() === "" ? "" : "0";
  };
  const editPrice = (t: TicketDraft, field: PriceField, raw: string) => {
    const text = raw.replace(/[^\d.]/g, "");
    setEditing({ id: t.id, field, text });
    const c = parseDollars(text);
    const price = c > 0 ? (field === "earn" ? priceForEarn(c, d.feePayer, fees) : priceForBuyerTotal(c, d.feePayer, fees)) : 0;
    setTicket(t.id, { price: price > 0 ? toDollars(price) : text === "" ? "" : "0" });
  };
  const seated = d.mode === "seated";
  const anyPaid = seated || d.tickets.some((t) => parseDollars(t.price) > 0);

  return (
    <div className="grid gap-4">
      {seated && <SeatMapField value={d.seatMapId} maps={seatMaps} onChange={(id) => onPickMap?.(id)} savedName={seatMapName} seatingHref={seatingHref} mapsHref={mapsHref} />}
      {!seated && d.tickets.map((t, i) => {
        const cents = parseDollars(t.price);
        const b = feeBreakdown(cents, d.feePayer, fees);
        const more = openId === t.id;
        return (
          <div key={t.id} className="rounded-[20px] border border-fx-red/14 bg-white p-4 min-[641px]:p-5">
            <label htmlFor={t.id + "-n"} className={labelCls}>
              Ticket name
            </label>
            <input id={t.id + "-n"} className={cx(input, "mt-2")} value={t.name} placeholder="e.g. General Admission" onChange={(e) => setTicket(t.id, { name: e.target.value })} />

            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3 max-[641px]:grid-cols-1">
              <div>
                <label htmlFor={t.id + "-p"} className={labelCls}>
                  Ticket price
                </label>
                <MoneyInput id={t.id + "-p"} value={shown(t, "total", b.buyerPaysCents)} onChange={(text) => editPrice(t, "total", text)} onBlur={() => setEditing(null)} />
              </div>
              <span aria-hidden="true" className="flex min-h-12 items-center justify-center text-[22px] text-fx-red max-[641px]:hidden">
                ⇆
              </span>
              <div>
                <label htmlFor={t.id + "-e"} className={labelCls}>
                  You earn per ticket
                </label>
                <MoneyInput id={t.id + "-e"} highlight value={shown(t, "earn", b.organizerGetsCents)} onChange={(text) => editPrice(t, "earn", text)} onBlur={() => setEditing(null)} />
              </div>
            </div>
            <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Type in either box and the other updates.</p>

            {cents > 0 ? (
              <div className="mt-4 rounded-[16px] bg-fx-sand/60 px-4 py-3" aria-live="polite">
                <div className="flex items-center justify-between gap-3 border-b border-dashed border-fx-red/20 pb-2 text-[14px]">
                  <span className="text-fx-red/85">Buyers pay</span>
                  <b className="text-fx-ink">{formatCents(b.buyerPaysCents)}</b>
                </div>
                <div className="flex items-center justify-between gap-3 pt-2">
                  <span className="text-[15px] font-semibold text-fx-red">You receive per ticket</span>
                  <b className="text-[22px] text-fx-red">{formatCents(b.organizerGetsCents)}</b>
                </div>
                {b.capped && <p className="mt-1 mb-0 text-[13px] text-fx-red/78">The fee is capped at {cap} per ticket.</p>}
              </div>
            ) : (
              <p className="mt-3 mb-0 text-[14px] text-fx-red/78" aria-live="polite">Free ticket. No fee.</p>
            )}
            {t.sold ? <p className="mt-2 mb-0 text-[14px] font-semibold text-fx-red">{t.sold} sold so far.</p> : null}

            {(() => {
              const chips = cleanerPrices(b.buyerPaysCents, d.feePayer, fees);
              if (!chips.length) return null;
              return (
                <div className="mt-4">
                  <p className={cx(labelCls, "m-0")}>Want a cleaner price?</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {chips.map((c) => (
                      <button
                        key={c.buyerPaysCents}
                        type="button"
                        onClick={() => {
                          setEditing(null);
                          setTicket(t.id, { price: toDollars(c.priceCents) });
                        }}
                        className="min-h-11 cursor-pointer rounded-full border border-fx-red/20 bg-white px-4 text-[14px] text-fx-red hover:border-fx-red/50"
                      >
                        <b>{formatCents(c.buyerPaysCents)}</b> <span className="ml-1 text-fx-red/85">you earn {formatCents(c.earnCents)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button type="button" aria-expanded={more} onClick={() => setOpenId(more ? null : t.id)} className="min-h-11 cursor-pointer text-[14px] font-semibold text-fx-red-second underline underline-offset-4">
                {more ? "Fewer options" : "More options"}
              </button>
              {(d.tickets.length > 1 || locked.length > 0) && !t.sold && (
                <button type="button" onClick={() => patch({ tickets: d.tickets.filter((x) => x.id !== t.id) })} className="min-h-11 cursor-pointer text-[14px] font-semibold text-fx-red/78 hover:text-fx-red">
                  Remove ticket {i + 1}
                </button>
              )}
            </div>

            {more && (
              <div className="mt-2 grid grid-cols-2 gap-3 border-t border-fx-red/10 pt-4 max-[641px]:grid-cols-1">
                <div>
                  <label htmlFor={t.id + "-q"} className={labelCls}>
                    Quantity available
                  </label>
                  <input id={t.id + "-q"} className={cx(input, "mt-2")} inputMode="numeric" placeholder="Unlimited" value={t.quantity} onChange={(e) => setTicket(t.id, { quantity: e.target.value.replace(/\D/g, "") })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={t.id + "-min"} className={labelCls}>
                      Min per order
                    </label>
                    <input id={t.id + "-min"} className={cx(input, "mt-2")} inputMode="numeric" value={t.minPerOrder} onChange={(e) => setTicket(t.id, { minPerOrder: e.target.value.replace(/\D/g, "") })} />
                  </div>
                  <div>
                    <label htmlFor={t.id + "-max"} className={labelCls}>
                      Max per order
                    </label>
                    <input id={t.id + "-max"} className={cx(input, "mt-2")} inputMode="numeric" value={t.maxPerOrder} onChange={(e) => setTicket(t.id, { maxPerOrder: e.target.value.replace(/\D/g, "") })} />
                  </div>
                </div>
                <div>
                  <label htmlFor={t.id + "-ss"} className={labelCls}>
                    Sales start <span className="font-normal text-fx-red/78">(blank = now)</span>
                  </label>
                  <input id={t.id + "-ss"} type="datetime-local" className={cx(input, "mt-2")} value={t.salesStart} onChange={(e) => setTicket(t.id, { salesStart: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={t.id + "-se"} className={labelCls}>
                    Sales end <span className="font-normal text-fx-red/78">(blank = event start)</span>
                  </label>
                  <input id={t.id + "-se"} type="datetime-local" className={cx(input, "mt-2")} value={t.salesEnd} onChange={(e) => setTicket(t.id, { salesEnd: e.target.value })} />
                </div>
                <div className="col-span-full">
                  <label htmlFor={t.id + "-d"} className={labelCls}>
                    Description <span className="font-normal text-fx-red/78">(optional)</span>
                  </label>
                  <input id={t.id + "-d"} className={cx(input, "mt-2")} placeholder="e.g. Includes one drink" value={t.description} onChange={(e) => setTicket(t.id, { description: e.target.value })} />
                </div>
                <div className="col-span-full">
                  <Switch checked={t.hidden} onChange={(v) => setTicket(t.id, { hidden: v })} label="Hidden ticket" hint="Only people with a direct link can buy it." />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {locked.length > 0 && (
        <div className="rounded-[20px] border border-dashed border-fx-red/20 p-4 min-[641px]:p-5">
          <p className="m-0 text-[14px] font-semibold">Also on sale</p>
          <ul className="mt-2 grid gap-1 text-[14px] text-fx-red/78">
            {locked.map((t) => (
              <li key={t.id}>
                <b className="font-semibold text-fx-red">{t.name}</b> · {t.detail}
              </li>
            ))}
          </ul>
          {manageHref && (
            <a href={manageHref} className="mt-2 inline-block min-h-11 text-[14px] font-semibold text-fx-red-second underline underline-offset-4">
              Edit these on the Ticket types tab
            </a>
          )}
        </div>
      )}

      {!seated && <button
        type="button"
        onClick={() => {
          const t = newTicket(d.tickets.length || locked.length ? "" : "General Admission");
          patch({ tickets: [...d.tickets, t] });
          setOpenId(null);
        }}
        className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-fx-red/25 text-[15px] font-semibold text-fx-red hover:border-fx-red/50"
      >
        <span aria-hidden="true" className="text-[20px] leading-none">+</span> Add ticket type
      </button>}

      <div className="mt-2 grid gap-2 rounded-[20px] bg-fx-sand/70 p-4 min-[641px]:p-5">
        <span className="text-[13px] font-semibold tracking-[.12em] text-fx-red/78 uppercase">Tax</span>
        <div className="grid grid-cols-2 gap-3 max-[641px]:grid-cols-1">
          <div>
            <label htmlFor="tax-pct" className={labelCls}>
              Sales tax <span className="font-normal text-fx-red/78">(%)</span>
            </label>
            <input id="tax-pct" className={cx(input, "mt-2")} inputMode="decimal" placeholder={venue ? `Venue rate ${(venue.taxBps / 100).toFixed(2)}%` : "0.00"} value={d.taxPct} onChange={(e) => patch({ taxPct: e.target.value.replace(/[^\d.]/g, "").slice(0, 6) })} />
            <p className="mt-2 mb-0 text-[13px] text-fx-red/78">{venue ? "Leave blank to use the venue’s rate." : "Added at checkout. Leave blank for no tax."}</p>
          </div>
          <div>
            <label htmlFor="tax-label" className={labelCls}>
              Tax label <span className="font-normal text-fx-red/78">(optional)</span>
            </label>
            <input id="tax-label" className={cx(input, "mt-2")} maxLength={80} placeholder={venue?.taxLabel || "e.g. SC Admissions Tax"} value={d.taxLabel} onChange={(e) => patch({ taxLabel: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 max-[641px]:grid-cols-1">
        <div>
          <label htmlFor="cap" className={labelCls}>
            Event capacity <span className="font-normal text-fx-red/78">(optional)</span>
          </label>
          <input id="cap" className={cx(input, "mt-2")} inputMode="numeric" placeholder="Unlimited" value={d.capacity} onChange={(e) => patch({ capacity: e.target.value.replace(/\D/g, "") })} />
        </div>
        <div>
          <label htmlFor="refund" className={labelCls}>
            Refund policy
          </label>
          <select id="refund" className={cx(input, "mt-2 cursor-pointer")} value={refundValue} onChange={(e) => patch(fromRefundChoice(e.target.value))}>
            {REFUND_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
            {/* an event made before keeps its own choice */}
            {!REFUND_OPTIONS.some((o) => o.v === refundValue) && <option value={refundValue}>{legacyRefundLabel(refundValue)}</option>}
          </select>
          <p className="mt-2 mb-0 text-[13px] text-fx-red/78">
            {d.refund === "contact"
              ? "Buyers see your contact email and ask you; you refund from the dashboard."
              : d.refund === "none"
                ? "Buyers are refunded only if you cancel the event."
                : "Buyers can refund themselves from their order page until then."}
            {anyPaid ? " Shown on the event page and at checkout." : ""}
          </p>
        </div>
      </div>
      <Switch checked={d.waitlist} onChange={(v) => patch({ waitlist: v })} label="Waitlist when sold out" hint="Buyers can join a waitlist once tickets sell out." />
    </div>
  );
}
