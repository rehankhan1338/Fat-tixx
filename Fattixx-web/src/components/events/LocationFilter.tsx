"use client";

import { useState } from "react";
import { useHome } from "@/components/home/HomeState";
import { cx } from "@/components/ui/styles";
import { byGPS } from "@/lib/home/location";
import { cityMenu, DISTANCE_OPTIONS, milesText } from "@/lib/home/places";
import type { Place } from "@/lib/home/types";
import FilterMenu, { Check, optionBtn } from "./FilterMenu";

function PinIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}

export default function LocationFilter() {
  const { filters } = useHome();
  const label = filters.near ? filters.near.label : "Anywhere";
  return (
    <FilterMenu label={label} active={!!filters.near} icon={<PinIcon />} width={320}>
      {(close) => <LocationPanel close={close} />}
    </FilterMenu>
  );
}

function LocationPanel({ close }: { close: () => void }) {
  const { upcoming, place, filters, setFilters, applyPlace, clearPlace } = useHome();
  const [text, setText] = useState("");
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState("");

  const menu = cityMenu(upcoming, text, place, filters.distance);

  function pick(p: Place) {
    applyPlace({ label: p.label, lat: p.lat, lon: p.lon, src: "pick" }, { remember: true });
    close();
  }

  function useGPS() {
    setLocating(true);
    setErr("");
    byGPS()
      .then((p) => {
        applyPlace(p, { remember: true });
        close();
      })
      .catch(() => setErr("We couldn’t get your location. Check that location access is allowed for this site, or pick a city below."))
      .finally(() => setLocating(false));
  }

  return (
    <div className="flex max-h-[min(520px,70vh)] flex-col overflow-y-auto">
      <button type="button" className={cx(optionBtn, "justify-start font-bold")} onClick={useGPS} disabled={locating}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
        {locating ? "Finding your location…" : "Use my current location"}
      </button>

      <label className="mx-1 mt-1 flex h-11 items-center gap-2 rounded-xl border border-fx-red/20 bg-fx-ivory px-3 focus-within:border-fx-red">
        <span className="sr-only">Type a city</span>
        <input
          type="text"
          autoComplete="off"
          placeholder="Type a city"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (menu.typed) pick(menu.typed);
            else if (text.trim() && menu.cities[0] && !menu.note) pick(menu.cities[0]);
          }}
          className="w-full min-w-0 border-0 bg-transparent p-0 text-[15px] text-fx-ink outline-none placeholder:text-fx-red/55"
        />
      </label>

      {(err || menu.note) && <p className="m-0 px-3 pt-3 pb-1 text-[13px] leading-[1.45] text-fx-red/78">{err || menu.note}</p>}

      <div className="mt-1">
        {menu.typed && (
          <button type="button" className={optionBtn} onClick={() => pick(menu.typed!)}>
            {menu.typed.label}
            <small className="text-[12px] text-fx-red/78">
              {menu.typed.count} {menu.typed.count === 1 ? "event" : "events"} within {filters.distance} mi
            </small>
          </button>
        )}
        {menu.cities.map((c) => {
          const on = filters.near?.label === c.label;
          return (
            <button key={c.label} type="button" aria-pressed={on} className={optionBtn} onClick={() => pick(c)}>
              <span className="min-w-0">
                {c.label}
                {c.distance != null && <span className="block text-[12px] font-normal text-fx-red/78">{milesText(c.distance)}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[12px] font-normal text-fx-red/78">
                {c.count} {c.count === 1 ? "event" : "events"}
                {on && <Check />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mx-1 my-[6px] h-px shrink-0 bg-fx-red/10" />
      <button
        type="button"
        aria-pressed={!filters.near}
        className={optionBtn}
        onClick={() => {
          clearPlace();
          close();
        }}
      >
        Anywhere
        {!filters.near && <Check />}
      </button>

      <div className="mx-1 my-[6px] h-px shrink-0 bg-fx-red/10" />
      <div className="flex flex-wrap items-center gap-1 px-2 pb-1" role="group" aria-label="Distance">
        <span className="mr-1 text-[12px] font-semibold text-fx-red/78">Within</span>
        {DISTANCE_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={filters.distance === d}
            onClick={() => setFilters({ distance: d })}
            className="min-h-9 cursor-pointer rounded-full px-3 text-[13px] font-semibold text-fx-red hover:bg-fx-ivory aria-pressed:bg-fx-red aria-pressed:text-fx-ivory"
          >
            {d} mi
          </button>
        ))}
      </div>
    </div>
  );
}
