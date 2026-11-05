"use client";

import type { SeatMapOption } from "@/lib/home/create";
import { cx } from "@/components/ui/styles";
import { input, labelCls } from "./ui";

/**
 * The seat map of a seated event (Fattixx Pro). A new event picks one of the organization's approved maps or a Venue
 * Library map; once saved, the event keeps its own copy of the seats, so the page only names the map (`savedName`).
 */
export default function SeatMapField({ value, maps, onChange, savedName, seatingHref, mapsHref }: {
  value: string;
  maps: SeatMapOption[];
  onChange: (id: string) => void;
  savedName?: string | null;
  seatingHref?: string;
  mapsHref?: string;
}) {
  const link = "font-semibold text-fx-red-second underline underline-offset-4";

  if (savedName) {
    return (
      <p className="m-0 text-[15px] leading-[1.55] text-fx-red/78">
        This event uses <b className="font-semibold text-fx-red">{savedName}</b>.{" "}
        {seatingHref ? <a href={seatingHref} className={link}>Set prices and seats on the Seating tab</a> : "Prices and seats are set on the Seating tab."}
      </p>
    );
  }

  if (!maps.length) {
    return (
      <p className="m-0 text-[15px] leading-[1.55] text-fx-red/78">
        You have no approved seat maps yet.{" "}
        {mapsHref && <a href={mapsHref} className={link}>Request a map or use one from the Venue Library</a>}
      </p>
    );
  }

  return (
    <div>
      <label htmlFor="c-seat-map" className={labelCls}>
        Seat map
      </label>
      <select id="c-seat-map" className={cx(input, "mt-2 cursor-pointer")} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a map</option>
        {maps.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} · {m.place} ({m.seats} seats)
          </option>
        ))}
      </select>
      <p className="mt-2 mb-0 text-[13px] leading-[1.45] text-fx-red/78">
        We save the event as a draft and take you to its seats. There you create pricing tiers, assign seats to them and publish.
      </p>
    </div>
  );
}
