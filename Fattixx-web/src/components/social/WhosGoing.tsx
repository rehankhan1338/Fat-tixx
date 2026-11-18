/* Who's Going on the event page (11.4): a row of photos, "Maya, Jordan and 128 others are going", and the ticket holder's own switch. */

import Link from "next/link";
import type { WhosGoing as Data } from "@/lib/social/queries";
import { cx } from "@/components/ui/styles";
import PersonAvatar from "./PersonAvatar";
import GuestListToggle from "./GuestListToggle";

export default function WhosGoing({ data, line, eventId, listHref, className }: { data: Data; line: string; eventId: number; listHref: string; className?: string }) {
  const viewer = data.viewer;
  const showToggle = !!viewer?.holder && data.mode !== "off";
  if ((data.hidden || !data.people.length) && !showToggle) return null;
  return (
    <section aria-labelledby="going-h" className={cx("rounded-[22px] border border-fx-red/10 bg-white px-5 py-5 text-fx-red", className)}>
      <h2 id="going-h" className="sr-only">Who’s going</h2>
      {data.people.length > 0 && !data.hidden ? (
        <Link href={listHref} className="group flex items-center gap-4">
          <span className="flex shrink-0 -space-x-3">
            {data.people.slice(0, 5).map((p) => (
              <PersonAvatar key={p.id} src={p.avatar} name={p.name} initials={p.initials} size={40} ring />
            ))}
          </span>
          <span className="min-w-0 text-[15px] leading-snug">
            <b className="font-semibold group-hover:underline">{line}</b>
            {data.people.some((p) => p.followed) && <span className="block text-[13px] text-fx-red/70">People you follow are shown first</span>}
          </span>
        </Link>
      ) : (
        <p className="text-[15px] text-fx-red/80">Be the first on the guest list.</p>
      )}
      {showToggle && (
        <div className="mt-4 border-t border-fx-red/10 pt-4">
          <GuestListToggle eventId={eventId} initial={viewer!.listed} hasProfile={viewer!.hasProfile} />
        </div>
      )}
    </section>
  );
}
