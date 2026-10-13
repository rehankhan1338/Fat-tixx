"use client";

/*
 * "Add to calendar" (Google Calendar link, or an .ics file for Apple Calendar / Outlook) and "Share"
 * (the phone's share sheet where there is one, otherwise copy the link).
 */

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/styles";
import { CalendarIcon, ChevronDown, ShareIcon } from "./icons";

export type CalendarInfo = {
  title: string;
  details: string;
  location: string;
  /** UTC, "20261010T000000Z" */
  startUtc: string;
  endUtc: string;
  slug: string;
};

const pill =
  "inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-fx-red/25 bg-white px-4 text-[14px] font-semibold text-fx-red transition-colors hover:border-fx-red";

function icsText(c: CalendarInfo, url: string): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fattixx//Event//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${c.slug}@fattixx.com`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${c.startUtc}`,
    `DTEND:${c.endUtc}`,
    `SUMMARY:${esc(c.title)}`,
    `DESCRIPTION:${esc(c.details + "\n\n" + url)}`,
    `LOCATION:${esc(c.location)}`,
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function AddToCalendar({ cal }: { cal: CalendarInfo }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const google = () => {
    const p = new URLSearchParams({
      action: "TEMPLATE",
      text: cal.title,
      dates: `${cal.startUtc}/${cal.endUtc}`,
      details: `${cal.details}\n\n${window.location.href}`,
      location: cal.location,
    });
    window.open(`https://calendar.google.com/calendar/render?${p}`, "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  const download = () => {
    const blob = new Blob([icsText(cal, window.location.href)], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${cal.slug}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setOpen(false);
  };

  const item = "flex w-full cursor-pointer items-center rounded-[10px] px-3 py-[10px] text-left text-[14px] font-medium hover:bg-fx-ivory";

  return (
    <div ref={wrap} className="relative">
      <button type="button" className={pill} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <CalendarIcon size={18} /> Add to calendar <ChevronDown />
      </button>
      {open && (
        <div className="absolute top-[calc(100%+8px)] left-0 z-20 w-[230px] rounded-[16px] border border-fx-red/12 bg-white p-[6px] text-fx-red shadow-[0_24px_50px_-20px_rgba(78,7,11,.45)]">
          <button type="button" className={item} onClick={google}>
            Google Calendar
          </button>
          <button type="button" className={item} onClick={download}>
            Apple Calendar or Outlook (.ics)
          </button>
        </div>
      )}
    </div>
  );
}

/** Round icon button; says "Link copied" in a small bubble when it copies */
export function ShareButton({ title, label = "Share this event" }: { title: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* cancelled: fall through to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  return (
    <button
      type="button"
      className="relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-fx-red/20 bg-white text-fx-red transition-colors hover:border-fx-red"
      onClick={share}
      title="Share"
    >
      <ShareIcon size={18} />
      <span className="sr-only">{label}</span>
      <span
        aria-live="polite"
        className={cx(
          "pointer-events-none absolute top-[calc(100%+8px)] right-0 rounded-full bg-fx-red px-3 py-[6px] text-[12px] font-semibold whitespace-nowrap text-fx-ivory transition-opacity",
          copied ? "opacity-100" : "opacity-0",
        )}
      >
        {copied ? "Link copied" : ""}
      </span>
    </button>
  );
}
