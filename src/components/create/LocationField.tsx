"use client";

/* Where the event happens: a venue saved under the organization (Dashboard → Venues), a new venue (name, address, city and state) or an online link. */

import { useId } from "react";
import type { LocationDraft, VenueOption } from "@/lib/home/create";
import { cx } from "@/components/ui/styles";
import { FieldError, input, labelCls, Segmented } from "./ui";

/** "Greenville, SC" */
function place(v: VenueOption): string {
  return [v.city, v.region].filter(Boolean).join(", ");
}

export default function LocationField({ value, venues, onChange, onPickVenue, error }: {
  value: LocationDraft;
  venues: VenueOption[];
  onChange: (v: LocationDraft) => void;
  /** a saved venue was chosen: the form takes its time zone */
  onPickVenue?: (v: VenueOption) => void;
  error?: string;
}) {
  const id = useId();
  const venue = value.kind === "venue" ? value : null;
  const saved = value.kind === "saved" ? (venues.find((v) => String(v.id) === value.venueId) ?? null) : null;
  const kinds: { v: LocationDraft["kind"]; label: string }[] = [
    ...(venues.length ? [{ v: "saved" as const, label: "Saved venue" }] : []),
    { v: "venue", label: venues.length ? "New venue" : "In person" },
    { v: "online", label: "Online" },
  ];

  return (
    <div>
      <Segmented
        label="Where is it?"
        value={value.kind}
        options={kinds}
        onChange={(k) =>
          onChange(k === "saved" ? { kind: "saved", venueId: "", venueName: "" } : k === "venue" ? { kind: "venue", venueName: "", address: "", city: "", region: "" } : { kind: "online", link: "" })
        }
      />

      {value.kind === "saved" && (
        <div className="mt-4">
          <label htmlFor={id + "-saved"} className={labelCls}>
            Venue
          </label>
          <select
            id={id + "-saved"}
            className={cx(input, "mt-2 cursor-pointer")}
            aria-invalid={!!error}
            value={value.venueId}
            onChange={(e) => {
              const v = venues.find((x) => String(x.id) === e.target.value);
              onChange({ kind: "saved", venueId: e.target.value, venueName: v?.name ?? "" });
              if (v) onPickVenue?.(v);
            }}
          >
            <option value="">Choose a venue</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {place(v) ? ` — ${place(v)}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-2 text-[13px] text-fx-red/78">
            {saved
              ? `Time zone ${saved.timezone.replace(/_/g, " ")}. Venue tax ${(saved.taxBps / 100).toFixed(2)}%${saved.taxLabel ? ` (${saved.taxLabel})` : ""}.`
              : "Venues are managed under Venues in your dashboard."}
          </p>
          <FieldError>{error}</FieldError>
        </div>
      )}

      {venue && (
        <div className="mt-4 grid gap-4">
          <div>
            <label htmlFor={id + "-vname"} className={labelCls}>
              Venue name
            </label>
            <input id={id + "-vname"} className={cx(input, "mt-2")} placeholder="e.g. The Warehouse" autoComplete="organization" aria-invalid={!!error} value={venue.venueName} onChange={(e) => onChange({ ...venue, venueName: e.target.value })} />
          </div>
          <div>
            <label htmlFor={id + "-addr"} className={labelCls}>
              Street address
            </label>
            <input id={id + "-addr"} className={cx(input, "mt-2")} placeholder="200 W Washington St" autoComplete="street-address" value={venue.address} onChange={(e) => onChange({ ...venue, address: e.target.value })} />
          </div>
          <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3 max-[641px]:grid-cols-1">
            <div>
              <label htmlFor={id + "-city"} className={labelCls}>
                City
              </label>
              <input id={id + "-city"} className={cx(input, "mt-2")} placeholder="Greenville" autoComplete="address-level2" aria-invalid={!!error && !venue.city} value={venue.city} onChange={(e) => onChange({ ...venue, city: e.target.value })} />
            </div>
            <div>
              <label htmlFor={id + "-region"} className={labelCls}>
                State
              </label>
              <input id={id + "-region"} className={cx(input, "mt-2")} placeholder="SC" autoComplete="address-level1" maxLength={40} value={venue.region} onChange={(e) => onChange({ ...venue, region: e.target.value })} />
            </div>
          </div>
          {venues.length > 0 && <p className="m-0 text-[13px] text-fx-red/78">The venue is saved under Venues in your dashboard for next time.</p>}
          <FieldError>{error}</FieldError>
        </div>
      )}

      {value.kind === "online" && (
        <div className="mt-4">
          <label htmlFor={id + "-link"} className={labelCls}>
            Event link
          </label>
          <input id={id + "-link"} className={cx(input, "mt-2")} type="url" inputMode="url" placeholder="https://" aria-invalid={!!error} value={value.link} onChange={(e) => onChange({ kind: "online", link: e.target.value })} />
          <p className="mt-2 text-[13px] text-fx-red/78">Put the link in the description too: it is shown to everyone with a ticket.</p>
          <FieldError>{error}</FieldError>
        </div>
      )}
    </div>
  );
}
