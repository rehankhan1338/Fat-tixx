/* Returns null when neither an event image nor organizer logo is available. */

import Image from "next/image";
import { eventArt } from "@/lib/home/events";
import type { EventItem } from "@/lib/home/types";
import { cx } from "./styles";

export default function EventArt({
  e,
  sizes,
  logoBox = "inset-[16%]",
  className,
}: {
  e: EventItem;
  /** e.g. "(max-width: 720px) 50vw, 300px" so the browser picks a sensible file size */
  sizes: string;
  /** where the logo sits inside the box (Tailwind inset classes) */
  logoBox?: string;
  className?: string;
}) {
  const art = eventArt(e);
  if (!art) return null;
  if (art.kind === "image") {
    return <Image src={art.src} alt="" fill sizes={sizes} className={cx("object-cover", className)} />;
  }
  return (
    <span className={cx("absolute inset-0 block bg-white", className)}>
      <span className={cx("absolute block", logoBox)}>
        <Image src={art.src} alt="" fill sizes={sizes} className="object-contain" />
      </span>
    </span>
  );
}
