"use client";

/*
 * "Add venue" on the New event page: the venue form (the same fields as Dashboard → Venues) in a popup. The venue is
 * saved at once and handed back so the form can select it.
 */

import { useActionState, useEffect, useRef, useState } from "react";
import { createVenueInline, type InlineVenue, type InlineVenueState } from "@/lib/events/actions";
import { COMMON_TIMEZONES } from "@/lib/tz";
import { button, cx } from "@/components/ui/styles";
import { input, labelCls } from "@/components/create/ui";

export function VenueDialog({ open, onClose, onCreated, orgSlug, defaultTimezone }: {
  open: boolean;
  onClose: () => void;
  onCreated: (venue: InlineVenue) => void;
  orgSlug: string;
  /** the event's current time zone, preselected for the venue */
  defaultTimezone: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [formKey, setFormKey] = useState(0);
  // saved: hand the venue back and clear the form for the next one (React runs the action from the latest render)
  const [state, action, pending] = useActionState(async (prev: InlineVenueState, fd: FormData) => {
    const res = await createVenueInline(prev, fd);
    if (res && "ok" in res && res.ok) {
      onCreated(res.venue);
      setFormKey((k) => k + 1);
    }
    return res;
  }, undefined);
  const tzOptions = [...new Set([defaultTimezone, ...COMMON_TIMEZONES])];

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const error = state && "error" in state ? state.error : "";

  return (
    <dialog
      ref={ref}
      aria-labelledby="vd-title"
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()} // a click on the blurred backdrop lands on the dialog itself
      className="m-auto w-[min(640px,calc(100vw-32px))] rounded-[28px] border-0 bg-fx-white p-0 text-fx-red shadow-[0_40px_80px_-30px_rgba(78,7,11,.6)] backdrop:bg-fx-red-deep/45 backdrop:backdrop-blur-[3px]"
    >
      <div className="relative max-h-[calc(100dvh-32px)] overflow-y-auto p-7 max-[641px]:p-5">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute top-4 right-4 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-fx-red/78 hover:bg-fx-sand">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="text-[12px] font-semibold tracking-[.14em] text-fx-red/78 uppercase">Venues</div>
        <h2 id="vd-title" className="mt-2 pr-10 font-display text-[26px] leading-[1.1] font-semibold tracking-[-0.03em]">
          Add a venue
        </h2>
        <p className="mt-2 text-[14px] leading-[1.5] text-fx-red/78">Saved under Venues for your next events too. Tax applies to tickets sold for events at this venue unless the event overrides it; South Carolina admissions tax is 5%.</p>

        <form key={formKey} action={action} className="mt-5 grid grid-cols-2 gap-4 max-[641px]:grid-cols-1">
          <input type="hidden" name="org" value={orgSlug} />
          <div className="col-span-full">
            <label htmlFor="vd-name" className={labelCls}>
              Venue name
            </label>
            <input id="vd-name" name="name" required minLength={2} maxLength={160} className={cx(input, "mt-2")} placeholder="e.g. The Warehouse" autoComplete="organization" />
          </div>
          <div>
            <label htmlFor="vd-a1" className={labelCls}>
              Address
            </label>
            <input id="vd-a1" name="address_line1" maxLength={200} className={cx(input, "mt-2")} placeholder="200 W Washington St" autoComplete="address-line1" />
          </div>
          <div>
            <label htmlFor="vd-a2" className={labelCls}>
              Address line 2 <span className="font-normal text-fx-red/78">(optional)</span>
            </label>
            <input id="vd-a2" name="address_line2" maxLength={200} className={cx(input, "mt-2")} autoComplete="address-line2" />
          </div>
          <div>
            <label htmlFor="vd-city" className={labelCls}>
              City
            </label>
            <input id="vd-city" name="city" maxLength={120} className={cx(input, "mt-2")} placeholder="Greenville" autoComplete="address-level2" />
          </div>
          <div>
            <label htmlFor="vd-region" className={labelCls}>
              State / region
            </label>
            <input id="vd-region" name="region" maxLength={120} className={cx(input, "mt-2")} placeholder="SC" autoComplete="address-level1" />
          </div>
          <div>
            <label htmlFor="vd-zip" className={labelCls}>
              Postal code
            </label>
            <input id="vd-zip" name="postal_code" maxLength={20} className={cx(input, "mt-2")} autoComplete="postal-code" />
          </div>
          <div>
            <label htmlFor="vd-country" className={labelCls}>
              Country <span className="font-normal text-fx-red/78">(2-letter)</span>
            </label>
            <input id="vd-country" name="country" maxLength={2} defaultValue="US" className={cx(input, "mt-2 uppercase")} autoComplete="country" />
          </div>
          <div>
            <label htmlFor="vd-tz" className={labelCls}>
              Time zone
            </label>
            <select id="vd-tz" name="timezone" defaultValue={defaultTimezone} className={cx(input, "mt-2 cursor-pointer")}>
              {tzOptions.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="vd-cap" className={labelCls}>
              Capacity <span className="font-normal text-fx-red/78">(optional)</span>
            </label>
            <input id="vd-cap" name="capacity" type="number" min={0} inputMode="numeric" className={cx(input, "mt-2")} placeholder="Unlimited" />
          </div>
          <div>
            <label htmlFor="vd-tax" className={labelCls}>
              Admissions / sales tax <span className="font-normal text-fx-red/78">(%)</span>
            </label>
            <input id="vd-tax" name="tax_pct" type="number" step="0.01" min={0} max={30} inputMode="decimal" defaultValue="0.00" className={cx(input, "mt-2")} />
          </div>
          <div>
            <label htmlFor="vd-taxl" className={labelCls}>
              Tax label on receipts <span className="font-normal text-fx-red/78">(optional)</span>
            </label>
            <input id="vd-taxl" name="tax_label" maxLength={80} className={cx(input, "mt-2")} placeholder="e.g. SC Admissions Tax" />
          </div>
          <div>
            <label htmlFor="vd-lat" className={labelCls}>
              Latitude <span className="font-normal text-fx-red/78">(optional)</span>
            </label>
            <input id="vd-lat" name="latitude" inputMode="decimal" className={cx(input, "mt-2")} placeholder="34.8526" />
          </div>
          <div>
            <label htmlFor="vd-lon" className={labelCls}>
              Longitude <span className="font-normal text-fx-red/78">(optional)</span>
            </label>
            <input id="vd-lon" name="longitude" inputMode="decimal" className={cx(input, "mt-2")} placeholder="-82.3940" />
            <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Lets the homepage show this venue to people nearby.</p>
          </div>

          {error && (
            <p role="alert" className="col-span-full m-0 rounded-xl bg-fx-red/[.06] px-3 py-2 text-[14px] font-semibold text-fx-red-second">
              {error}
            </p>
          )}

          <div className="col-span-full mt-1 flex justify-end gap-2 max-[641px]:flex-col">
            <button type="button" onClick={onClose} disabled={pending} className={cx(button("outline"), "bg-white disabled:opacity-60")}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={cx(button("primary"), "disabled:opacity-60")}>
              {pending ? "Saving…" : "Add venue"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
