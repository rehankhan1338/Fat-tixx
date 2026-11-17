"use client";

/*
 * The seat map builder (Fattixx staff only, Admin → Seat maps). Staff trace the venue's floor plan: add blocks of
 * numbered rows and tables, drag them into place, take out seats for aisles, mark accessible seats, and add the stage,
 * standing areas and labels. Save validates the layout on the server and writes the list of changes to the map's
 * history (src/lib/seating/layout.ts diffLayouts).
 *
 * Seats are selected with the shared shortcuts (src/lib/seating/selection.ts): drag a box, Shift+click a range,
 * Ctrl/⌘+click one seat, double-click or Alt+click a row. The selection can span sections.
 *
 * Nothing is lost between saves: every change is kept in this browser (localStorage) at once, and autosaved to the
 * server every AUTOSAVE_MS (seat_maps.draft_layout, migration 0020). Autosaving also keeps the session from idling out.
 * On the next visit the newest unsaved copy is restored, with a way to discard it.
 */

import { useActionState, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, KeyboardIcon, Redo2Icon, SaveIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { autosaveSeatMapLayout, saveSeatMapLayout } from "@/lib/seating/actions";
import {
  ACCESSIBILITY, SEAT_RADIUS, newId, newRowsSection, newTableSection, sectionSeats, seatCount, tableHalfSize,
  type Accessibility, type RowsSection, type SeatMapLayout, type Section, type Shape, type TableSection,
} from "@/lib/seating/layout";
import { applySelection, boxMode, isDrag, pointsInRect, rangeBetween, type Rect, type SelectMode } from "@/lib/seating/selection";
import { useKeepAlive } from "@/hooks/use-keep-alive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";

type Selected = { kind: "section" | "shape"; id: string } | null;
type History = { past: SeatMapLayout[]; present: SeatMapLayout; future: SeatMapLayout[]; key: string | null };
/** What the builder saves to: a request's draft map, or a map a Super Admin started without a request. */
export type BuilderTarget = { request_id: number } | { map_id: number };
type Draft = { layout: SeatMapLayout; name: string; at: number };

const GRID = 5;
const snap = (n: number) => Math.round(n / GRID) * GRID;
const AUTOSAVE_MS = 15_000;
/** A selected seat: "<section id>|<row>-<number>" (section ids never contain "|"). */
const seatKey = (sectionId: string, local: string) => `${sectionId}|${local}`;
const splitKey = (k: string) => { const i = k.indexOf("|"); return { sectionId: k.slice(0, i), local: k.slice(i + 1) }; };
const sig = (layout: SeatMapLayout, name: string) => JSON.stringify([layout, name]);
/** Short fingerprint of the saved map, kept with the browser backup: a backup made on top of another save is stale. */
function fingerprint(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${s.length}:${h >>> 0}`;
}
const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

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

const SHORTCUTS: [string, string][] = [
  ["Drag on the canvas", "Select every seat in the box (any section)"],
  ["Shift + drag / Alt + drag", "Add to / remove from the selection"],
  ["Click a seat", "Select or unselect it (in the selected section)"],
  ["Shift + click", "Select every seat from the last one clicked"],
  ["Double-click / Alt + click", "Select the seat's whole row"],
  ["R", "Select the full rows of the selected seats"],
  ["Ctrl/⌘ + A", "Select all seats (of the selected section)"],
  ["Delete", "Take out the selected seats (or delete the selected item)"],
  ["Arrow keys (Shift: ×5)", "Nudge the selected section or shape"],
  ["Ctrl/⌘ + D", "Duplicate the selected section"],
  ["Ctrl/⌘ + S", "Save"],
  ["Ctrl/⌘ + Z / Y", "Undo / redo"],
  ["Esc", "Clear the selection"],
];

export function SeatMapEditor({ target, mapName, initial, editable, floorPlanUrl, autosaved = null }: {
  target: BuilderTarget; mapName: string; initial: SeatMapLayout; editable: boolean; floorPlanUrl: string | null;
  /** the server's autosave of unsaved work, if any */
  autosaved?: Draft | null;
}) {
  const [h, setH] = useState<History>({ past: [], present: initial, future: [], key: null });
  const [saved, setSaved] = useState<{ layout: SeatMapLayout; name: string }>({ layout: initial, name: mapName });
  const [sel, setSel] = useState<Selected>(null);
  const [seatSel, setSeatSel] = useState<Set<string>>(new Set());
  const [name, setName] = useState(mapName);
  const [planOpacity, setPlanOpacity] = useState(floorPlanUrl ? 0.35 : 0);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ id: string; kind: "section" | "shape"; dx: number; dy: number; startX: number; startY: number; ox: number; oy: number } | null>(null);
  const [marquee, setMarquee] = useState<(Rect & { mode: SelectMode }) | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [restored, setRestored] = useState<{ at: number; source: "browser" | "server" } | null>(null);
  const [ready, setReady] = useState(false);
  const [auto, setAuto] = useState<{ at: number | null; error: string | null }>({ at: autosaved?.at ?? null, error: null });
  const svgRef = useRef<SVGSVGElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  /** a press on the canvas or a seat that becomes a click or a box drag */
  const press = useRef<{ pointerId: number; sx: number; sy: number; cx: number; cy: number; seat: string | null; mods: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }; moved: boolean } | null>(null);
  const anchor = useRef<string | null>(null);
  const lastClick = useRef<{ seat: string; at: number } | null>(null);
  const layout = h.present;
  const targetFields = Object.entries(target) as [string, number][];
  const storageKey = `fx-seatmap-draft:${"map_id" in target ? `m${target.map_id}` : `r${target.request_id}`}`;

  const savedSig = useMemo(() => sig(saved.layout, saved.name), [saved]);
  const currentSig = useMemo(() => sig(layout, name), [layout, name]);
  const dirty = savedSig !== currentSig;
  const sessionAlive = useKeepAlive(editable);

  // ---- save -----------------------------------------------------------------------------------------------------------
  const submitted = useRef<{ layout: SeatMapLayout; name: string } | null>(null);
  const firstAutoSig = autosaved ? sig(autosaved.layout, autosaved.name || mapName) : sig(initial, mapName);
  const lastAuto = useRef<string>(firstAutoSig);
  /** the same, for rendering the autosave status */
  const [autoSig, setAutoSig] = useState(firstAutoSig);
  const markAutosaved = (s: string) => { lastAuto.current = s; setAutoSig(s); };
  const [state, action] = useActionState(saveSeatMapLayout, undefined);
  const lastSaved = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.error) toast.error(state.error);
    else if (state?.ok && state.saved && state.saved !== lastSaved.current) {
      lastSaved.current = state.saved;
      toast.success(state.message ?? "Saved");
      const done = submitted.current ?? { layout, name };
      setSaved(done);
      markAutosaved(sig(done.layout, done.name));
      setRestored(null);
      try { localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ---- restore unsaved work from the last visit ------------------------------------------------------------------------
  // Browser storage can only be read after hydration, so the restore sets state from this mount effect on purpose.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!editable) { setReady(true); return; }
    const base = sig(initial, mapName);
    const candidates: (Draft & { source: "browser" | "server" })[] = [];
    if (autosaved) candidates.push({ ...autosaved, name: autosaved.name || mapName, source: "server" });
    try {
      const raw = localStorage.getItem(storageKey);
      const local = raw ? JSON.parse(raw) as { layout?: SeatMapLayout; name?: unknown; at?: unknown; base?: unknown } : null;
      // Only a backup made on top of the map as it is saved now: if someone saved since, the backup is out of date.
      if (local && local.base === fingerprint(base) && Array.isArray(local.layout?.sections) && Array.isArray(local.layout?.shapes) && typeof local.at === "number") {
        candidates.push({ layout: local.layout, name: typeof local.name === "string" ? local.name : mapName, at: local.at, source: "browser" });
      }
    } catch { /* storage unavailable or unreadable */ }
    const best = candidates.filter((c) => sig(c.layout, c.name) !== base).sort((a, b) => b.at - a.at)[0];
    if (best) {
      setH({ past: [initial], present: best.layout, future: [], key: null });
      setName(best.name);
      setRestored({ at: best.at, source: best.source });
    }
    setReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  // ---- browser backup: every change, at once ---------------------------------------------------------------------------
  useEffect(() => {
    if (!editable || !ready) return;
    const t = window.setTimeout(() => {
      try {
        if (dirty) localStorage.setItem(storageKey, JSON.stringify({ layout, name, at: Date.now(), base: fingerprint(savedSig) }));
        else localStorage.removeItem(storageKey);
      } catch { /* storage full or unavailable: the server autosave still runs */ }
    }, 400);
    return () => window.clearTimeout(t);
  }, [layout, name, dirty, savedSig, ready, editable, storageKey]);

  // ---- server autosave: every AUTOSAVE_MS while there is something new ------------------------------------------------
  const latest = useRef({ layout, name, dirty, currentSig });
  useEffect(() => { latest.current = { layout, name, dirty, currentSig }; });
  const inflight = useRef(false);
  const autosaveNow = async (discard = false) => {
    if (inflight.current && !discard) return;
    inflight.current = true;
    const cur = latest.current;
    const fd = new FormData();
    for (const [k, v] of targetFields) fd.set(k, String(v));
    if (discard) fd.set("discard", "1");
    else { fd.set("layout", JSON.stringify(cur.layout)); fd.set("name", cur.name); fd.set("client_at", String(Date.now())); }
    try {
      const r = await autosaveSeatMapLayout(fd);
      if (r.ok) { markAutosaved(discard ? savedSig : cur.currentSig); setAuto({ at: r.at ?? Date.now(), error: null }); }
      else setAuto((a) => ({ ...a, error: r.error ?? "Autosave failed." }));
    } catch {
      setAuto((a) => ({ ...a, error: "offline" }));
    } finally { inflight.current = false; }
  };
  useEffect(() => {
    if (!editable) return;
    const timer = window.setInterval(() => {
      const cur = latest.current;
      if (cur.dirty && cur.currentSig !== lastAuto.current) void autosaveNow();
    }, AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [editable]); // eslint-disable-line react-hooks/exhaustive-deps

  const discardUnsaved = () => {
    setH((c) => ({ past: [...c.past.slice(-80), c.present], present: saved.layout, future: [], key: null }));
    setName(saved.name);
    setRestored(null);
    setSeatSel(new Set());
    try { localStorage.removeItem(storageKey); } catch { /* storage unavailable */ }
    void autosaveNow(true);
  };

  // ---- editing ---------------------------------------------------------------------------------------------------------
  /** Change the layout. Edits with the same `key` in a row (typing in one field, nudging) are one undo step. */
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
    if (sel.kind === "section") setSeatSel((cur) => new Set([...cur].filter((k) => splitKey(k).sectionId !== sel.id)));
    setSel(null);
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
  const nudge = (dx: number, dy: number) => {
    if (section) setSection(section.id, { x: section.x + dx, y: section.y + dy }, `nudge:${section.id}`);
    else if (shape) setShape(shape.id, { x: shape.x + dx, y: shape.y + dy }, `nudge:${shape.id}`);
  };

  // ---- seats -----------------------------------------------------------------------------------------------------------
  /** Every seat of every section (taken-out seats too, so they can be selected and put back), in map order. */
  const seatsBySection = useMemo(() => new Map(layout.sections.map((sec) => [sec.id, sectionSeats(sec, true)])), [layout.sections]);
  const allSeats = useMemo(() => [...seatsBySection.values()].flat(), [seatsBySection]);
  const selCount = useMemo(() => allSeats.reduce((n, s) => n + (seatSel.has(seatKey(s.sectionId, s.local)) ? 1 : 0), 0), [allSeats, seatSel]);
  const selSections = useMemo(() => new Set([...seatSel].map((k) => splitKey(k).sectionId).filter((id) => seatsBySection.has(id))).size, [seatSel, seatsBySection]);

  const rowKeys = (keys: Iterable<string>) => {
    const out: string[] = [];
    for (const k of keys) {
      const { sectionId, local } = splitKey(k);
      const seats = seatsBySection.get(sectionId) ?? [];
      const seat = seats.find((s) => s.local === local);
      if (!seat) continue;
      for (const s of seats) if ((s.row ?? "") === (seat.row ?? "")) out.push(seatKey(sectionId, s.local));
    }
    return out;
  };
  const selectAll = () => setSeatSel(new Set((section ? seatsBySection.get(section.id) ?? [] : allSeats).map((s) => seatKey(s.sectionId, s.local))));

  /** Take out / put back / mark the selected seats, in every section they are in. */
  const seatAction = (op: "remove" | "restore" | Accessibility | "clear") => {
    if (!seatSel.size) return;
    const bySection = new Map<string, string[]>();
    for (const k of seatSel) { const { sectionId, local } = splitKey(k); bySection.set(sectionId, [...(bySection.get(sectionId) ?? []), local]); }
    update((l) => ({
      ...l, sections: l.sections.map((s) => {
        const keys = bySection.get(s.id);
        if (!keys) return s;
        const set = new Set(keys);
        if (op === "remove") return { ...s, removed: [...new Set([...s.removed, ...keys])] } as Section;
        if (op === "restore") return { ...s, removed: s.removed.filter((k) => !set.has(k)) } as Section;
        const access = { ...s.access };
        for (const k of keys) { if (op === "clear") delete access[k]; else access[k] = op; }
        return { ...s, access } as Section;
      }),
    }));
    if (op === "remove" || op === "restore") setSeatSel(new Set());
  };

  // ---- pointer: dragging sections and shapes, clicking seats, box selection ---------------------------------------------
  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const startDrag = (e: ReactPointerEvent, kind: "section" | "shape", id: string, ox: number, oy: number) => {
    e.stopPropagation();
    e.preventDefault();
    setSel({ kind, id });
    if (!editable) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toCanvas(e);
    setDrag({ id, kind, dx: 0, dy: 0, startX: p.x, startY: p.y, ox, oy });
  };
  const startPress = (e: ReactPointerEvent, seat: string | null) => {
    if (e.button !== 0) return;
    // No text selection while dragging a box, and a field that had focus lets go, so Delete and the arrows reach the map.
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest("input, textarea, select")) document.activeElement.blur();
    const p = toCanvas(e);
    svgRef.current?.setPointerCapture?.(e.pointerId);
    press.current = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, cx: p.x, cy: p.y, seat, mods: { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }, moved: false };
  };
  const onCanvasDown = (e: ReactPointerEvent) => {
    if (!editable) { setSel(null); setSeatSel(new Set()); return; }
    startPress(e, null);
  };
  const onSeatDown = (e: ReactPointerEvent, sec: Section, local: string, active: boolean) => {
    if (!editable) return;
    const modified = e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
    // A plain press on a section that isn't selected yet selects and moves the section (handled by its group).
    if (!active && !modified) return;
    e.stopPropagation();
    startPress(e, seatKey(sec.id, local));
  };
  const onMove = (e: ReactPointerEvent) => {
    if (drag) {
      const p = toCanvas(e);
      setDrag({ ...drag, dx: snap(p.x - drag.startX), dy: snap(p.y - drag.startY) });
      return;
    }
    const pr = press.current;
    if (!pr || pr.pointerId !== e.pointerId) return;
    if (!pr.moved && !isDrag(e.clientX - pr.sx, e.clientY - pr.sy)) return;
    pr.moved = true;
    const p = toCanvas(e);
    setMarquee({ x0: pr.cx, y0: pr.cy, x1: p.x, y1: p.y, mode: boxMode(pr.mods) });
  };
  const onUp = (e: ReactPointerEvent) => {
    if (drag) {
      if (drag.dx || drag.dy) {
        const x = drag.ox + drag.dx, y = drag.oy + drag.dy;
        // Each drag is its own undo step.
        if (drag.kind === "section") setSection(drag.id, { x, y }, `drag:${e.timeStamp}`);
        else setShape(drag.id, { x, y }, `drag:${e.timeStamp}`);
      }
      setDrag(null);
      return;
    }
    const pr = press.current;
    press.current = null;
    if (!pr || pr.pointerId !== e.pointerId) return;
    if (pr.moved) {
      const p = toCanvas(e);
      const hits = pointsInRect(allSeats, { x0: pr.cx, y0: pr.cy, x1: p.x, y1: p.y }, SEAT_RADIUS * 0.6);
      setSeatSel((cur) => applySelection(cur, hits.map((s) => seatKey(s.sectionId, s.local)), boxMode(pr.mods)));
      const secs = new Set(hits.map((s) => s.sectionId));
      if (secs.size === 1) setSel({ kind: "section", id: [...secs][0] });
      setMarquee(null);
      return;
    }
    if (!pr.seat) {
      // A click on empty canvas clears the selection (Shift keeps it).
      if (!pr.mods.shiftKey) { setSel(null); setSeatSel(new Set()); }
      return;
    }
    const { sectionId, local } = splitKey(pr.seat);
    setSel({ kind: "section", id: sectionId });
    // Double-click (two clicks on one seat): its whole row. Detected here because the canvas holds the pointer.
    const now = e.timeStamp, prev = lastClick.current;
    lastClick.current = { seat: pr.seat, at: now };
    if (prev && prev.seat === pr.seat && now - prev.at < 400 && !pr.mods.shiftKey && !pr.mods.altKey) {
      lastClick.current = null;
      setSeatSel((cur) => applySelection(cur, rowKeys([pr.seat!]), "add"));
      return;
    }
    if (pr.mods.altKey) setSeatSel((cur) => applySelection(cur, rowKeys([pr.seat!]), "toggle"));
    else if (pr.mods.shiftKey) {
      const from = anchor.current && splitKey(anchor.current).sectionId === sectionId ? splitKey(anchor.current).local : null;
      const range = rangeBetween(seatsBySection.get(sectionId) ?? [], (s) => s.local, from, local);
      setSeatSel((cur) => applySelection(cur, range.map((s) => seatKey(sectionId, s.local)), "add"));
    } else setSeatSel((cur) => applySelection(cur, [pr.seat!], "toggle"));
    anchor.current = pr.seat;
  };
  const onCancel = () => { press.current = null; setMarquee(null); setDrag(null); };
  const offset = (kind: "section" | "shape", id: string) => (drag && drag.kind === kind && drag.id === id ? { dx: drag.dx, dy: drag.dy } : { dx: 0, dy: 0 });

  // ---- keyboard ------------------------------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable=true]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && k === "y") { e.preventDefault(); redo(); }
      else if (mod && k === "s") { e.preventDefault(); if (editable && dirty) formRef.current?.requestSubmit(); }
      else if (!editable) { if (e.key === "Escape") { setSel(null); setSeatSel(new Set()); } }
      else if (mod && k === "a") { e.preventDefault(); selectAll(); }
      else if (mod && k === "d") { if (section) { e.preventDefault(); duplicate(); } }
      else if (e.key === "Delete" || e.key === "Backspace") {
        if (seatSel.size) { e.preventDefault(); seatAction("remove"); } else if (sel) { e.preventDefault(); remove(); }
      }
      else if (k === "r" && !mod && seatSel.size) { e.preventDefault(); setSeatSel((cur) => applySelection(cur, rowKeys(cur), "add")); }
      else if (e.key.startsWith("Arrow") && (section || shape)) {
        e.preventDefault();
        const step = e.shiftKey ? GRID * 5 : GRID;
        nudge(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
      }
      else if (e.key === "Escape") { setSel(null); setSeatSel(new Set()); setMarquee(null); press.current = null; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const total = seatCount(layout);
  const autosaveText = !editable ? null
    : !dirty ? "All changes saved."
    : auto.error ? null
    : autoSig === currentSig && auto.at ? `Unsaved changes are kept: autosaved at ${time(auto.at)}. Save to add them to the change history.`
    : "Unsaved changes are kept in this browser and autosaved every few seconds.";
  const autosaveError = !editable || !dirty || !auto.error ? null
    : auto.error === "Unauthorized" || !sessionAlive ? "You were signed out. Your changes are kept in this browser: sign in again (in a new tab is fine) and they will be autosaved; nothing is lost."
    : auto.error === "offline" ? "Autosave can’t reach the server. Your changes are kept in this browser."
    : `Autosave paused: ${auto.error} Your changes are kept in this browser.`;

  return (
    <div className="grid gap-4">
      {restored ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <span>Restored unsaved changes from {time(restored.at)} ({restored.source === "browser" ? "kept in this browser" : "autosaved"}). Save to keep them.</span>
          <Button type="button" size="xs" variant="outline" onClick={discardUnsaved}>Discard them</Button>
        </div>
      ) : null}
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
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowKeys((v) => !v)} aria-expanded={showKeys}><KeyboardIcon /> Shortcuts</Button>
          </>
        ) : <Badge variant="outline">Read only</Badge>}
        <div className="ml-auto flex flex-wrap items-end gap-3">
          {floorPlanUrl ? (
            <label className="grid gap-1 text-xs">Floor plan
              <input type="range" min={0} max={1} step={0.05} value={planOpacity} onChange={(e) => setPlanOpacity(Number(e.target.value))} className="w-28" />
            </label>
          ) : null}
          <label className="grid gap-1 text-xs">Zoom
            <NativeSelect value={String(zoom)} onChange={(e) => setZoom(Number(e.target.value))}>
              {[0.5, 0.75, 1, 1.5, 2, 3].map((z) => <NativeSelectOption key={z} value={String(z)}>{z * 100}%</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <Badge variant="secondary" className="h-8">{total.toLocaleString("en-US")} seats</Badge>
        </div>
      </div>
      {showKeys ? (
        <dl className="grid gap-x-6 gap-y-1 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-2">
          {SHORTCUTS.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="min-w-44 font-semibold">{k}</dt><dd className="text-muted-foreground">{v}</dd></div>)}
        </dl>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* canvas */}
        <div className="overflow-auto rounded-xl border bg-white" style={{ maxHeight: "75vh" }}>
          <svg
            ref={svgRef} viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ width: layout.width * zoom, height: layout.height * zoom }}
            className={`block touch-none select-none ${editable ? "cursor-crosshair" : ""}`}
            onPointerDown={onCanvasDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
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
              const seats = seatsBySection.get(sec.id) ?? [];
              const half = sec.kind === "table" ? tableHalfSize(sec) : null;
              const minY = Math.min(...seats.map((s) => s.y), sec.y);
              return (
                <g key={sec.id} transform={`translate(${o.dx} ${o.dy})`} onPointerDown={(e) => startDrag(e, "section", sec.id, sec.x, sec.y)} className={editable ? "cursor-move" : "cursor-pointer"}>
                  {half && sec.kind === "table" ? (sec.shape === "round"
                    ? <circle cx={sec.x} cy={sec.y} r={half.r} fill="#f4f4f5" stroke={active ? "#0284c7" : "#d4d4d8"} strokeWidth={active ? 2 : 1} />
                    : <rect x={sec.x - half.w} y={sec.y - half.h} width={2 * half.w} height={2 * half.h} rx={4} fill="#f4f4f5" stroke={active ? "#0284c7" : "#d4d4d8"} transform={sec.rotation ? `rotate(${sec.rotation} ${sec.x} ${sec.y})` : undefined} />) : null}
                  <text x={sec.kind === "table" ? sec.x : seats.reduce((n, s) => n + s.x, 0) / Math.max(1, seats.length)} y={sec.kind === "table" ? sec.y : minY - SEAT_RADIUS - 10} textAnchor="middle" dominantBaseline="middle" fontSize={12} fontWeight={600} fill={active ? "#0369a1" : "#52525b"}>{sec.name}</text>
                  {seats.map((s) => {
                    const picked = seatSel.has(seatKey(sec.id, s.local));
                    const fill = s.removed ? "transparent" : s.access === "wheelchair" ? "#2563eb" : s.access === "companion" ? "#60a5fa" : s.access === "restricted_view" ? "#a1a1aa" : active ? "#0ea5e9" : "#71717a";
                    return (
                      <g key={s.key} className={active && editable ? "cursor-pointer" : undefined}
                        onPointerDown={(e) => onSeatDown(e, sec, s.local, active)}>
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
            {marquee ? (
              <rect x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)} width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)}
                fill={marquee.mode === "remove" ? "rgba(239,68,68,0.08)" : "rgba(14,165,233,0.08)"} stroke={marquee.mode === "remove" ? "#ef4444" : "#0284c7"} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />
            ) : null}
          </svg>
        </div>

        {/* side panel */}
        <div className="grid content-start gap-4 text-sm">
          <form ref={formRef} action={action} onSubmit={() => { submitted.current = { layout, name }; }} className="grid gap-2 rounded-xl border p-3">
            {targetFields.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="layout" value={JSON.stringify(layout)} />
            <Text label="Map name" value={name} onChange={setName} maxLength={160} />
            <input type="hidden" name="name" value={name} />
            <div className="grid grid-cols-2 gap-2">
              <Num label="Canvas width" value={layout.width} min={200} max={6000} step={50} onChange={(n) => update((l) => ({ ...l, width: n }), "canvas-w")} />
              <Num label="Canvas height" value={layout.height} min={200} max={6000} step={50} onChange={(n) => update((l) => ({ ...l, height: n }), "canvas-h")} />
            </div>
            {editable ? (
              <div className="flex gap-2">
                <Button type="submit" disabled={!dirty} className="flex-1"><SaveIcon /> {dirty ? "Save changes" : "Saved"}</Button>
                {dirty ? <Button type="button" variant="ghost" onClick={discardUnsaved}>Discard</Button> : null}
              </div>
            ) : null}
            {autosaveText ? <p className="text-xs text-muted-foreground" aria-live="polite">{autosaveText}</p> : null}
            {autosaveError ? <p className="rounded-md bg-amber-500/15 p-2 text-xs text-amber-900" role="alert">{autosaveError}</p> : null}
            <p className="text-xs text-muted-foreground">Every save is listed in the change history below.</p>
          </form>

          {editable && selCount ? (
            <div className="grid gap-2 rounded-xl border border-amber-500/50 p-3">
              <p className="text-xs font-semibold">{selCount} seat{selCount === 1 ? "" : "s"} selected{selSections > 1 ? ` in ${selSections} sections` : ""}</p>
              <div className="flex flex-wrap gap-1">
                <Button type="button" size="xs" variant="outline" onClick={() => seatAction("remove")}>Take out</Button>
                <Button type="button" size="xs" variant="outline" onClick={() => seatAction("restore")}>Put back</Button>
                {ACCESSIBILITY.map((a) => <Button key={a.value} type="button" size="xs" variant="outline" onClick={() => seatAction(a.value)}>{a.label}</Button>)}
                <Button type="button" size="xs" variant="ghost" onClick={() => seatAction("clear")}>Clear mark</Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => setSeatSel((cur) => applySelection(cur, rowKeys(cur), "add"))}>Select full rows</Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => setSeatSel(new Set())}>Clear selection</Button>
              </div>
            </div>
          ) : null}

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
                      <NativeSelect id="ed-numbering" value={section.numbering} onChange={(e) => setSection(section.id, { numbering: e.target.value as RowsSection["numbering"] })}>
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
                      <NativeSelect id="ed-shape" value={section.shape} onChange={(e) => setSection(section.id, { shape: e.target.value as TableSection["shape"] })}>
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
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <p className="flex-1 text-xs text-muted-foreground">Click seats to select them, drag a box, Shift+click for a range, double-click for a row.</p>
                  <Button type="button" size="xs" variant="ghost" onClick={selectAll}>Select all</Button>
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
                  <NativeSelect id="ed-kind" value={shape.kind} onChange={(e) => setShape(shape.id, { kind: e.target.value as Shape["kind"] })}>
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
            <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">Select a section, table or shape on the canvas (or in the list below) to edit it. Drag to move. Drag on empty canvas to select seats.</p>
          )}

          <div className="grid gap-1 rounded-xl border p-3">
            <p className="text-xs font-semibold text-muted-foreground">Sections, best seats first</p>
            {layout.sections.length ? (
              <ol className="grid gap-0.5">
                {layout.sections.map((s, i) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setSel({ kind: "section", id: s.id })} className={`flex w-full justify-between rounded px-2 py-1 text-left text-xs hover:bg-accent ${sel?.id === s.id ? "bg-accent font-semibold" : ""}`}>
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
