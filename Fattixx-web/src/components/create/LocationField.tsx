"use client";

/*
 * Where the event happens: a venue saved under the organization (Dashboard → Venues), a new venue or an online link.
 * A new venue is found by typing its name or address (suggestions from /api/places, plan 5.6): picking one fills in
 * the address, pins it on the map ("Events near you" uses the position) and sets the event's time zone. The address
 * can still be typed by hand; the server then looks the position up when the event is saved.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { emptyVenue, type LocationDraft, type VenueOption } from "@/lib/home/create";
import { cx } from "@/components/ui/styles";
import { FieldError, input, labelCls, Segmented } from "./ui";

type Venue = Extract<LocationDraft, { kind: "venue" }>;
type Place = { name: string; address: string; city: string; region: string; postalCode: string; country: string; lat: number; lon: number };
type Suggestion = { id: string; primary: string; secondary: string; place?: Place };

/** "Greenville, SC" */
function place(v: VenueOption): string {
  return [v.city, v.region].filter(Boolean).join(", ");
}

function newSession(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
}

export default function LocationField({ value, venues, onChange, onPickVenue, onTimeZone, error }: {
  value: LocationDraft;
  venues: VenueOption[];
  onChange: (v: LocationDraft) => void;
  /** a saved venue was chosen: the form takes its time zone */
  onPickVenue?: (v: VenueOption) => void;
  /** a new venue was picked from the suggestions: its time zone (IANA), when known */
  onTimeZone?: (tz: string) => void;
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

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState("");
  const session = useRef(newSession());
  const typed = useRef(false);

  // suggestions as the organizer types (debounced; stale answers are dropped)
  useEffect(() => {
    if (!typed.current) return;
    const q = query.trim();
    if (q.length < 3) return; // the list was cleared as the text got short (onChange)
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(q)}&session=${session.current}`, { signal: ctrl.signal });
        const json = (await res.json()) as { suggestions?: Suggestion[]; error?: string };
        setItems(json.suggestions ?? []);
        setActive(-1);
        setOpen(true);
        setNote(json.error ?? "");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setNote("Address search is unavailable right now. Type the address below.");
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  async function pick(s: Suggestion) {
    if (!venue) return;
    setOpen(false);
    setItems([]);
    setQuery("");
    typed.current = false;
    setNote("Finding it on the map…");
    try {
      const qs = s.place
        ? `lat=${s.place.lat}&lon=${s.place.lon}&country=${encodeURIComponent(s.place.country)}&region=${encodeURIComponent(s.place.region)}`
        : `id=${encodeURIComponent(s.id)}&session=${session.current}`;
      const res = await fetch(`/api/places/details?${qs}`);
      const json = (await res.json()) as { place?: Place | null; timezone?: string | null; error?: string };
      const p = s.place ?? json.place;
      if (!p) {
        setNote(json.error ?? "We couldn’t find that place. Type the address below.");
        return;
      }
      onChange({ ...venue, venueName: p.name || venue.venueName, address: p.address, city: p.city, region: p.region, postalCode: p.postalCode, country: p.country || "US", lat: p.lat, lon: p.lon });
      if (json.timezone) onTimeZone?.(json.timezone);
      setNote(json.timezone ? `Pinned on the map. Time zone set to ${json.timezone.replace(/_/g, " ")}.` : "Pinned on the map.");
    } catch {
      setNote("We couldn’t look that place up. Check the address below.");
    } finally {
      session.current = newSession(); // one Google billing session per search-and-pick
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      void pick(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // typing the address by hand moves the pin off: the server looks the new address up on save
  const edit = (p: Partial<Venue>, movesPin = false) => venue && onChange({ ...venue, ...p, ...(movesPin ? { lat: null, lon: null } : {}) });
  const pinned = venue && venue.lat != null && venue.lon != null;
  const mapHref = pinned ? `https://www.openstreetmap.org/?mlat=${venue.lat}&mlon=${venue.lon}#map=17/${venue.lat}/${venue.lon}` : "";
  const listId = id + "-list";

  return (
    <div>
      <Segmented
        label="Where is it?"
        value={value.kind}
        options={kinds}
        onChange={(k) => onChange(k === "saved" ? { kind: "saved", venueId: "", venueName: "" } : k === "venue" ? emptyVenue() : { kind: "online", link: "" })}
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
          <div className="relative">
            <label htmlFor={id + "-search"} className={labelCls}>
              Find the venue or address
            </label>
            <input
              id={id + "-search"}
              role="combobox"
              aria-expanded={open && items.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              className={cx(input, "mt-2")}
              placeholder="Start typing, e.g. The Warehouse Greenville"
              autoComplete="off"
              value={query}
              onChange={(e) => {
                typed.current = true;
                setQuery(e.target.value);
                if (e.target.value.trim().length < 3) setItems([]);
              }}
              onKeyDown={onKey}
              onFocus={() => items.length && setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
            />
            {open && items.length > 0 && (
              <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-[16px] border border-fx-red/15 bg-white p-1 shadow-[0_24px_48px_-24px_rgba(78,7,11,.45)]">
                {items.map((s, i) => (
                  <li
                    key={s.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void pick(s)}
                    className={cx("cursor-pointer rounded-[12px] px-3 py-2", i === active ? "bg-fx-sand" : "hover:bg-fx-sand/70")}
                  >
                    <span className="block text-[15px] font-semibold">{s.primary}</span>
                    {s.secondary && <span className="block text-[13px] text-fx-red/78">{s.secondary}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 mb-0 text-[13px] text-fx-red/78" aria-live="polite">
              {searching ? "Searching…" : open && query.trim().length >= 3 && !items.length ? "No matches. Type the address below." : note}
              {pinned && !searching && (
                <>
                  {" "}
                  <a href={mapHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-fx-red-second underline underline-offset-2">
                    View on map
                  </a>
                </>
              )}
            </p>
          </div>
          <div>
            <label htmlFor={id + "-vname"} className={labelCls}>
              Venue name
            </label>
            <input id={id + "-vname"} className={cx(input, "mt-2")} placeholder="e.g. The Warehouse" autoComplete="organization" aria-invalid={!!error} value={venue.venueName} onChange={(e) => edit({ venueName: e.target.value })} />
          </div>
          <div>
            <label htmlFor={id + "-addr"} className={labelCls}>
              Street address
            </label>
            <input id={id + "-addr"} className={cx(input, "mt-2")} placeholder="200 W Washington St" autoComplete="street-address" value={venue.address} onChange={(e) => edit({ address: e.target.value }, true)} />
          </div>
          <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1fr)] gap-3 max-[641px]:grid-cols-2">
            <div className="max-[641px]:col-span-2">
              <label htmlFor={id + "-city"} className={labelCls}>
                City
              </label>
              <input id={id + "-city"} className={cx(input, "mt-2")} placeholder="Greenville" autoComplete="address-level2" aria-invalid={!!error && !venue.city} value={venue.city} onChange={(e) => edit({ city: e.target.value }, true)} />
            </div>
            <div>
              <label htmlFor={id + "-region"} className={labelCls}>
                State
              </label>
              <input id={id + "-region"} className={cx(input, "mt-2")} placeholder="SC" autoComplete="address-level1" maxLength={40} value={venue.region} onChange={(e) => edit({ region: e.target.value }, true)} />
            </div>
            <div>
              <label htmlFor={id + "-zip"} className={labelCls}>
                ZIP code
              </label>
              <input id={id + "-zip"} className={cx(input, "mt-2")} placeholder="29601" autoComplete="postal-code" maxLength={20} value={venue.postalCode} onChange={(e) => edit({ postalCode: e.target.value }, true)} />
            </div>
          </div>
          {venue.country && venue.country !== "US" && <p className="m-0 text-[13px] text-fx-red/78">Country: {venue.country}</p>}
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
          <p className="mt-2 text-[13px] text-fx-red/78">Only people with a ticket see this link: on their tickets, their order page and in their emails. It’s never shown on the event page.</p>
          <FieldError>{error}</FieldError>
        </div>
      )}
    </div>
  );
}
