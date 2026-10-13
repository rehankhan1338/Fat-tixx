/* Organizer profile and event lists; Pro profiles inherit the organizer theme. */

import Link from "next/link";
import type { ReactNode } from "react";
import { ShareButton } from "@/components/event/EventActions";
import ReadMore from "@/components/event/ReadMore";
import { ArrowUpRight, PinIcon } from "@/components/event/icons";
import { OrgAvatar } from "@/components/event/EventPageParts";
import EventTile from "@/components/events/EventTile";
import ProBadge from "@/components/events/ProBadge";
import SocialIcon, { SOCIAL_NETWORKS } from "@/components/ui/SocialIcon";
import { button, container, cx, sectionTitle } from "@/components/ui/styles";
import type { ListedEvent } from "@/lib/home/events";
import type { OrganizerPageData } from "@/lib/home/organizer-page";
import type { SocialNetwork } from "@/lib/home/types";
import FollowButton from "./FollowButton";

const PAST_SHOWN = 12;

/** adds https:// when the organizer typed a bare domain */
function absoluteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** "example.com" from a stored website, or null when it is not a usable URL */
function safeHost(url: string): string | null {
  try {
    return new URL(absoluteUrl(url)).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const grid = "mt-8 grid grid-cols-4 gap-x-6 gap-y-10 max-[1101px]:grid-cols-3 max-[721px]:grid-cols-2 max-[721px]:gap-x-4";

function SectionHead({ id, title, count, children }: { id: string; title: string; count: number; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 id={id} className={cx(sectionTitle, "text-[clamp(26px,2.6vw,34px)] leading-none tracking-[-0.03em]")}>
        {title}
      </h2>
      <span className="rounded-full bg-fx-red/8 px-[10px] py-[3px] text-[14px] font-semibold tabular-nums">{count}</span>
      {children}
    </div>
  );
}

/** Opens in a new tab when it's a real URL */
function external(href: string) {
  return href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {};
}

const ring = "rounded-full border border-fx-red/20 bg-white text-fx-red transition-colors hover:border-fx-red";

function EventGrid({ events }: { events: ListedEvent[] }) {
  return (
    <div className={grid}>
      {events.map((e) => (
        <EventTile key={e.id} e={e} />
      ))}
    </div>
  );
}

export default function OrganizerPage({ data }: { data: OrganizerPageData }) {
  const { organizer: o, upcoming, past, cities } = data;
  const site = o.website ? safeHost(o.website) : null;
  const social = Object.entries(o.social ?? {}).filter(([, href]) => href) as [SocialNetwork, string][];

  return (
    <div className={cx(container, "max-w-[1120px] pt-[136px] pb-24 max-[901px]:pt-[116px] max-[641px]:pb-16")}>
      {/* ---------- organizer ---------- */}
      <header className="text-center text-fx-red">
        <div className="mx-auto w-fit">
          <OrgAvatar logo={o.logo} name={o.name} size={120} />
        </div>
        <h1 className="mt-6 flex flex-wrap items-center justify-center gap-x-3 font-display text-[clamp(34px,4.4vw,52px)] leading-[1.05] font-semibold tracking-[-0.035em] text-balance">
          {o.name}
          {o.pro && <ProBadge size={28} />}
        </h1>
        <p className="mt-4 text-[16px] font-semibold">
          {upcoming.length ? `${upcoming.length} upcoming ${upcoming.length === 1 ? "event" : "events"}` : "No upcoming events"}
        </p>
        {cities.length > 0 && (
          <p className="mx-auto mt-1 max-w-[520px] text-[15px] text-balance text-fx-red/78">
            <span className="mr-[6px] inline-block align-[-2px]">
              <PinIcon size={16} />
            </span>
            {/* the dot stays at the end of a line when the list wraps */}
            {[...cities.slice(0, 3), ...(cities.length > 3 ? [`+${cities.length - 3} more`] : [])].join("\u00a0· ")}
          </p>
        )}
        {/* TODO: "Contact" once accounts exist */}
        <div className="mt-7 flex items-center justify-center gap-3">
          <FollowButton organizerId={o.id} name={o.name} />
          <ShareButton title={o.name} label={`Share ${o.name}’s page`} />
        </div>

        {o.bio && (
          <div className="mx-auto mt-8 max-w-[600px] text-[16px] leading-[1.65] text-fx-red/85">
            <ReadMore maxHeight={80}>
              <p>{o.bio}</p>
            </ReadMore>
          </div>
        )}

        {(social.length > 0 || site) && (
          <ul aria-label={`${o.name} links`} className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {social.map(([network, href]) => (
              <li key={network}>
                <a href={href} {...external(href)} aria-label={`${o.name} on ${SOCIAL_NETWORKS[network].label}`} className={cx("grid size-11 place-items-center", ring)}>
                  <SocialIcon network={network} size={19} />
                </a>
              </li>
            ))}
            {o.website && site && (
              <li>
                <a href={absoluteUrl(o.website)} target="_blank" rel="noopener noreferrer" className={cx("inline-flex h-11 items-center gap-2 px-4 text-[14px] font-semibold", ring)}>
                  {site}
                  <ArrowUpRight size={15} />
                </a>
              </li>
            )}
          </ul>
        )}
      </header>

      {/* ---------- upcoming ---------- */}
      <section aria-labelledby="upcoming-h" className="mt-16 border-t border-fx-red/12 pt-12 max-[641px]:mt-12 max-[641px]:pt-10">
        <SectionHead id="upcoming-h" title="Upcoming events" count={upcoming.length} />
        {upcoming.length ? (
          <EventGrid events={upcoming} />
        ) : (
          <div className="mt-8 rounded-[22px] border border-fx-red/10 bg-white px-6 py-12 text-center">
            <p className="font-display text-[20px] font-semibold">Nothing on sale right now</p>
            <p className="mt-2 text-[15px] text-fx-red/78">New events from {o.name} will show up here.</p>
            <Link href="/events" className={cx(button("outline"), "mt-6")}>
              Browse all events
            </Link>
          </div>
        )}
      </section>

      {/* ---------- past ---------- */}
      {past.length > 0 && (
        <section aria-labelledby="past-h" className="mt-20 max-[641px]:mt-14">
          <SectionHead id="past-h" title="Past events" count={past.length} />
          <EventGrid events={past.slice(0, PAST_SHOWN)} />
        </section>
      )}
    </div>
  );
}
