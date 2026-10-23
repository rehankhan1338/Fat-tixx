/* Derived event values and server-rendered content sections of the event page. */

import Image from "next/image";
import Link from "next/link";
import EventTile from "@/components/events/EventTile";
import ProBadge from "@/components/events/ProBadge";
import FollowButton from "@/components/organizer/FollowButton";
import { button, cardShadow, container, cx, eyebrow, sectionTitle } from "@/components/ui/styles";
import { clock24, endOf, isoLocal } from "@/lib/home/event-page";
import type { EventPageData, SponsorView } from "@/lib/home/event-page";
import { listUpcoming, organizerHref, parseStart } from "@/lib/home/events";
import type { ListedEvent } from "@/lib/home/events";
import { formatCents } from "@/lib/home/pricing";
import { RichText } from "@/components/rich-text";
import type { CalendarInfo } from "./EventActions";
import ReadMore from "./ReadMore";
import VideoEmbed from "./VideoEmbed";
import { DoorIcon, FlagIcon, IdIcon, PinIcon, RefundIcon, TagIcon } from "./icons";

/* dates are venue-local strings; format them without converting time zones */
export function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** several dates in one line, the year once at the end when they share it */
function joinDates(dates: string[]): string {
  const full = dates.map(longDate);
  const year = dates[0].slice(0, 4);
  const sameYear = dates.every((d) => d.startsWith(year));
  const parts = sameYear ? full.map((f) => f.replace(`, ${year}`, "")) : full;
  const text = parts.length > 2 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts.join(" and ");
  return sameYear ? `${text}, ${year}` : text;
}

function zoneAbbr(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

const utcStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export type EventView = ReturnType<typeof eventView>;

/** Everything the layouts need, worked out once. */
export function eventView(data: EventPageData) {
  const { event: e, organizer: org } = data;
  const listed: ListedEvent = { ...e, dt: parseStart(e), v: 1 };
  const startIso = isoLocal(e.date, e.time, data.timeZone);
  const end = endOf(data);
  const endIso = isoLocal(end.date, end.time, data.timeZone);
  const tz = zoneAbbr(startIso, data.timeZone);
  const place = [data.address, e.city !== "Online" ? e.city : ""].filter(Boolean).join(", ");
  const online = data.online || (e.city === "Online" && !data.address);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${e.venue}, ${place}`)}`;

  const lowest = data.lowestCents;
  // label on the "Get tickets" pill at the bottom of the page
  const cta = data.rsvp
    ? "Register"
    : lowest == null
      ? data.salesUpcoming
        ? "Tickets on sale soon"
        : "Sold out · See tickets"
      : lowest === 0
        ? "Get free tickets"
        : `Get tickets from ${formatCents(lowest)}`;

  const cal: CalendarInfo = {
    title: e.title,
    details: data.summary,
    location: `${e.venue}${place ? `, ${place}` : ""}`,
    startUtc: utcStamp(startIso),
    endUtc: utcStamp(endIso),
    slug: data.slug,
  };

  const more = listUpcoming(data.more, null);

  // multi-day events list every date
  const days = data.days && data.days.length > 1 ? data.days.map((d) => d.date) : null;
  // the organizer's "Show end time" switch: off shows the start only (calendars still get an end)
  const timeLine = `${clock24(e.time)}${data.showEndTime ? ` to ${clock24(end.time)}` : ""} ${tz}${days ? " each day" : ""}`.replace(/\s+/g, " ").trim();
  const short = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  };
  const shortDate = days ? days.map(short).join(" & ") : short(e.date);
  /** "Friday, October 9, 2026", or "Sunday, October 25 and Monday, October 26, 2026" */
  const dateText = days ? joinDates(days) : longDate(e.date);

  return { e, org, listed, startIso, endIso, end, tz, place, online, mapsUrl, lowest, cta, cal, more, moreFromOrg: data.moreFromOrg, timeLine, shortDate, dateText, brand: data.brand ?? null };
}

/* ---------- small shared bits ---------- */

/** schema.org Event, so search engines can show the date, place and price in results */
export function EventJsonLd({ data, v }: { data: EventPageData; v: EventView }) {
  const { e, org } = v;
  const abs = (u: string | null | undefined) => (u ? (u.startsWith("http") ? u : `${data.siteUrl}${u}`) : undefined);
  const json = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    description: data.summary || undefined,
    startDate: v.startIso,
    endDate: v.endIso,
    eventStatus: data.status === "postponed" ? "https://schema.org/EventPostponed" : data.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: v.online ? "https://schema.org/OnlineEventAttendanceMode" : "https://schema.org/OfflineEventAttendanceMode",
    location: v.online
      ? { "@type": "VirtualLocation", url: `${data.siteUrl}${e.href}` }
      : {
          "@type": "Place",
          name: e.venue,
          address: {
            "@type": "PostalAddress",
            streetAddress: data.address || undefined,
            addressLocality: e.city.split(",")[0]?.trim(),
            addressRegion: e.city.split(",")[1]?.trim(),
            addressCountry: "US",
          },
        },
    image: abs(e.image ?? org.logo),
    organizer: { "@type": "Organization", name: org.name, url: `${data.siteUrl}${organizerHref(org.id)}` },
    isAccessibleForFree: v.lowest === 0,
    offers: data.offers
      .filter((t) => t.status !== "closed")
      .map((t) => ({
        "@type": "Offer",
        name: t.name,
        price: (t.allInCents / 100).toFixed(2),
        priceCurrency: "USD",
        availability: t.status === "sold_out" ? "https://schema.org/SoldOut" : t.status === "scheduled" ? "https://schema.org/PreOrder" : "https://schema.org/InStock",
        url: `${data.siteUrl}${e.href}`,
      })),
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(json).replace(/</g, "\\u003c") }} />;
}

export function Breadcrumb({ category, preview, organizer }: { category: string; preview?: boolean; organizer?: { name: string; href: string } | null }) {
  const link = "hover:text-fx-red";
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[13px] text-fx-red/78">
      {organizer ? (
        // a Pro organizer's page stays on their own pages
        <Link href={organizer.href} className={link}>
          {organizer.name}
        </Link>
      ) : (
        <>
          <Link href="/events" className={link}>
            Events
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/events?cat=${encodeURIComponent(category)}`} className={link}>
            {category}
          </Link>
        </>
      )}
      {preview && <span className="ml-2 rounded-full bg-fx-red/8 px-2 py-[2px] text-[11px] font-semibold tracking-[.06em] text-fx-red uppercase">Preview</span>}
    </nav>
  );
}

export function OrgAvatar({ logo, name, size }: { logo?: string | null; name: string; size: number }) {
  return (
    <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-fx-red/12 bg-white text-fx-red" style={{ width: size, height: size }} aria-hidden="true">
      {logo ? <Image src={logo} alt="" fill sizes={`${size}px`} className="object-contain p-[14%]" /> : <span className="font-display text-[14px] font-bold">{initials(name)}</span>}
    </span>
  );
}

/** "Hosted by <organizer>" chip that jumps to the organizer section */
export function HostChip({ v }: { v: EventView }) {
  return (
    <a href="#organizer" className="inline-flex items-center gap-3 rounded-full pr-3">
      <OrgAvatar logo={v.org.logo} name={v.org.name} size={44} />
      <span className="text-[15px] leading-tight">
        <span className="block text-fx-red/78">Hosted by</span>
        <span className="flex items-center gap-[6px] font-semibold">
          {v.org.name}
          {v.org.pro && <ProBadge />}
        </span>
      </span>
    </a>
  );
}

const h2 = cx(sectionTitle, "text-[28px] tracking-[-0.02em]");

/* ---------- content sections ---------- */

/** Long descriptions are folded with a "View more" button. Bold, italics, links and bullet lists come from the /create editor. */
export function About({ data, className }: { data: EventPageData; className?: string }) {
  if (!data.about.trim()) return null;
  return (
    <section aria-labelledby="about-h" className={className}>
      <h2 id="about-h" className={h2}>
        About this event
      </h2>
      <div className="mt-4">
        <ReadMore>
          <RichText text={data.about} className="grid max-w-[640px] gap-4 text-[16px] leading-[1.7] text-fx-red/85" />
        </ReadMore>
      </div>
    </section>
  );
}

/** The organizer's photos (up to 5) and YouTube video */
export function Media({ data, className }: { data: EventPageData; className?: string }) {
  if (!data.gallery.length && !data.video) return null;
  return (
    <section aria-labelledby="media-h" className={className}>
      <h2 id="media-h" className={h2}>
        {data.gallery.length ? "Photos" : "Video"}
        {data.gallery.length && data.video ? " & video" : ""}
      </h2>
      {data.video && (
        <div className="mt-5">
          <VideoEmbed id={data.video.id} title={data.video.title} />
        </div>
      )}
      {data.gallery.length > 0 && (
        <ul className="mt-5 grid grid-cols-3 gap-3 max-[641px]:grid-cols-2">
          {data.gallery.map((src, i) => (
            <li key={src} className={cx("overflow-hidden rounded-[18px] bg-white", i === 0 && data.gallery.length % 2 === 1 && "col-span-2 row-span-2 max-[641px]:col-span-2")}>
              <a href={src} target="_blank" rel="noopener" className="block h-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- pre-optimized upload */}
                <img src={src} alt={`Photo ${i + 1} of ${data.gallery.length}`} loading="lazy" className="aspect-square h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Lineup({ data, className }: { data: EventPageData; className?: string }) {
  if (!data.lineup.length) return null;
  return (
    <section aria-labelledby="lineup-h" className={className}>
      <h2 id="lineup-h" className={h2}>
        Lineup
      </h2>
      <ul className="mt-5 grid grid-cols-2 gap-3 max-[641px]:grid-cols-1">
        {data.lineup.map((l) => (
          <li key={l.name} className={cx("flex items-center gap-4 rounded-[18px] border border-fx-red/10 bg-white p-4", cardShadow)}>
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-fx-red font-display text-[16px] font-bold text-fx-ivory" aria-hidden="true">
              {initials(l.name)}
            </span>
            <span className="min-w-0">
              <span className="block leading-[1.3] font-semibold">{l.name}</span>
              <span className="block text-[14px] text-fx-red/78">{l.role}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Sponsors({ sponsors, className }: { sponsors: SponsorView[]; className?: string }) {
  if (!sponsors.length) return null;
  return (
    <section aria-labelledby="sponsors-h" className={className}>
      <h2 id="sponsors-h" className={h2}>
        Sponsored by
      </h2>
      <ul className={cx("mt-5 flex flex-wrap items-center gap-8 rounded-[22px] border border-fx-red/10 bg-white px-6 py-5", cardShadow)}>
        {sponsors.map((s) => {
          const inner = s.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- pre-optimized sponsor logo
            <img src={s.logoUrl} alt={s.name} loading="lazy" className="h-12 max-w-40 object-contain" />
          ) : (
            <span className="font-semibold">{s.name}</span>
          );
          return (
            <li key={s.id} className="text-center">
              {s.url ? (
                <a href={s.url} target="_blank" rel="sponsored noopener">
                  {inner}
                </a>
              ) : (
                inner
              )}
              {s.tier && <span className="mt-1 block text-[11px] text-fx-red/78">{s.tier}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function GoodToKnow({ data, className }: { data: EventPageData; className?: string }) {
  const facts = [
    { icon: <IdIcon />, label: "Age", value: data.ageText },
    data.doorsTime ? { icon: <DoorIcon />, label: "Doors", value: `Doors open at ${clock24(data.doorsTime)}` } : null,
    { icon: <RefundIcon />, label: "Refunds", value: data.refundText },
    { icon: <TagIcon />, label: "Fees", value: data.feeText },
  ].filter((f): f is NonNullable<typeof f> => f != null);

  return (
    <section aria-labelledby="know-h" className={className}>
      <h2 id="know-h" className={h2}>
        Good to know
      </h2>
      <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-6 max-[641px]:grid-cols-1">
        {facts.map((f) => (
          <div key={f.label} className="flex gap-3">
            <dt className="mt-[2px] shrink-0 text-fx-red/80">
              {f.icon}
              <span className="sr-only">{f.label}</span>
            </dt>
            <dd>
              <span className="block text-[13px] font-semibold tracking-[.08em] text-fx-red/78 uppercase" aria-hidden="true">
                {f.label}
              </span>
              <span className="mt-1 block text-[15px] leading-[1.5]">{f.value}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function LocationCard({ v, className }: { v: EventView; className?: string }) {
  if (v.online) return null;
  return (
    <section aria-labelledby="where-h" className={className}>
      <h2 id="where-h" className={h2}>
        Location
      </h2>
      <div className={cx("mt-5 flex flex-wrap items-center justify-between gap-5 rounded-[22px] border border-fx-red/10 bg-white p-6", cardShadow)}>
        <div className="flex min-w-0 gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-fx-red/8">
            <PinIcon size={22} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-[20px] font-semibold tracking-[-0.01em]">{v.e.venue}</p>
            <p className="text-[15px] text-fx-red/78">{v.place}</p>
          </div>
        </div>
        <a href={v.mapsUrl} target="_blank" rel="noopener noreferrer" className={button("outline")}>
          Get directions
        </a>
      </div>
    </section>
  );
}

/** Centered organizer card: big logo, name, how many events, Follow and a link to their organizer page */
export function OrganizerCard({ v, className }: { v: EventView; className?: string }) {
  const { org } = v;
  const count = org.eventCount ?? 0;
  return (
    <section id="organizer" aria-labelledby="org-h" className={cx("scroll-mt-[104px]", className)}>
      <h2 id="org-h" className={h2}>
        Hosted by
      </h2>
      <div className={cx("mt-5 rounded-[24px] border border-fx-red/10 bg-white px-6 pt-9 pb-8 text-center", cardShadow)}>
        <div className="mx-auto w-fit">
          <OrgAvatar logo={org.logo} name={org.name} size={112} />
        </div>
        <p className="mt-4 flex items-center justify-center gap-2 font-display text-[24px] font-semibold tracking-[-0.01em]">
          {org.name}
          {org.pro && <ProBadge size={18} />}
        </p>
        {count > 0 && (
          <p className="mt-1 text-[14px] text-fx-red/78">
            {count} {count === 1 ? "event" : "events"}{v.brand ? "" : " on Fattixx"}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <FollowButton organizerId={org.id} name={org.name} />
          <Link href={v.brand?.organizerHref ?? organizerHref(org.id)} className={button("outline")}>
            View their page
          </Link>
        </div>
      </div>
    </section>
  );
}

export function ReportLink({ title, email }: { title: string; email: string }) {
  return (
    <a href={`mailto:${email}?subject=${encodeURIComponent(`Report: ${title}`)}`} className="inline-flex items-center gap-2 text-[13px] text-fx-red/78 hover:text-fx-red">
      <FlagIcon /> Report this event
    </a>
  );
}

export function MoreEvents({ v }: { v: EventView }) {
  if (!v.more.length) return null;
  return (
    <section aria-labelledby="more-h" className="border-t border-fx-red/10 pt-20 pb-8 max-[641px]:pt-14">
      <div className={container}>
        <p className={eyebrow}>Keep exploring</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <h2 id="more-h" className={cx(sectionTitle, "text-[clamp(30px,3.4vw,44px)] leading-[1.02] tracking-[-0.035em]")}>
            {v.moreFromOrg ? `More from ${v.org.name}` : "You might also like"}
          </h2>
          <Link href={v.brand?.organizerHref ?? "/events"} className="text-[15px] font-semibold text-fx-red-second underline underline-offset-[3px] hover:text-fx-red">
            {v.brand ? "All their events" : "Browse all events"}
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-4 gap-x-6 gap-y-10 max-[1101px]:grid-cols-3 max-[721px]:grid-cols-2 max-[721px]:gap-x-4">
          {v.more.map((x) => (
            <EventTile key={x.id} e={x} />
          ))}
        </div>
      </div>
    </section>
  );
}
