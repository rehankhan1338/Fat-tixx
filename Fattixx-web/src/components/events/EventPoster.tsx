/* Artwork only: event flyer, organizer logo, then CSS fallback art in a 4:5 crop. */

import EventArt from "@/components/ui/EventArt";
import { cx } from "@/components/ui/styles";
import { eventArt } from "@/lib/home/events";
import type { ListedEvent } from "@/lib/home/events";

const SIZES = "(max-width: 640px) 72vw, (max-width: 900px) 33vw, 390px";

export default function EventPoster({ e, className }: { e: ListedEvent; className?: string }) {
  const art = eventArt(e);

  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative block aspect-[4/5] overflow-hidden rounded-[16px]",
        art?.kind === "logo" && "border border-fx-red/12 bg-white",
        art?.kind === "image" && "bg-fx-sand",
        !art && "poster pv" + e.v + " after:hidden",
        className,
      )}
    >
      <EventArt e={e} sizes={SIZES} />
    </span>
  );
}
