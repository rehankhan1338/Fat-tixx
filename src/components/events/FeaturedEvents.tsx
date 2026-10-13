"use client";

import { useMemo, useState } from "react";
import { useHome } from "@/components/home/HomeState";
import { cx, sectionTitle } from "@/components/ui/styles";
import { eventHref } from "@/lib/home/events";
import EventPoster from "./EventPoster";
import EventTile from "./EventTile";

function Arrow({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "prev" ? "Previous featured event" : "Next featured event"}
      className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border border-fx-red/20 bg-white text-fx-red transition-colors duration-200 hover:border-fx-red"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={dir === "prev" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
      </svg>
    </button>
  );
}

export default function FeaturedEvents() {
  const { upcoming } = useHome();
  const featured = useMemo(() => upcoming.filter((e) => e.featured), [upcoming]);
  const [start, setStart] = useState(0);
  const n = featured.length;
  if (!n) return null;

  const order = featured.map((_, i) => featured[(i + start) % n]);
  const [first, ...rest] = order;
  const move = (d: number) => setStart((s) => (s + d + n) % n);

  return (
    <section aria-labelledby="featured-h" className="pt-[128px] pl-(--pad) max-[901px]:pt-[104px]">
      <div className="flex items-baseline justify-between gap-4 pr-(--pad)">
        <h1 id="featured-h" className={cx(sectionTitle, "text-[26px] tracking-[-0.02em]")}>
          Featured events
        </h1>
        {/* Fattixx Pro organizers' events are featured, so this goes to /pro. TODO: paid featured placements, if offered */}
        <a href="/pro" className="text-[14px] font-semibold text-fx-red-second hover:text-fx-red">
          Feature your event
        </a>
      </div>

      <div className="relative mt-7">
        <div className="no-scrollbar flex items-start gap-5 overflow-hidden max-[721px]:snap-x max-[721px]:snap-mandatory max-[721px]:overflow-x-auto max-[721px]:pr-(--pad) max-[641px]:gap-3">
          <div key={first.id} className="w-[clamp(260px,27vw,390px)] shrink-0 snap-start max-[641px]:w-[72vw]">
            <EventTile e={first} big />
          </div>
          {rest.map((e) => (
            <a
              key={e.id}
              href={eventHref(e)}
              aria-label={e.title}
              className="block w-[clamp(170px,17.5vw,252px)] shrink-0 animate-rise snap-start rounded-[16px] max-[641px]:w-[44vw]"
            >
              <EventPoster e={e} className="transition-transform duration-500 ease-fx hover:-translate-y-1" />
            </a>
          ))}
        </div>
        {n > 1 && (
          <div className="absolute right-(--pad) bottom-0 flex gap-[10px] max-[721px]:static max-[721px]:mt-5 max-[721px]:justify-end max-[721px]:pr-(--pad)">
            <Arrow dir="prev" onClick={() => move(-1)} />
            <Arrow dir="next" onClick={() => move(1)} />
          </div>
        )}
      </div>
    </section>
  );
}
