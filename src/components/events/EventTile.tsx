/* One event in the /events grid, the featured carousel and an event page's "More from": poster, organizer, title, price at venue, date. */

import { cx } from "@/components/ui/styles";
import { eventHref, isPro, organizerName, priceAtVenue, whenText } from "@/lib/home/events";
import type { ListedEvent } from "@/lib/home/events";
import EventPoster from "./EventPoster";
import ProBadge from "./ProBadge";

export default function EventTile({ e, big = false }: { e: ListedEvent; big?: boolean }) {
  return (
    <a href={eventHref(e)} className="group block animate-rise rounded-[16px] text-fx-red">
      <EventPoster e={e} className="transition-transform duration-500 ease-fx group-hover:-translate-y-1" />
      <span className="mt-4 flex items-center gap-[6px] text-[14px] text-fx-red/78">
        <span className="truncate">{organizerName(e)}</span>
        {isPro(e) && <ProBadge />}
      </span>
      <span className={cx("mt-2 block font-display leading-[1.25] font-semibold tracking-[-0.01em]", big ? "text-[22px]" : "text-[18px] max-[641px]:text-[16px]")}>
        {e.title}
      </span>
      <span className="mt-[10px] block text-[14px] leading-[1.5] text-fx-red/78">
        {priceAtVenue(e)}
        <br />
        {whenText(e.dt)}
      </span>
    </a>
  );
}
