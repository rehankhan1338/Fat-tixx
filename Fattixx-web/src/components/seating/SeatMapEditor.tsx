"use client";

/*
 * The seat map builder (Fattixx staff only, Admin → Seat maps). Staff trace the venue's floor plan: add blocks of
 * numbered rows and tables, drag them into place, take out seats for aisles, mark accessible seats, and add the stage,
 * standing areas and labels. Nothing is stored until Save; the server validates the layout and writes the list of
 * changes to the map's history (src/lib/seating/layout.ts diffLayouts).
 */

import { useActionState, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, Redo2Icon, SaveIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { saveSeatMapLayout } from "@/lib/seating/actions";
import {
  ACCESSIBILITY, SEAT_RADIUS, newId, newRowsSection, newTableSection, sectionSeats, seatCount, tableHalfSize,
  type Accessibility, type RowsSection, type SeatMapLayout, type Section, type Shape, type TableSection,
} from "@/lib/seating/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";

type Selected = { kind: "section" | "shape"; id: string } | null;
type History = { past: SeatMapLayout[]; present: SeatMapLayout; future: SeatMapLayout[]; key: string | null };

const GRID = 5;
const snap = (n: number) => Math.round(n / GRID) * GRID;

function Num({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number }) {
  const id = `ed-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type="number" inputMode="decimal" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }} className="h-8" />
    </div>
  );
}

function Text({ label, value, onChange, maxLength = 60 }: { label: string; value: string; onChange: (s: string) => void; maxLength?: number }) {
  const id = `ed-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} className="h-8" />
    </div>
  );
}

export function SeatMapEditor({ requestId, mapName, initial, editable, floorPlanUrl }: {
  requestId: number; mapName: string; initial: SeatMapLayout; editable: boolean; floorPlanUrl: string | null;
}) {
  const [h, setH] = useState<History>({ past: [], present: initial, future: [], key: null });
  const [saved, setSaved] = useState<SeatMapLayout>(initial);
  const [sel, setSel] = useState<Selected>(null);
  const [seatSel, setSeatSel] = useState<Set<string>>(new Set());
  const [name, setName] = useState(mapName);
  const [planOpacity, setPlanOpacity] = useState(floorPlanUrl ? 0.35 : 0);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ id: string; kind: "section" | "shape"; dx: number; dy: number; startX: number; startY: number; ox: number; oy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const layout = h.present;

  const [state, action] = useActionState(saveSeatMapLayout, undefined);
  const lastSaved = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.error) toast.error(state.error);
    else if (state?.ok && state.saved && state.saved !== lastSaved.current) { lastSaved.current = state.saved; toast.success(state.message ?? "Saved"); setSaved(layout); }
    else if (state?.ok && state.message && !state.saved) toast.message(state.message);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(layout) || name !== mapName, [saved, layout, name, mapName]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Change the layout. Edits with the same `key` in a row (typing in one field) are one undo step. */
  const update = (fn: (l: SeatMapLayout) => SeatMapLayout, key: string | null = null) => {
    if (!editable) return;
    setH((cur) => {
      const next = fn(cur.present);
      if (key && key === cur.key) return { ...cur, present: next };
      return { past: [...cur.past.slice(-80), cur.present], present: next, future: [], key };
    });
  };
  const undo = () => setH((c) => (c.past.length ? { past: c.past.slice(0, -1), present: c.past[c.past.length - 1], future: [c.present, ...c.future], key: null } : c));
  const redo = () => setH((c) => (c.future.length ? { past: [...c.past, c.present], present: c.future[0], future: c.future.slice(1), key: null } : c));

  const section = sel?.kind === "section" ? layout.sections.find((s) => s.id === sel.id) ?? null : null;
  const shape = sel?.kind === "shape" ? layout.shapes.find((s) => s.id === sel.id) ?? null : null;
  const setSection = (id: string, patch: Partial<RowsSection> | Partial<TableSection>, key?: string) =>
    update((l) => ({ ...l, sections: l.sections.map((s) => (s.id === id ? ({ ...s, ...patch } as Section) : s)) }), key ?? `${id}:${Object.keys(patch).join(",")}`);
  const setShape = (id: string, patch: Partial<Shape>, key?: string) =>
    update((l) => ({ ...l, shapes: l.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), key ?? `${id}:${Object.keys(patch).join(",")}`);

  const uniqueName = (base: string) => {
    const names = new Set(layout.sections.map((s) => s.name.toLowerCase()));
    if (!names.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  };
  const centre = () => ({ x: snap(layout.width / 2), y: snap(layout.height / 3) });
  const addSection = (s: Section) => { update((l) => ({ ...l, sections: [...l.sections, s] })); setSel({ kind: "section", id: s.id }); setSeatSel(new Set()); };
  const addShape = (kind: Shape["kind"]) => {
    const s: Shape = { id: newId(), kind, x: snap(layout.width / 2 - 150), y: kind === "stage" ? 30 : snap(layout.height / 2), w: kind === "label" ? 160 : 300, h: kind === "label" ? 30 : kind === "stage" ? 60 : 120, text: kind === "stage" ? "Stage" : kind === "area" ? "Standing" : "Label" };
    update((l) => ({ ...l, shapes: [...l.shapes, s] }));
    setSel({ kind: "shape", id: s.id });
  };
  const remove = () => {
    if (!sel) return;
    update((l) => (sel.kind === "section" ? { ...l, sections: l.sections.filter((s) => s.id !== sel.id) } : { ...l, shapes: l.shapes.filter((s) => s.id !== sel.id) }));
    setSel(null); setSeatSel(new Set());
  };
  const duplicate = () => {
    if (!section) return;
    const copy = { ...section, id: newId(), name: uniqueName(section.name), x: section.x + 40, y: section.y + 40, removed: [...section.removed], access: { ...section.access } } as Section;
    addSection(copy);
  };
  const reorder = (dir: -1 | 1) => {
    if (!section) return;
    update((l) => {
      const i = l.sections.findIndex((s) => s.id === section.id), j = i + dir;
      if (j < 0 || j >= l.sections.length) return l;
      const sections = [...l.sections];
      [sections[i], sections[j]] = [sections[j], sections[i]];
      return { ...l, sections };
    });
  };

  // Seat-level edits on the selected section
  const seatAction = (op: "remove" | "restore" | Accessibility | "clear") => {
    if (!section || !seatSel.size) return;
    const keys = [...seatSel];
    update((l) => ({
      ...l, sections: l.sections.map((s) => {
        if (s.id !== section.id) return s;
        if (op === "remove") return { ...s, removed: [...new Set([...s.removed, ...keys])] } as Section;
        if (op === "restore") return { ...s, removed: s.removed.filter((k) => !seatSel.has(k)) } as Section;
        const access = { ...s.access };
        for (const k of keys) { if (op === "clear") delete access[k]; else access[k] = op; }
        return { ...s, access } as Section;
      }),
    }));
    setSeatSel(new Set());
  };

  // Dragging sections and shapes, in canvas units
  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const startDrag = (e: ReactPointerEvent, kind: "section" | "shape", id: string, ox: number, oy: number) => {
    e.stopPropagation();
    setSel({ kind, id });
    if (sel?.id !== id) setSeatSel(new Set());
    if (!editable) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toCanvas(e);
    setDrag({ id, kind, dx: 0, dy: 0, startX: p.x, startY: p.y, ox, oy });
  };
  const moveDrag = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = toCanvas(e);
    setDrag({ ...drag, dx: snap(p.x - drag.startX), dy: snap(p.y - drag.startY) });
  };
  const endDrag = () => {
    if (!drag) return;
    if (drag.dx || drag.dy) {
      const x = drag.ox + drag.dx, y = drag.oy + drag.dy;
      if (drag.kind === "section") setSection(drag.id, { x, y }, `drag:${Date.now()}`);
      else setShape(drag.id, { x, y }, `drag:${Date.now()}`);
    }
    setDrag(null);
  };
  const offset = (kind: "section" | "shape", id: string) => (drag && drag.kind === kind && drag.id === id ? { dx: drag.dx, dy: drag.dy } : { dx: 0, dy: 0 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (e.key === "Escape") { setSel(null); setSeatSel(new Set()); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const total = seatCount(layout);

  return (
    <div className="grid gap-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-end gap-2">
        {editable ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => addSection(newRowsSection({ ...centre(), name: uniqueName("Section") }))}>+ Rows</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => addSection(newTableSection({ ...centre(), name: uniqueName("Table 1") }))}>+ Table</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => addShape("stage")}>+ Stage</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => addShape("area")}>+ Area</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => addShape("label")}>+ Label</Button>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
            <Button type="button" size="icon-sm" variant="ghost" onClick={undo} disabled={!h.past.length} aria-label="Undo"><Undo2Icon /></Button>
            <Button type="button" size="icon-sm" variant="ghost" onClick={redo} disabled={!h.future.length} aria-label="Redo"><Redo2Icon /></Button>
          </>
        ) : <Badge variant="outline">Read only</Badge>}
        <div className="ml-auto flex flex-wrap items-end gap-3">
          {floorPlanUrl ? (
            <label className="grid gap-1 text-xs">Floor plan
              <input type="range" min={0} max={1} step={0.05} value={planOpacity} onChange={(e) => setPlanOpacity(Number(e.target.value))} className="w-28" />
            </label>
          ) : null}
          <label className="grid gap-1 text-xs">Zoom
            <NativeSelect value={String(zoom)} onChange={(e) => setZoom(Number(e.target.value))} className="h-8">
              {[0.5, 0.75, 1, 1.5, 2, 3].map((z) => <NativeSelectOption key={z} value={String(z)}>{z * 100}%</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <Badge variant="secondary" className="h-8">{total.toLocaleString("en-US")} seats</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* canvas */}
        <div className="overflow-auto rounded-xl border bg-white" style={{ maxHeight: "75vh" }}>
          <svg
            ref={svgRef} viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ width: layout.width * zoom, height: layout.height * zoom }} className="block touch-none select-none"
            onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDown={() => { setSel(null); setSeatSel(new Set()); }}
            role="application" aria-label="Seat map builder canvas"
          >
            <defs>
              <pattern id="grid" width={50} height={50} patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#f4f4f5" strokeWidth={1} /></pattern>
            </defs>
            <rect width={layout.width} height={layout.height} fill="url(#grid)" />
            {floorPlanUrl && planOpacity > 0 ? <image href={floorPlanUrl} x={0} y={0} width={layout.width} height={layout.height} opacity={planOpacity} preserveAspectRatio="xMidYMid meet" pointerEvents="none" /> : null}
            {layout.shapes.map((s) => {
              const o = offset("shape", s.id);
              const active = sel?.kind === "shape" && sel.id === s.id;
              return (
                <g key={s.id} transform={`translate(${o.dx} ${o.dy})`} onPointerDown={(e) => startDrag(e, "shape", s.id, s.x, s.y)} className={editable ? "cursor-move" : "cursor-pointer"}>
                  {s.kind === "label" ? (
                    <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={active ? "#e0f2fe" : "transparent"} stroke={active ? "#0284c7" : "#d4d4d8"} strokeDasharray="4 3" />
                  ) : (
                    <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.kind === "stage" ? 6 : 10} fill={s.kind === "stage" ? "#27272a" : "#fef3c7"} stroke={active ? "#0284c7" : s.kind === "area" ? "#f59e0b" : "none"} strokeWidth={active ? 3 : 1} strokeDasharray={s.kind === "area" ? "6 4" : undefined} />
                  )}
                  <text x={s.x + s.w / 2} y={s.y + s.h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={700} fill={s.kind === "stage" ? "#fafafa" : s.kind === "area" ? "#92400e" : "#3f3f46"} pointerEvents="none">{s.text}</text>
                </g>
              );
            })}
            {layout.sections.map((sec) => {
              const o = offset("section", sec.id);
              const active = sel?.kind === "section" && sel.id === sec.id;
              const seats = sectionSeats(sec, true);
              const half = sec.kind === "table" ? tableHalfSize(sec) : null;
              const minY = Math.min(...seats.map((s) => s.y), sec.y);
              return (
                <g key={sec.id} transform={`translate(${o.dx} ${o.dy})`} onPointerDown={(e) => startDrag(e, "section", sec.id, sec.x, sec.y)} className={editable ? "cursor-move" : "cursor-pointer"}>
                  {half && sec.kind === "table" ? (sec.shape === "round"
                    ? <circle cx={sec.x} cy={sec.y} r={half.r} fill="#f4f4f5" stroke={active ? "#0284c7" : "#d4d4d8"} strokeWidth={active ? 2 : 1} />
                    : <rect x={sec.x - half.w} y={sec.y - half.h} width={2 * half.w} height={2 * half.h} rx={4} fill="#f4f4f5" stroke={active ? "#0284c7" : "#d4d4d8"} transform={sec.rotation ? `rotate(${sec.rotation} ${sec.x} ${sec.y})` : undefined} />) : null}
                  <text x={sec.kind === "table" ? sec.x : seats.reduce((n, s) => n + s.x, 0) / Math.max(1, seats.length)} y={sec.kind === "table" ? sec.y : minY - SEAT_RADIUS - 10} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={600} fill={active ? "#0369a1" : "#52525b"}>{sec.name}</text>
                  {seats.map((s) => {
                    const picked = active && seatSel.has(s.local);
                    const fill = s.removed ? "transparent" : s.access === "wheelchair" ? "#2563eb" : s.access === "companion" ? "#60a5fa" : s.access === "restricted_view" ? "#a1a1aa" : active ? "#0ea5e9" : "#71717a";
                    return (
                      <g key={s.key} onPointerDown={(e) => {
                        if (!active || !editable) return;
                        e.stopPropagation();
                        setSeatSel((cur) => { const n = new Set(cur); if (n.has(s.local)) n.delete(s.local); else n.add(s.local); return n; });
                      }}>
                        <title>{`${s.label}${s.removed ? " (taken out)" : ""}${s.access ? ` · ${ACCESSIBILITY.find((a) => a.value === s.access)?.label}` : ""}`}</title>
                        {s.access === "wheelchair"
                          ? <rect x={s.x - SEAT_RADIUS} y={s.y - SEAT_RADIUS} width={2 * SEAT_RADIUS} height={2 * SEAT_RADIUS} rx={2} fill={fill} stroke={picked ? "#f59e0b" : s.removed ? "#d4d4d8" : "none"} strokeWidth={picked ? 3 : 1} strokeDasharray={s.removed ? "2 2" : undefined} />
                          : <circle cx={s.x} cy={s.y} r={SEAT_RADIUS} fill={fill} stroke={picked ? "#f59e0b" : s.removed ? "#d4d4d8" : "none"} strokeWidth={picked ? 3 : 1} strokeDasharray={s.removed ? "2 2" : undefined} />}
                        {zoom >= 1 && !s.removed ? <text x={s.x} y={s.y} textAnchor="middle" dominantBaseline="central" fontSize={7} fill="#ffffff" pointerEvents="none">{s.number}</text> : null}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>

        {/* side panel */}
        <div className="grid content-start gap-4 text-sm">
          <form action={action} className="grid gap-2 rounded-xl border p-3">
            <input type="hidden" name="request_id" value={requestId} />
            <input type="hidden" name="layout" value={JSON.stringify(layout)} />
            <Text label="Map name" value={name} onChange={setName} maxLength={160} />
            <input type="hidden" name="name" value={name} />
            <div className="grid grid-cols-2 gap-2">
              <Num label="Canvas width" value={layout.width} min={200} max={6000} step={50} onChange={(n) => update((l) => ({ ...l, width: n }), "canvas-w")} />
              <Num label="Canvas height" value={layout.height} min={200} max={6000} step={50} onChange={(n) => update((l) => ({ ...l, height: n }), "canvas-h")} />
            </div>
            {editable ? <Button type="submit" disabled={!dirty}><SaveIcon /> {dirty ? "Save changes" : "Saved"}</Button> : null}
            <p className="text-xs text-muted-foreground">Every save is listed in the change history below. Ctrl+Z / Ctrl+Y undo and redo.</p>
          </form>

          {section ? (
            <div className="grid gap-3 rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{section.kind === "table" ? "Table" : "Rows"}: {section.name}</p>
                {editable ? (
                  <div className="flex gap-1">
                    <Button type="button" size="icon-xs" variant="ghost" onClick={() => reorder(-1)} aria-label="Offer earlier (better seats)"><ArrowUpIcon /></Button>
                    <Button type="button" size="icon-xs" variant="ghost" onClick={() => reorder(1)} aria-label="Offer later"><ArrowDownIcon /></Button>
                    <Button type="button" size="icon-xs" variant="ghost" onClick={duplicate} aria-label="Duplicate"><CopyIcon /></Button>
                    <Button type="button" size="icon-xs" variant="ghost" onClick={remove} aria-label="Delete"><Trash2Icon /></Button>
                  </div>
                ) : null}
              </div>
              <fieldset disabled={!editable} className="grid gap-2">
                <Text label="Name" value={section.name} onChange={(v) => setSection(section.id, { name: v })} />
                {section.kind === "rows" ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Num label="Rows" value={section.rows} min={1} max={100} onChange={(n) => setSection(section.id, { rows: n })} />
                      <Num label="Seats per row" value={section.seatsPerRow} min={1} max={200} onChange={(n) => setSection(section.id, { seatsPerRow: n })} />
                      <Text label="First row" value={section.firstRow} maxLength={3} onChange={(v) => setSection(section.id, { firstRow: v.toUpperCase() })} />
                      <Num label="First seat number" value={section.firstSeat} min={0} max={999} onChange={(n) => setSection(section.id, { firstSeat: n })} />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="ed-numbering" className="text-xs">Seat numbers</Label>
                      <NativeSelect id="ed-numbering" value={section.numbering} onChange={(e) => setSection(section.id, { numbering: e.target.value as RowsSection["numbering"] })} className="h-8">
                        <NativeSelectOption value="ltr">Rise left to right</NativeSelectOption>
                        <NativeSelectOption value="rtl">Rise right to left</NativeSelectOption>
                      </NativeSelect>
                    </div>
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={section.skipIO} onChange={(e) => setSection(section.id, { skipIO: e.target.checked })} /> Skip rows I and O</label>
                    <div className="grid grid-cols-2 gap-2">
                      <Num label="Seat spacing" value={section.seatSpacing} min={12} max={80} onChange={(n) => setSection(section.id, { seatSpacing: n })} />
                      <Num label="Row spacing" value={section.rowSpacing} min={12} max={120} onChange={(n) => setSection(section.id, { rowSpacing: n })} />
                      <Num label="Curve" value={section.curve} min={-300} max={300} step={5} onChange={(n) => setSection(section.id, { curve: n })} />
                      <Num label="Rotation (°)" value={section.rotation} min={-180} max={180} step={5} onChange={(n) => setSection(section.id, { rotation: n })} />
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Num label="Seats" value={section.seats} min={1} max={30} onChange={(n) => setSection(section.id, { seats: n })} />
                    <div className="grid gap-1">
                      <Label htmlFor="ed-shape" className="text-xs">Shape</Label>
                      <NativeSelect id="ed-shape" value={section.shape} onChange={(e) => setSection(section.id, { shape: e.target.value as TableSection["shape"] })} className="h-8">
                        <NativeSelectOption value="round">Round</NativeSelectOption>
                        <NativeSelectOption value="rect">Long</NativeSelectOption>
                      </NativeSelect>
                    </div>
                    <Num label="Seat spacing" value={section.seatSpacing} min={12} max={80} onChange={(n) => setSection(section.id, { seatSpacing: n })} />
                    <Num label="Rotation (°)" value={section.rotation} min={-180} max={180} step={5} onChange={(n) => setSection(section.id, { rotation: n })} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Num label="X" value={section.x} step={5} onChange={(n) => setSection(section.id, { x: n })} />
                  <Num label="Y" value={section.y} step={5} onChange={(n) => setSection(section.id, { y: n })} />
                </div>
              </fieldset>
              {editable ? (
                <div className="grid gap-2 border-t pt-3">
                  <p className="text-xs text-muted-foreground">{seatSel.size ? `${seatSel.size} seat${seatSel.size === 1 ? "" : "s"} selected` : "Click seats of this section to select them."}</p>
                  <div className="flex flex-wrap gap-1">
                    <Button type="button" size="xs" variant="outline" disabled={!seatSel.size} onClick={() => seatAction("remove")}>Take out</Button>
                    <Button type="button" size="xs" variant="outline" disabled={!seatSel.size} onClick={() => seatAction("restore")}>Put back</Button>
                    {ACCESSIBILITY.map((a) => <Button key={a.value} type="button" size="xs" variant="outline" disabled={!seatSel.size} onClick={() => seatAction(a.value)}>{a.label}</Button>)}
                    <Button type="button" size="xs" variant="ghost" disabled={!seatSel.size} onClick={() => seatAction("clear")}>Clear mark</Button>
                    <Button type="button" size="xs" variant="ghost" onClick={() => setSeatSel(new Set(sectionSeats(section, true).map((s) => s.local)))}>Select all</Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : shape ? (
            <div className="grid gap-3 rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold capitalize">{shape.kind}</p>
                {editable ? <Button type="button" size="icon-xs" variant="ghost" onClick={remove} aria-label="Delete"><Trash2Icon /></Button> : null}
              </div>
              <fieldset disabled={!editable} className="grid gap-2">
                <Text label="Text" value={shape.text} onChange={(v) => setShape(shape.id, { text: v })} />
                <div className="grid gap-1">
                  <Label htmlFor="ed-kind" className="text-xs">Kind</Label>
                  <NativeSelect id="ed-kind" value={shape.kind} onChange={(e) => setShape(shape.id, { kind: e.target.value as Shape["kind"] })} className="h-8">
                    <NativeSelectOption value="stage">Stage</NativeSelectOption>
                    <NativeSelectOption value="area">Area (standing, bar…)</NativeSelectOption>
                    <NativeSelectOption value="label">Label</NativeSelectOption>
                  </NativeSelect>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Num label="X" value={shape.x} step={5} onChange={(n) => setShape(shape.id, { x: n })} />
                  <Num label="Y" value={shape.y} step={5} onChange={(n) => setShape(shape.id, { y: n })} />
                  <Num label="Width" value={shape.w} min={10} step={5} onChange={(n) => setShape(shape.id, { w: n })} />
                  <Num label="Height" value={shape.h} min={10} step={5} onChange={(n) => setShape(shape.id, { h: n })} />
                </div>
              </fieldset>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">Select a section, table or shape on the canvas (or in the list below) to edit it. Drag to move.</p>
          )}

          <div className="grid gap-1 rounded-xl border p-3">
            <p className="text-xs font-semibold text-muted-foreground">Sections, best seats first</p>
            {layout.sections.length ? (
              <ol className="grid gap-0.5">
                {layout.sections.map((s, i) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => { setSel({ kind: "section", id: s.id }); setSeatSel(new Set()); }} className={`flex w-full justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent ${sel?.id === s.id ? "bg-accent font-semibold" : ""}`}>
                      <span>{i + 1}. {s.name}</span><span className="text-muted-foreground">{sectionSeats(s).length}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : <p className="text-xs text-muted-foreground">None yet. Add rows or tables.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
