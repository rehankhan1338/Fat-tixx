"use client";

/*
 * Reserved seating on the event page (plan 5.7.3–5.7.13): the buyer taps seats on the map; each picked seat is one
 * ticket of its pricing tier. Seats other buyers take while the pop-up is open turn grey (live refresh every 15 s);
 * a picked seat someone else holds first is dropped with a note. Checkout holds the seats like any other ticket.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { SeatMapCanvas, SeatSwatch, type CanvasSeat } from "@/components/seating/SeatMapCanvas";
import { ACCESSIBILITY, type SeatStatus } from "@/lib/seating/layout";
import type { SeatingView } from "@/lib/home/event-page";
import { formatCents } from "@/lib/money";

export const MAX_SEATS = 50;
const CODE: Record<string, SeatStatus> = { a: "available", h: "held", s: "sold", b: "blocked", u: "unassigned" };

export default function SeatPicker({ eventSlug, seating, currency, selected, onChange }: {
  eventSlug: string; seating: SeatingView; currency: string; selected: number[]; onChange: (ids: number[]) => void;
}) {
  const [live, setLive] = useState<Map<number, SeatStatus> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tierById = useMemo(() => new Map(seating.tiers.map((t) => [t.id, t])), [seating.tiers]);
  const seatById = useMemo(() => new Map(seating.seats.map((s) => [s.id, s])), [seating.seats]);
  const statusOf = (id: number, fallback: SeatStatus) => live?.get(id) ?? fallback;

  // The latest selection, for the refresh callback below.
  const current = useRef({ selected, onChange, seatById });
  useEffect(() => { current.current = { selected, onChange, seatById }; });

  // Live refresh while the page is visible. A picked seat that someone else got first is dropped, with a note.
  useEffect(() => {
    let stopped = false;
    const url = `/api/seating/events/${encodeURIComponent(eventSlug)}${seating.linkKey ? `?key=${encodeURIComponent(seating.linkKey)}` : ""}`;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { seats: [number, string][] };
        if (stopped) return;
        const next = new Map(data.seats.map(([id, c]) => [id, CODE[c] ?? "unassigned"] as [number, SeatStatus]));
        setLive(next);
        const { selected: picked, onChange: change, seatById: seatsNow } = current.current;
        const lost = picked.filter((id) => { const st = next.get(id); return st !== undefined && st !== "available"; });
        if (lost.length) {
          change(picked.filter((id) => !lost.includes(id)));
          setNotice(`${lost.map((id) => seatsNow.get(id)?.label ?? "A seat").join(", ")} ${lost.length === 1 ? "was" : "were"} just taken by someone else.`);
        }
      } catch { /* offline: keep what we have */ }
    };
    const timer = setInterval(tick, 15_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [eventSlug, seating.linkKey]);

  const pickable = (id: number) => {
    const s = seatById.get(id);
    const tier = s?.tier ? tierById.get(s.tier) : undefined;
    return !!s && !!tier && tier.status === "on_sale" && statusOf(id, s.status) === "available";
  };

  const toggle = (id: number) => {
    setNotice(null);
    if (selected.includes(id)) { onChange(selected.filter((x) => x !== id)); return; }
    if (!pickable(id)) return;
    const seat = seatById.get(id)!;
    const tier = tierById.get(seat.tier!)!;
    const inTier = selected.filter((x) => seatById.get(x)?.tier === tier.id).length;
    if (inTier >= tier.max) { setNotice(`Up to ${tier.max} ${tier.name} seats per order.`); return; }
    if (selected.length >= MAX_SEATS) { setNotice(`Up to ${MAX_SEATS} seats per order.`); return; }
    onChange([...selected, id]);
  };

  const accessLabel = (a: string | null) => ACCESSIBILITY.find((x) => x.value === a)?.label;
  const seats: CanvasSeat[] = seating.seats.map((s) => {
    const tier = s.tier ? tierById.get(s.tier) : undefined;
    const st = statusOf(s.id, s.status);
    const isSelected = selected.includes(s.id);
    const open = !!tier && tier.status === "on_sale" && st === "available";
    const look = isSelected ? "selected" : open ? "open" : st === "sold" || st === "held" || st === "blocked" ? "taken" : "off";
    const what = isSelected ? "selected" : open ? formatCents(tier!.allInCents, currency) : st === "sold" || st === "held" || st === "blocked" ? "unavailable" : "not for sale";
    return {
      id: s.id, x: s.x, y: s.y, color: tier?.color ?? "#a1a1aa", look, access: s.access, clickable: open || isSelected,
      title: [s.label, tier?.name, accessLabel(s.access), what].filter(Boolean).join(" · "),
    };
  });
  const accessUsed = ACCESSIBILITY.filter((a) => seating.seats.some((s) => s.access === a.value));
  const picked = selected.map((id) => seatById.get(id)).filter((s): s is NonNullable<typeof s> => !!s);

  return (
    <div className="grid gap-3">
      <SeatMapCanvas drawing={seating.drawing} seats={seats} onSeat={(id) => toggle(Number(id))} label="Seat map. Choose your seats." maxHeight="min(58vh, 560px)" />

      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-fx-red/85" aria-label="Map key">
        {seating.tiers.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <SeatSwatch look="open" color={t.color} />
            <span>
              <span className="font-semibold">{t.name}</span>{" "}
              {t.status === "on_sale" ? formatCents(t.allInCents, currency) : t.status === "sold_out" ? "sold out" : t.status === "scheduled" ? (t.salesStart ? `on sale ${t.salesStart}` : "on sale soon") : "sales ended"}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-2"><SeatSwatch look="selected" color="#18181b" /> Your seats</li>
        <li className="flex items-center gap-2"><SeatSwatch look="taken" /> Unavailable</li>
        {seating.seats.some((s) => !s.tier) ? <li className="flex items-center gap-2"><SeatSwatch look="off" /> Not for sale</li> : null}
        {accessUsed.map((a) => <li key={a.value} className="flex items-center gap-2"><SeatSwatch look="open" color="#71717a" access={a.value} /> {a.label}</li>)}
      </ul>

      {notice ? <p role="alert" className="rounded-[12px] bg-fx-red-second/10 px-3 py-2 text-[14px] font-semibold text-fx-red-second">{notice}</p> : null}

      {picked.length ? (
        <ul className="grid gap-2" aria-label="Your seats">
          {picked.map((s) => {
            const tier = tierById.get(s.tier!);
            return (
              <li key={s.id} className="flex items-center gap-3 rounded-[14px] border border-fx-red/14 bg-white px-4 py-2">
                <SeatSwatch look="open" color={tier?.color ?? "#a1a1aa"} access={s.access} />
                <span className="min-w-0 flex-1 text-[14px] leading-[1.35]">
                  <span className="font-semibold">{s.label}</span>
                  <span className="block text-[12px] text-fx-red/78">{[tier?.name, accessLabel(s.access)].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="text-[14px] font-semibold tabular-nums">{tier ? formatCents(tier.allInCents, currency) : ""}</span>
                <button type="button" onClick={() => toggle(s.id)} aria-label={`Remove ${s.label}`} className="grid size-8 cursor-pointer place-items-center rounded-full text-fx-red hover:bg-fx-red/8"><XIcon className="size-4" /></button>
                <input type="hidden" name="seat" value={s.id} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-fx-red/78">Tap the seats you want. Use + to zoom in.</p>
      )}
    </div>
  );
}
