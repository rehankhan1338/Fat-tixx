"use client";

/*
 * Draws a seat map: shapes (stage, areas, labels), tables, section names and seats, with zoom. Used by the buyer's seat
 * picker, the organizer's Seating tab and the read-only map previews. The map keeps its own light palette in both
 * themes so tier colours always read the same.
 */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { contentBox, SEAT_RADIUS, type Accessibility, type Drawing } from "@/lib/seating/layout";
import { boxMode, isDrag, pointsInRect, type Rect, type SelectMode } from "@/lib/seating/selection";

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

const Seats = memo(function Seats({ seats, onSeat, onSeatDoubleClick }: { seats: CanvasSeat[]; onSeat?: (id: CanvasSeat["id"], e: MouseEvent | KeyboardEvent) => void; onSeatDoubleClick?: (id: CanvasSeat["id"]) => void }) {
  return (
    <g>
      {seats.map((s) => s.clickable && onSeat ? (
        <g
          key={s.id} role="button" tabIndex={0} aria-label={s.title} aria-pressed={s.look === "selected" || s.look === "marked"} className="cursor-pointer outline-none focus-visible:[&>*:first-child]:stroke-sky-500"
          onClick={(e) => onSeat(s.id, e)} onDoubleClick={onSeatDoubleClick ? () => onSeatDoubleClick(s.id) : undefined} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSeat(s.id, e); } }}
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

export function SeatMapCanvas({ drawing, seats, onSeat, onSeatDoubleClick, onBoxSelect, onLabel, label, footer, maxHeight = "min(70vh, 640px)", background }: {
  drawing: Drawing; seats: CanvasSeat[];
  onSeat?: (id: CanvasSeat["id"], e: MouseEvent | KeyboardEvent) => void;
  /** double-click on a seat (organizer: select its row) */
  onSeatDoubleClick?: (id: CanvasSeat["id"]) => void;
  /** dragging a box with the mouse over clickable seats (Shift/Ctrl: add, Alt: remove, plain: replace) */
  onBoxSelect?: (ids: CanvasSeat["id"][], mode: SelectMode) => void;
  /** clicking a section name (organizer: select the whole section) */
  onLabel?: (text: string, e: MouseEvent) => void;
  label: string; footer?: ReactNode; maxHeight?: string;
  /** an image under everything (the staff builder's floor plan) */
  background?: { href: string; opacity: number; box: { x: number; y: number; w: number; h: number } } | null;
}) {
  const [zoom, setZoom] = useState(0);
  const box = useMemo(() => contentBox(seats, drawing.shapes), [seats, drawing.shapes]);
  const z = ZOOMS[zoom];
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ w: number; h: number } | null>(null);
  // The point in the middle of the view while zooming, so a zoom keeps looking at the same seats.
  const focus = useRef<{ x: number; y: number } | null>(null);

  // The window's size comes from CSS alone, so offsetWidth/Height don't change when scrollbars appear.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current, f = focus.current;
    if (!el || !f) return;
    focus.current = null;
    el.scrollTo(f.x * el.scrollWidth - el.clientWidth / 2, f.y * el.scrollHeight - el.clientHeight / 2);
  }, [zoom]);

  // Box selection with a mouse or pen (touch keeps scrolling the map). The pointer is only captured once it has moved,
  // so a plain click still reaches the seat; the click that ends a drag is swallowed.
  const svgRef = useRef<SVGSVGElement>(null);
  const press = useRef<{ pointerId: number; sx: number; sy: number; x: number; y: number; mode: SelectMode; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const [marquee, setMarquee] = useState<(Rect & { mode: SelectMode }) | null>(null);
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const m = svgRef.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const boxDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!onBoxSelect || e.pointerType === "touch" || e.button !== 0) return;
    const p = toSvg(e);
    press.current = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, x: p.x, y: p.y, mode: boxMode(e), moved: false };
  };
  const boxMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pr = press.current;
    if (!pr || pr.pointerId !== e.pointerId) return;
    if (!pr.moved) {
      if (!isDrag(e.clientX - pr.sx, e.clientY - pr.sy)) return;
      pr.moved = true;
      svgRef.current?.setPointerCapture?.(e.pointerId);
      // A box drag must not select the page's text.
      window.getSelection()?.removeAllRanges();
      document.body.style.userSelect = "none";
    }
    const p = toSvg(e);
    setMarquee({ x0: pr.x, y0: pr.y, x1: p.x, y1: p.y, mode: pr.mode });
  };
  const boxUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const pr = press.current;
    press.current = null;
    if (!pr || !pr.moved || !onBoxSelect) return;
    document.body.style.userSelect = "";
    window.getSelection()?.removeAllRanges();
    const p = toSvg(e);
    const hits = pointsInRect(seats.filter((s) => s.clickable), { x0: pr.x, y0: pr.y, x1: p.x, y1: p.y }, SEAT_RADIUS * 0.6);
    setMarquee(null);
    swallowClick.current = true;
    window.setTimeout(() => { swallowClick.current = false; }, 0);
    onBoxSelect(hits.map((s) => s.id), pr.mode);
  };
  const seatClick = onSeat ? (id: CanvasSeat["id"], ev: MouseEvent | KeyboardEvent) => { if (!swallowClick.current) onSeat(id, ev); } : undefined;

  const zoomTo = (next: number) => {
    const el = scroller.current;
    if (el) focus.current = { x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight };
    setZoom(next);
  };

  // Zoom 1 shows the whole map in the window, however tall it is. Zooming in never drops below a tappable seat size.
  const fit = view && view.w > 0 && view.h > 0 ? Math.min(view.w / box.w, view.h / box.h) : null;
  const scale = fit === null ? null : z > 1 ? Math.max(fit * z, z * 0.6) : fit;
  const size = scale === null ? { width: "100%", height: "100%" } : { width: Math.floor(box.w * scale), height: Math.floor(box.h * scale) };
  return (
    <div className="relative rounded-[18px] border border-zinc-200 bg-white">
      <div className="absolute top-2 right-2 z-10 flex gap-1 rounded-full border border-zinc-200 bg-white/95 p-1 shadow-sm">
        <button type="button" onClick={() => zoomTo(Math.max(0, zoom - 1))} disabled={zoom === 0} aria-label="Zoom out" className="grid size-8 cursor-pointer place-items-center rounded-full text-zinc-700 hover:bg-zinc-100 disabled:opacity-35"><MinusIcon className="size-4" /></button>
        <button type="button" onClick={() => zoomTo(0)} disabled={zoom === 0} aria-label="Fit the whole map" className="grid size-8 cursor-pointer place-items-center rounded-full text-zinc-700 hover:bg-zinc-100 disabled:opacity-35"><ScanIcon className="size-4" /></button>
        <button type="button" onClick={() => zoomTo(Math.min(ZOOMS.length - 1, zoom + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in" className="grid size-8 cursor-pointer place-items-center rounded-full text-zinc-700 hover:bg-zinc-100 disabled:opacity-35"><PlusIcon className="size-4" /></button>
      </div>
      <div ref={scroller} className="flex w-full overflow-auto overscroll-contain rounded-[18px]" style={{ maxHeight, aspectRatio: `${box.w} / ${box.h}` }}>
        <svg ref={svgRef} role="group" aria-label={label} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} style={size} className="m-auto block shrink-0 select-none"
          onPointerDown={boxDown} onPointerMove={boxMove} onPointerUp={boxUp} onPointerCancel={() => { press.current = null; setMarquee(null); document.body.style.userSelect = ""; }}>
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
          <Seats seats={seats} onSeat={seatClick} onSeatDoubleClick={onSeatDoubleClick} />
          {marquee ? (
            <rect x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)} width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)}
              fill={marquee.mode === "remove" ? "rgba(239,68,68,0.08)" : "rgba(14,165,233,0.1)"} stroke={marquee.mode === "remove" ? "#ef4444" : "#0284c7"} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ) : null}
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
