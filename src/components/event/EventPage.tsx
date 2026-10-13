/* Server-rendered event layout; ticket, calendar and share interactions are client components. */

import type { ReactNode } from "react";
import Link from "next/link";
import EventPoster from "@/components/events/EventPoster";
import { container, cx, sectionTitle } from "@/components/ui/styles";
import { clock24 } from "@/lib/home/event-page";
import type { EventPageData } from "@/lib/home/event-page";
import { AddToCalendar, ShareButton } from "./EventActions";
import { CalendarIcon, PinIcon } from "./icons";
import { About, Breadcrumb, EventJsonLd, eventView, GoodToKnow, HostChip, Lineup, LocationCard, MoreEvents, OrganizerCard, ReportLink, Sponsors } from "./EventPageParts";
import type { EventView } from "./EventPageParts";
import TicketDialog from "./TicketDialog";

/** Top of the ticket pop-up: the poster, title, venue and date (one row on phones) */
function TicketSummary({ v }: { v: EventView }) {
  const { e } = v;
  return (
    <div className="text-fx-red max-[721px]:flex max-[721px]:items-center max-[721px]:gap-4">
      <div className="max-[721px]:w-16 max-[721px]:shrink-0">
        <EventPoster e={v.listed} className="shadow-[0_24px_48px_-28px_rgba(78,7,11,.5)] max-[721px]:rounded-[10px] max-[721px]:shadow-none" />
      </div>
      <div className="mt-5 min-w-0 max-[721px]:mt-0">
        <p className="font-display text-[22px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance max-[721px]:text-[17px]">{e.title}</p>
        <p className="mt-3 text-[14px] font-semibold max-[721px]:mt-1">{e.venue}</p>
        <p className="text-[14px] text-fx-red/78">
          {v.shortDate} · {clock24(e.time)}
        </p>
      </div>
    </div>
  );
}

function Notice({ title, text }: { title: string; text?: string }) {
  return (
    <div role="status" className="mt-6 rounded-[18px] border border-fx-yellow/80 bg-fx-yellow/30 px-5 py-4 text-[15px] leading-[1.5]">
      <b className="font-semibold">{title}</b>
      {text && <span className="block text-fx-red/85">{text}</span>}
    </div>
  );
}

export default function EventPage({ data, panel, ad, notices = [] }: { data: EventPageData; panel: ReactNode; ad?: ReactNode; notices?: { title: string; text?: string }[] }) {
  const v = eventView(data);
  const { e } = v;

  return (
    <>
      <EventJsonLd data={data} v={v} />

      <div className={cx(container, "pt-[112px] pb-24 max-[901px]:pt-[96px] max-[641px]:pb-16")}>
        <Breadcrumb category={e.category} preview={data.preview} />
        {data.preview && <Notice title={`This event is ${data.status}.`} text="Only your team can see this page until it is published." />}
        {data.status === "postponed" && <Notice title="This event has been postponed." text="Existing tickets remain valid for the new date." />}
        {data.status === "cancelled" && <Notice title="This event has been cancelled." text="Paid orders are refunded in full." />}
        {notices.map((n) => (
          <Notice key={n.title} title={n.title} text={n.text} />
        ))}

        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_380px] items-start gap-x-16 max-[1101px]:grid-cols-[minmax(0,1fr)_330px] max-[1101px]:gap-x-10 max-[901px]:grid-cols-1">
          {/* ---------- poster: right column and sticky on desktop, first on phones ---------- */}
          <aside aria-label="Event poster" className="sticky top-[104px] col-start-2 row-start-1 text-fx-red max-[901px]:static max-[901px]:col-start-1 max-[901px]:mx-auto max-[901px]:w-full max-[901px]:max-w-[380px] max-[641px]:max-w-[300px]">
            <EventPoster e={v.listed} className="shadow-[0_30px_60px_-30px_rgba(78,7,11,.45)]" />
            <div className="mt-7 text-center max-[901px]:hidden">
              <p className="font-display text-[20px] leading-[1.2] font-semibold tracking-[-0.015em] text-balance">{e.title}</p>
              <p className="mt-3 text-[15px] font-semibold">{e.venue}</p>
              <p className="text-[15px] text-fx-red/78">{v.shortDate}</p>
              <p className="text-[15px] text-fx-red/78">{v.timeLine}</p>
            </div>
          </aside>

          {/* ---------- details ---------- */}
          <div className="col-start-1 row-start-1 min-w-0 text-fx-red max-[901px]:row-start-2 max-[901px]:mt-8">
            <div className="flex items-center justify-between gap-4 border-t border-fx-red/12 pt-5">
              <HostChip v={v} />
              <ShareButton title={e.title} />
            </div>

            <h1 className={cx(sectionTitle, "mt-8 text-[clamp(38px,4.4vw,58px)] leading-[1] tracking-[-0.04em] text-balance")}>{e.title}</h1>

            {/* when and where */}
            <dl className="mt-8 grid gap-6">
              <div className="flex gap-4">
                <dt className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-fx-red/8">
                  <CalendarIcon />
                  <span className="sr-only">Date and time</span>
                </dt>
                <dd className="min-w-0">
                  <p className="text-[16px] font-semibold">{v.dateText}</p>
                  <p className="mt-[2px] text-[15px] text-fx-red/78">
                    {v.timeLine}
                    {data.doorsTime && <> · Doors {clock24(data.doorsTime)}</>}
                  </p>
                  {data.days && data.days.length > 1 && (
                    <ul className="mt-2 grid gap-[2px] text-[14px] text-fx-red/78">
                      {data.days.map((d) => (
                        <li key={d.date}>
                          <b className="font-semibold text-fx-red">{d.label}</b> · {d.time}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <AddToCalendar cal={v.cal} />
                  </div>
                  {data.siblings.length > 0 && (
                    <div className="mt-4">
                      <p className="text-[13px] font-semibold tracking-[.08em] text-fx-red/78 uppercase">More dates</p>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {data.siblings.map((s) => (
                          <li key={s.href}>
                            <Link href={s.href} className="inline-flex min-h-10 items-center rounded-full border border-fx-red/25 bg-white px-4 text-[14px] font-semibold hover:border-fx-red">
                              {s.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </dd>
              </div>
              <div className="flex gap-4">
                <dt className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-fx-red/8">
                  <PinIcon />
                  <span className="sr-only">Location</span>
                </dt>
                <dd className="min-w-0">
                  <p className="text-[16px] font-semibold">{e.venue}</p>
                  {v.place && <p className="mt-[2px] text-[15px] text-fx-red/78">{v.place}</p>}
                  {!v.online && (
                    <a href={v.mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[14px] font-semibold text-fx-red-second underline underline-offset-[3px] hover:text-fx-red">
                      Get directions
                    </a>
                  )}
                </dd>
              </div>
            </dl>

            {data.summary && <p className="mt-8 border-y border-fx-red/12 py-7 text-[18px] leading-[1.6] text-fx-red/85 max-[641px]:text-[16px]">{data.summary}</p>}

            <About data={data} className="mt-10" />
            <Lineup data={data} className="mt-14" />
            <Sponsors sponsors={data.sponsors} className="mt-14" />
            {ad && <div className="mt-10">{ad}</div>}
            <GoodToKnow data={data} className="mt-14" />
            <LocationCard v={v} className="mt-14" />
            <OrganizerCard v={v} className="mt-14" />
            <div className="mt-8 flex justify-center">
              <ReportLink title={e.title} email={data.contactEmail} />
            </div>
          </div>
        </div>
      </div>

      <MoreEvents v={v} />

      <TicketDialog pillText={v.cta} endIso={v.endIso} summary={<TicketSummary v={v} />}>
        {panel}
      </TicketDialog>
    </>
  );
}
