"use client";

/*
 * Draws a seat map: shapes (stage, areas, labels), tables, section names and seats, with zoom. Used by the buyer's seat
 * picker, the organizer's Seating tab and the read-only map previews. The map keeps its own light palette in both
 * themes so tier colours always read the same.
 */

import { memo, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { contentBox, SEAT_RADIUS, type Accessibility, type Drawing } from "@/lib/seating/layout";

export type SeatLook = "open" | "selected" | "taken" | "blocked" | "off" | "marked";

export type CanvasSeat = {
  id: number | string; x: number; y: number;
  /** tier colour for open seats */
  color: string;
  look: SeatLook;
  access: Accessibility | null;
  /** read by screen readers and shown on hover */
  title: string;
  clickable: boolean;
};

export const SEAT_COLORS = { taken: "#d4d4d8", blockedFill: "#f4f4f5", blockedStroke: "#a1a1aa", off: "#e4e4e7", selected: "#18181b", marked: "#f59e0b", ink: "#3f3f46" } as const;

const ZOOMS = [1, 1.5, 2, 3, 4];

function SeatShape({ s }: { s: CanvasSeat }) {
  const r = SEAT_RADIUS;
  const fill = s.look === "open" ? s.color : s.look === "selected" ? SEAT_COLORS.selected : s.look === "taken" ? SEAT_COLORS.taken : s.look === "marked" ? s.color : s.look === "blocked" ? SEAT_COLORS.blockedFill : "#ffffff";
  const stroke = s.look === "selected" ? s.color : s.look === "marked" ? SEAT_COLORS.marked : s.look === "blocked" ? SEAT_COLORS.blockedStroke : s.look === "off" ? SEAT_COLORS.off : s.access === "restricted_view" ? SEAT_COLORS.ink : "#ffffff";
  const width = s.look === "selected" || s.look === "marked" ? 3 : s.access === "restricted_view" || s.look === "off" || s.look === "blocked" ? 1.5 : 1;
  const dash = s.access === "restricted_view" ? "2.5 2" : undefined;
  const props = { fill, stroke, strokeWidth: width, strokeDasharray: dash };
  return (
    <>
      {s.access === "wheelchair" ? <rect x={s.x - r} y={s.y - r} width={2 * r} height={2 * r} rx={2.5} {...props} /> : <circle cx={s.x} cy={s.y} r={r} {...props} />}
      {s.access === "companion" ? <circle cx={s.x} cy={s.y} r={2.6} fill="#ffffff" pointerEvents="none" /> : null}
      {s.look === "blocked" ? <path d={`M${s.x - 4} ${s.y - 4}L${s.x + 4} ${s.y + 4}M${s.x + 4} ${s.y - 4}L${s.x - 4} ${s.y + 4}`} stroke={SEAT_COLORS.blockedStroke} strokeWidth={1.5} pointerEvents="none" /> : null}
      {s.look === "selected" ? <path d={`M${s.x - 3.5} ${s.y}l2.5 2.5l4.5 -5`} stroke="#ffffff" strokeWidth={1.8} fill="none" pointerEvents="none" /> : null}
    </>
  );
}

const Seats = memo(function Seats({ seats, onSeat }: { seats: CanvasSeat[]; onSeat?: (id: CanvasSeat["id"], e: MouseEvent | KeyboardEvent) => void }) {
  return (
    <g>
      {seats.map((s) => s.clickable && onSeat ? (
        <g
          key={s.id} role="button" tabIndex={0} aria-label={s.title} aria-pressed={s.look === "selected" || s.look === "marked"} className="cursor-pointer outline-none focus-visible:[&>*:first-child]:stroke-sky-500"
          onClick={(e) => onSeat(s.id, e)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSeat(s.id, e); } }}
        >
          <title>{s.title}</title>
          <SeatShape s={s} />
        </g>
      ) : (
        <g key={s.id} aria-hidden="true"><title>{s.title}</title><SeatShape s={s} /></g>
      ))}
    </g>
  );
});

export function SeatMapCanvas({ drawing, seats, onSeat, onLabel, label, footer, maxHeight = "min(70vh, 640px)", background }: {
  drawing: Drawing; seats: CanvasSeat[];
  onSeat?: (id: CanvasSeat["id"], e: MouseEvent | KeyboardEvent) => void;
  /** clicking a section name (organizer: select the whole section) */
  onLabel?: (text: string, e: MouseEvent) => void;
  label: string; footer?: ReactNode; maxHeight?: string;
  /** an image under everything (the staff builder's floor plan) */
  background?: { href: string; opacity: number; box: { x: number; y: number; w: number; h: number } } | null;
}) {
  const [zoom, setZoom] = useState(0);
  const box = useMemo(() => contentBox(seats, drawing.shapes), [seats, drawing.shapes]);
  const z = ZOOMS[zoom];
  return (
    <div className="relative rounded-[18px] border border-zinc-200 bg-white">
      <div className="absolute top-2 right-2 z-10 flex gap-1 rounded-full border border-zinc-200 bg-white/95 p-1 shadow-sm">
        <button type="button" onClick={() => setZoom((v) => Math.max(0, v - 1))} disabled={zoom === 0} aria-label="Zoom out" className="grid size-8 cursor-pointer place-items-center rounded-full text-zinc-700 hover:bg-zinc-100 disabled:opacity-35"><MinusIcon className="size-4" /></button>
        <button type="button" onClick={() => setZoom(0)} disabled={zoom === 0} aria-label="Fit the whole map" className="grid size-8 cursor-pointer place-items-center rounded-full text-zinc-700 hover:bg-zinc-100 disabled:opacity-35"><ScanIcon className="size-4" /></button>
        <button type="button" onClick={() => setZoom((v) => Math.min(ZOOMS.length - 1, v + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in" className="grid size-8 cursor-pointer place-items-center rounded-full text-zinc-700 hover:bg-zinc-100 disabled:opacity-35"><PlusIcon className="size-4" /></button>
      </div>
      <div className="overflow-auto overscroll-contain rounded-[18px]" style={{ maxHeight }}>
        <svg role="group" aria-label={label} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} style={{ width: `${z * 100}%`, minWidth: z > 1 ? `${Math.round(box.w * z * 0.6)}px` : undefined }} className="block h-auto select-none">
          {background ? <image href={background.href} x={background.box.x} y={background.box.y} width={background.box.w} height={background.box.h} opacity={background.opacity} preserveAspectRatio="xMidYMid meet" /> : null}
          {drawing.shapes.map((s) => s.kind === "label" ? (
            <text key={s.id} x={s.x + s.w / 2} y={s.y + s.h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={600} fill={SEAT_COLORS.ink}>{s.text}</text>
          ) : (
            <g key={s.id}>
              <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.kind === "stage" ? 6 : 10} fill={s.kind === "stage" ? "#27272a" : "#fef3c7"} stroke={s.kind === "stage" ? "none" : "#f59e0b"} strokeDasharray={s.kind === "area" ? "6 4" : undefined} />
              {s.text ? <text x={s.x + s.w / 2} y={s.y + s.h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={700} letterSpacing=".08em" fill={s.kind === "stage" ? "#fafafa" : "#92400e"}>{s.text.toUpperCase()}</text> : null}
            </g>
          ))}
          {drawing.tables.map((t, i) => t.shape === "round"
            ? <circle key={i} cx={t.x} cy={t.y} r={t.r} fill="#f4f4f5" stroke="#d4d4d8" />
            : <rect key={i} x={t.x - t.w} y={t.y - t.h} width={2 * t.w} height={2 * t.h} rx={4} fill="#f4f4f5" stroke="#d4d4d8" transform={t.rotation ? `rotate(${t.rotation} ${t.x} ${t.y})` : undefined} />)}
          {drawing.labels.map((l, i) => onLabel ? (
            <text key={i} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={600} fill="#52525b" className="cursor-pointer hover:fill-zinc-900" onClick={(e) => onLabel(l.text, e)}>{l.text}</text>
          ) : (
            <text key={i} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={600} fill="#52525b" aria-hidden="true">{l.text}</text>
          ))}
          <Seats seats={seats} onSeat={onSeat} />
        </svg>
      </div>
      {footer}
    </div>
  );
}

/** Legend swatch drawn like the seat it explains. */
export function SeatSwatch({ look, color = "#a1a1aa", access = null }: { look: SeatLook; color?: string; access?: Accessibility | null }) {
  const s: CanvasSeat = { id: 0, x: 11, y: 11, color, look, access, title: "", clickable: false };
  return <svg viewBox="0 0 22 22" className="size-[18px] shrink-0" aria-hidden="true"><SeatShape s={s} /></svg>;
}
