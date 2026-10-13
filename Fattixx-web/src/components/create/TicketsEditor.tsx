"use client";

import { useState } from "react";
import { cx } from "@/components/ui/styles";
import { newTicket, REFUND_OPTIONS } from "@/lib/home/create";
import type { EventDraft, TicketDraft, VenueOption } from "@/lib/home/create";
import { useFees } from "@/lib/home/fees-context";
import { feeBreakdown, feeLabel, formatCents, parseDollars, processingLabel } from "@/lib/home/pricing";
import { input, labelCls, Segmented, Switch } from "./ui";

type Patch = (p: Partial<EventDraft>) => void;

/** `venue`: the saved venue chosen under Location, if any (its tax rate is the default). */
export default function TicketsEditor({ d, patch, venue }: { d: EventDraft; patch: Patch; venue: VenueOption | null }) {
  const fees = useFees();
  const [openId, setOpenId] = useState<string | null>(null);

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
  const anyPaid = d.tickets.some((t) => parseDollars(t.price) > 0);

  return (
    <div className="grid gap-4">
      {d.tickets.map((t, i) => {
        const cents = parseDollars(t.price);
        const b = feeBreakdown(cents, d.feePayer, fees);
        const more = openId === t.id;
        return (
          <div key={t.id} className="rounded-[20px] border border-fx-red/14 bg-white p-4 min-[641px]:p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-3 max-[641px]:grid-cols-1">
              <div>
                <label htmlFor={t.id + "-n"} className={labelCls}>
                  Ticket name
                </label>
                <input id={t.id + "-n"} className={cx(input, "mt-2")} value={t.name} placeholder="e.g. General Admission" onChange={(e) => setTicket(t.id, { name: e.target.value })} />
              </div>
              <div>
                <label htmlFor={t.id + "-p"} className={labelCls}>
                  Price
                </label>
                <div className="relative mt-2">
                  <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[15px] font-semibold text-fx-red/78">
                    $
                  </span>
                  <input id={t.id + "-p"} className={cx(input, "pl-8")} inputMode="decimal" placeholder="0.00" value={t.price} onChange={(e) => setTicket(t.id, { price: e.target.value.replace(/[^\d.]/g, "") })} />
                </div>
              </div>
            </div>
            <p className="mt-3 mb-0 text-[14px] text-fx-red/78" aria-live="polite">
              {cents > 0 ? (
                <>
                  Buyers pay <b className="text-fx-red">{formatCents(b.buyerPaysCents)}</b>, you receive <b className="text-fx-red">{formatCents(b.organizerGetsCents)}</b>.
                </>
              ) : (
                "Free ticket. No fee."
              )}
            </p>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button type="button" aria-expanded={more} onClick={() => setOpenId(more ? null : t.id)} className="min-h-11 cursor-pointer text-[14px] font-semibold text-fx-red-second underline underline-offset-4">
                {more ? "Fewer options" : "More options"}
              </button>
              {d.tickets.length > 1 && (
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

      <button
        type="button"
        onClick={() => {
          const t = newTicket(d.tickets.length ? "" : "General Admission");
          patch({ tickets: [...d.tickets, t] });
          setOpenId(null);
        }}
        className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-fx-red/25 text-[15px] font-semibold text-fx-red hover:border-fx-red/50"
      >
        <span aria-hidden="true" className="text-[20px] leading-none">+</span> Add ticket type
      </button>

      <div className="mt-2 grid gap-2 rounded-[20px] bg-fx-sand/70 p-4 min-[641px]:p-5">
        <span className="text-[13px] font-semibold tracking-[.12em] text-fx-red/78 uppercase">Fees &amp; tax</span>
        <span className="text-[15px] font-semibold">Who covers the Fattixx fee?</span>
        <span className="text-[13px] leading-[1.45] text-fx-red/78">
          {feeLabel(fees)} per paid ticket{processingLabel(fees) ? `, plus card processing of ${processingLabel(fees)}` : ", card processing included"}. Free tickets have no fee.
        </span>
        <div className="mt-1">
          <Segmented
            label="Who covers the fee"
            value={d.feePayer}
            onChange={(v) => patch({ feePayer: v })}
            options={[
              { v: "buyer", label: "Buyers pay it" },
              { v: "organizer", label: "I’ll cover it" },
            ]}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-fx-red/10 pt-4 max-[641px]:grid-cols-1">
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
          <select id="refund" className={cx(input, "mt-2 cursor-pointer")} value={d.refund} onChange={(e) => patch({ refund: e.target.value as EventDraft["refund"] })}>
            {REFUND_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.v === "days_before" ? o.label.replace("N", d.refundDays || "N") : o.label}
              </option>
            ))}
          </select>
          {d.refund === "days_before" && (
            <div className="mt-3 flex items-center gap-3">
              <label htmlFor="refund-days" className={cx(labelCls, "shrink-0")}>
                Days before the event
              </label>
              <input id="refund-days" className={cx(input, "max-w-24")} inputMode="numeric" value={d.refundDays} onChange={(e) => patch({ refundDays: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
            </div>
          )}
          {anyPaid && <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Shown on the event page and at checkout.</p>}
        </div>
      </div>
      <Switch checked={d.waitlist} onChange={(v) => patch({ waitlist: v })} label="Waitlist when sold out" hint="Buyers can join a waitlist once tickets sell out." />
    </div>
  );
}
