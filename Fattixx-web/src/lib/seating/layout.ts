/*
 * Seat map layouts (plan 5.7.3–5.7.13). A layout is what Fattixx staff draw from a venue's floor plan: sections of
 * numbered rows, tables, and shapes (stage, standing areas, labels). Seats are not stored one by one in the map; they
 * are generated from each section's settings, minus the seats taken out (aisles, missing seats), plus accessibility
 * marks. Pure functions only: the staff builder, the server (validation, the event snapshot, the change log) and the
 * buyer's seat picker all use the same rules.
 */

export const LAYOUT_LIMITS = { sections: 200, shapes: 100, rows: 100, seatsPerRow: 200, tableSeats: 30, seats: 20_000, canvas: 6000, name: 60 } as const;

export type Accessibility = 'wheelchair' | 'companion' | 'restricted_view';
export const ACCESSIBILITY: { value: Accessibility; label: string }[] = [
  { value: 'wheelchair', label: 'Wheelchair space' },
  { value: 'companion', label: 'Companion seat' },
  { value: 'restricted_view', label: 'Restricted view' },
];

export type RowsSection = {
  id: string; kind: 'rows'; name: string;
  /** top-centre of the block; the block is rotated around it */
  x: number; y: number; rotation: number;
  rows: number; seatsPerRow: number;
  /** "A" (letters, then AA, AB…) or "1" (numbers) */
  firstRow: string;
  /** venues often skip the letters I and O */
  skipIO: boolean;
  firstSeat: number;
  /** seat numbers rise left to right (ltr) or right to left (rtl), as seen from the stage side of the drawing */
  numbering: 'ltr' | 'rtl';
  seatSpacing: number; rowSpacing: number;
  /** how far the ends of each row bend towards the stage; 0 = straight */
  curve: number;
  /** "<row>-<number>" of seats taken out */
  removed: string[];
  /** "<row>-<number>" → mark */
  access: Record<string, Accessibility>;
};

export type TableSection = {
  id: string; kind: 'table'; name: string; x: number; y: number; rotation: number;
  seats: number; shape: 'round' | 'rect'; seatSpacing: number;
  removed: string[]; access: Record<string, Accessibility>;
};

export type Section = RowsSection | TableSection;

export type Shape = { id: string; kind: 'stage' | 'area' | 'label'; x: number; y: number; w: number; h: number; text: string };

export type SeatMapLayout = { version: 1; width: number; height: number; sections: Section[]; shapes: Shape[] };

/** One generated seat. `key` is stable while the section keeps its id, row and number. */
export type SeatPoint = {
  key: string; sectionId: string; section: string; row: string | null; number: string;
  x: number; y: number; access: Accessibility | null; label: string; sort: number;
};

/** What a buyer or organizer sees for a seat. Accessibility is a property of the seat, shown alongside its status. */
export type SeatStatus = 'available' | 'held' | 'sold' | 'blocked' | 'unassigned';
export const SEAT_STATUS_LABEL: Record<SeatStatus, string> = { available: 'Available', held: 'In someone’s cart', sold: 'Sold', blocked: 'Blocked', unassigned: 'Not for sale' };

/** Default colours offered for pricing tiers (readable on white, distinct from one another). */
export const TIER_COLORS = ['#A8121A', '#1D4ED8', '#047857', '#B45309', '#7C3AED', '#0E7490', '#BE185D', '#4D7C0F'] as const;

export const SEAT_RADIUS = 8;

export function emptyLayout(): SeatMapLayout {
  return { version: 1, width: 1200, height: 800, sections: [], shapes: [] };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function newRowsSection(over: Partial<RowsSection> = {}): RowsSection {
  return {
    id: newId(), kind: 'rows', name: 'Section', x: 600, y: 200, rotation: 0, rows: 5, seatsPerRow: 12, firstRow: 'A', skipIO: false,
    firstSeat: 1, numbering: 'ltr', seatSpacing: 22, rowSpacing: 26, curve: 0, removed: [], access: {}, ...over,
  };
}

export function newTableSection(over: Partial<TableSection> = {}): TableSection {
  return { id: newId(), kind: 'table', name: 'Table 1', x: 600, y: 400, rotation: 0, seats: 8, shape: 'round', seatSpacing: 22, removed: [], access: {}, ...over };
}

// ---------------------------------------------------------------------------
// Row labels: letters (A … Z, AA, AB …) or numbers
// ---------------------------------------------------------------------------
function lettersToIndex(s: string): number {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function indexToLetters(i: number): string {
  let n = i + 1, out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

/** The labels of `count` rows starting at `first`. */
export function rowLabels(first: string, count: number, skipIO = false): string[] {
  const f = first.trim().toUpperCase();
  if (/^\d+$/.test(f)) return Array.from({ length: count }, (_, i) => String(Number(f) + i));
  const out: string[] = [];
  let i = /^[A-Z]{1,3}$/.test(f) ? lettersToIndex(f) : 0;
  while (out.length < count) {
    const label = indexToLetters(i++);
    if (skipIO && (label === 'I' || label === 'O')) continue;
    out.push(label);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seat generation
// ---------------------------------------------------------------------------
const round = (n: number) => Math.round(n * 100) / 100;

function rotate(dx: number, dy: number, deg: number): [number, number] {
  if (!deg) return [dx, dy];
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [dx * c - dy * s, dx * s + dy * c];
}

/** "Orchestra · Row C · Seat 12" / "Table 5 · Seat 3" */
export function seatLabel(section: string, row: string | null, number: string): string {
  return (row ? `${section} · Row ${row} · Seat ${number}` : `${section} · Seat ${number}`).slice(0, 120);
}

/** Every seat of one section, in map order. `local` keys are "<row>-<number>" (what `removed` and `access` use). */
export function sectionSeats(sec: Section, includeRemoved = false): (SeatPoint & { local: string; removed: boolean })[] {
  const out: (SeatPoint & { local: string; removed: boolean })[] = [];
  const removed = new Set(sec.removed);
  const push = (row: string | null, num: number, dx: number, dy: number) => {
    const local = `${row ?? ''}-${num}`;
    const isRemoved = removed.has(local);
    if (isRemoved && !includeRemoved) return;
    const [rx, ry] = rotate(dx, dy, sec.rotation);
    const number = String(num);
    out.push({
      key: `${sec.id}:${row ?? ''}:${number}`, sectionId: sec.id, section: sec.name, row, number,
      x: round(sec.x + rx), y: round(sec.y + ry), access: sec.access[local] ?? null, label: seatLabel(sec.name, row, number), sort: 0,
      local, removed: isRemoved,
    });
  };
  if (sec.kind === 'rows') {
    const labels = rowLabels(sec.firstRow, sec.rows, sec.skipIO);
    const n = sec.seatsPerRow, mid = (n - 1) / 2;
    labels.forEach((row, r) => {
      for (let s = 0; s < n; s++) {
        const t = mid ? (s - mid) / mid : 0;
        const num = sec.numbering === 'ltr' ? sec.firstSeat + s : sec.firstSeat + (n - 1 - s);
        push(row, num, (s - mid) * sec.seatSpacing, r * sec.rowSpacing - sec.curve * t * t);
      }
    });
  } else {
    const n = sec.seats;
    if (sec.shape === 'round') {
      const radius = Math.max(26, (n * sec.seatSpacing) / (2 * Math.PI));
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
        push(null, i + 1, radius * Math.cos(a), radius * Math.sin(a));
      }
    } else {
      const top = Math.ceil(n / 2), bottom = n - top;
      const half = tableHalfSize(sec);
      for (let i = 0; i < top; i++) push(null, i + 1, (i - (top - 1) / 2) * sec.seatSpacing, -half.h - 12);
      for (let i = 0; i < bottom; i++) push(null, top + i + 1, ((bottom - 1) / 2 - i) * sec.seatSpacing, half.h + 12);
    }
  }
  return out;
}

/** Half width / height of a rectangular table, or the radius of a round one (for drawing the table itself). */
export function tableHalfSize(sec: TableSection): { w: number; h: number; r: number } {
  const r = Math.max(26, (sec.seats * sec.seatSpacing) / (2 * Math.PI)) - 12;
  const top = Math.ceil(sec.seats / 2);
  return { w: Math.max(20, (top * sec.seatSpacing) / 2), h: 14, r: Math.max(12, r) };
}

/** Every seat of the layout in map order (sections in the order they are listed, then rows, then seats). */
export function expandLayout(layout: SeatMapLayout): SeatPoint[] {
  const out: SeatPoint[] = [];
  for (const sec of layout.sections) {
    for (const s of sectionSeats(sec)) {
      out.push({ key: s.key, sectionId: s.sectionId, section: s.section, row: s.row, number: s.number, x: s.x, y: s.y, access: s.access, label: s.label, sort: out.length });
    }
  }
  return out;
}

export function seatCount(layout: SeatMapLayout): number {
  return layout.sections.reduce((n, s) => n + (s.kind === 'rows' ? s.rows * s.seatsPerRow : s.seats) - s.removed.length, 0);
}

/** Bounding box of a section's seats (for its label and for selecting it). */
export function sectionBounds(sec: Section): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const seats = sectionSeats(sec, true);
  if (!seats.length) return null;
  return seats.reduce((b, s) => ({ minX: Math.min(b.minX, s.x), minY: Math.min(b.minY, s.y), maxX: Math.max(b.maxX, s.x), maxY: Math.max(b.maxY, s.y) }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

/** Everything drawn under the seats: shapes, tables, and a name label per section. */
export type Drawing = {
  shapes: Shape[];
  tables: { x: number; y: number; rotation: number; shape: 'round' | 'rect'; w: number; h: number; r: number }[];
  labels: { text: string; x: number; y: number }[];
};

export function drawingFor(layout: SeatMapLayout): Drawing {
  const tables: Drawing['tables'] = [];
  const labels: Drawing['labels'] = [];
  for (const sec of layout.sections) {
    if (sec.kind === 'table') {
      const half = tableHalfSize(sec);
      tables.push({ x: sec.x, y: sec.y, rotation: sec.rotation, shape: sec.shape, w: half.w, h: half.h, r: half.r });
      labels.push({ text: sec.name, x: sec.x, y: sec.y });
    } else {
      const b = sectionBounds(sec);
      if (b) labels.push({ text: sec.name, x: round((b.minX + b.maxX) / 2), y: round(b.minY - SEAT_RADIUS - 10) });
    }
  }
  return { shapes: layout.shapes, tables, labels };
}

/** The part of the canvas that has something on it (with a margin), as an SVG viewBox. */
export function contentBox(points: { x: number; y: number }[], shapes: Shape[], pad = 30): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  for (const s of shapes) { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h); }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 400, h: 300 };
  return { x: minX - pad, y: minY - pad - 20, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad + 20 };
}

// ---------------------------------------------------------------------------
// Validation: anything saved by the builder (or sent by a crafted request) goes through here
// ---------------------------------------------------------------------------
const num = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : fallback;
};
const int = (v: unknown, min: number, max: number, fallback: number) => Math.round(num(v, min, max, fallback));
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const ID = /^[a-z0-9]{1,16}$/i;
const LOCAL = /^[A-Z0-9]{0,4}-\d{1,4}$/;

function marks(v: unknown): { removed: string[]; access: Record<string, Accessibility> } {
  const o = (v ?? {}) as { removed?: unknown; access?: unknown };
  const removed = Array.isArray(o.removed) ? [...new Set(o.removed.filter((k): k is string => typeof k === 'string' && LOCAL.test(k)))].slice(0, 5000) : [];
  const access: Record<string, Accessibility> = {};
  if (o.access && typeof o.access === 'object') {
    for (const [k, a] of Object.entries(o.access as Record<string, unknown>).slice(0, 5000)) {
      if (LOCAL.test(k) && (a === 'wheelchair' || a === 'companion' || a === 'restricted_view')) access[k] = a;
    }
  }
  return { removed, access };
}

export function parseLayout(input: unknown): { layout: SeatMapLayout } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'The layout is empty.' };
  const raw = input as Record<string, unknown>;
  const L = LAYOUT_LIMITS;
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const rawShapes = Array.isArray(raw.shapes) ? raw.shapes : [];
  if (rawSections.length > L.sections) return { error: `A map can have at most ${L.sections} sections and tables.` };
  if (rawShapes.length > L.shapes) return { error: `A map can have at most ${L.shapes} shapes and labels.` };
  const width = int(raw.width, 200, L.canvas, 1200), height = int(raw.height, 200, L.canvas, 800);
  const ids = new Set<string>(), names = new Set<string>();
  const sections: Section[] = [];
  for (const s of rawSections as Record<string, unknown>[]) {
    const id = typeof s?.id === 'string' && ID.test(s.id) && !ids.has(s.id) ? s.id : newId();
    ids.add(id);
    const name = text(s?.name, L.name);
    if (!name) return { error: 'Every section and table needs a name.' };
    if (names.has(name.toLowerCase())) return { error: `Two sections are called “${name}”. Give each one its own name so seat labels are unique.` };
    names.add(name.toLowerCase());
    const base = { id, name, x: num(s.x, -L.canvas, 2 * L.canvas, 0), y: num(s.y, -L.canvas, 2 * L.canvas, 0), rotation: num(s.rotation, -180, 180, 0), ...marks(s) };
    if (s.kind === 'table') {
      sections.push({ ...base, kind: 'table', seats: int(s.seats, 1, L.tableSeats, 8), shape: s.shape === 'rect' ? 'rect' : 'round', seatSpacing: num(s.seatSpacing, 12, 80, 22) });
    } else {
      const firstRow = text(s.firstRow, 4).toUpperCase();
      sections.push({
        ...base, kind: 'rows', rows: int(s.rows, 1, L.rows, 5), seatsPerRow: int(s.seatsPerRow, 1, L.seatsPerRow, 12),
        firstRow: /^(\d{1,3}|[A-Z]{1,3})$/.test(firstRow) ? firstRow : 'A', skipIO: !!s.skipIO, firstSeat: int(s.firstSeat, 0, 999, 1),
        numbering: s.numbering === 'rtl' ? 'rtl' : 'ltr', seatSpacing: num(s.seatSpacing, 12, 80, 22), rowSpacing: num(s.rowSpacing, 12, 120, 26), curve: num(s.curve, -300, 300, 0),
      });
    }
  }
  const shapes: Shape[] = [];
  for (const s of rawShapes as Record<string, unknown>[]) {
    const id = typeof s?.id === 'string' && ID.test(s.id) && !ids.has(s.id) ? s.id : newId();
    ids.add(id);
    shapes.push({
      id, kind: s.kind === 'area' || s.kind === 'label' ? s.kind : 'stage',
      x: num(s.x, -L.canvas, 2 * L.canvas, 0), y: num(s.y, -L.canvas, 2 * L.canvas, 0), w: num(s.w, 10, L.canvas, 200), h: num(s.h, 10, L.canvas, 60), text: text(s.text, L.name),
    });
  }
  const layout: SeatMapLayout = { version: 1, width, height, sections, shapes };
  const seats = expandLayout(layout);
  if (seats.length > L.seats) return { error: `A map can have at most ${L.seats.toLocaleString('en-US')} seats.` };
  const keys = new Set<string>();
  for (const seat of seats) {
    if (keys.has(seat.key)) return { error: `${seat.label} appears twice. Check the row and seat numbering of ${seat.section}.` };
    keys.add(seat.key);
  }
  // Marks that point at seats that no longer exist (e.g. after a row was dropped) are cleaned up.
  for (const sec of sections) {
    const all = new Set(sectionSeats(sec, true).map((x) => x.local));
    sec.removed = sec.removed.filter((k) => all.has(k));
    sec.access = Object.fromEntries(Object.entries(sec.access).filter(([k]) => all.has(k)));
  }
  return { layout };
}

/** Layout stored in the database (already validated when it was saved); falls back to an empty map if unreadable. */
export function readLayout(stored: unknown): SeatMapLayout {
  const value = typeof stored === 'string' ? (() => { try { return JSON.parse(stored); } catch { return null; } })() : stored;
  const parsed = parseLayout(value);
  return 'layout' in parsed ? parsed.layout : emptyLayout();
}

// ---------------------------------------------------------------------------
// Change log: a readable list of what changed between two saves of the builder
// ---------------------------------------------------------------------------
const kindName = (s: Section) => (s.kind === 'table' ? 'table' : 'section');
const list = (keys: string[]) => (keys.length > 6 ? `${keys.slice(0, 6).join(', ')} and ${keys.length - 6} more` : keys.join(', '));
const sectionTotal = (s: Section) => sectionSeats(s).length;

export function diffLayouts(before: SeatMapLayout, after: SeatMapLayout): string[] {
  const out: string[] = [];
  if (before.width !== after.width || before.height !== after.height) out.push(`Canvas ${before.width}×${before.height} → ${after.width}×${after.height}`);
  const prev = new Map(before.sections.map((s) => [s.id, s]));
  const next = new Map(after.sections.map((s) => [s.id, s]));
  for (const s of after.sections) if (!prev.has(s.id)) out.push(`Added ${kindName(s)} “${s.name}” (${sectionTotal(s)} seats)`);
  for (const s of before.sections) if (!next.has(s.id)) out.push(`Removed ${kindName(s)} “${s.name}” (${sectionTotal(s)} seats)`);
  for (const b of before.sections) {
    const a = next.get(b.id);
    if (!a) continue;
    const name = `“${a.name}”`;
    if (a.name !== b.name) out.push(`Renamed “${b.name}” to ${name}`);
    const changes: string[] = [];
    const field = (label: string, x: unknown, y: unknown) => { if (x !== y) changes.push(`${label} ${String(x)} → ${String(y)}`); };
    if (a.kind === 'rows' && b.kind === 'rows') {
      field('rows', b.rows, a.rows); field('seats per row', b.seatsPerRow, a.seatsPerRow); field('first row', b.firstRow, a.firstRow);
      field('skip I and O', b.skipIO ? 'on' : 'off', a.skipIO ? 'on' : 'off'); field('first seat', b.firstSeat, a.firstSeat); field('numbering', b.numbering, a.numbering);
      field('seat spacing', b.seatSpacing, a.seatSpacing); field('row spacing', b.rowSpacing, a.rowSpacing); field('curve', b.curve, a.curve);
    } else if (a.kind === 'table' && b.kind === 'table') {
      field('seats', b.seats, a.seats); field('shape', b.shape, a.shape); field('seat spacing', b.seatSpacing, a.seatSpacing);
    } else changes.push(`changed from ${kindName(b)} to ${kindName(a)}`);
    field('rotation', b.rotation, a.rotation);
    if (changes.length) out.push(`${name}: ${changes.join(', ')}`);
    if (a.x !== b.x || a.y !== b.y) out.push(`Moved ${name}`);
    const bRemoved = new Set(b.removed), aRemoved = new Set(a.removed);
    const takenOut = a.removed.filter((k) => !bRemoved.has(k)), putBack = b.removed.filter((k) => !aRemoved.has(k));
    if (takenOut.length) out.push(`${name}: took out ${takenOut.length} seat${takenOut.length === 1 ? '' : 's'} (${list(takenOut)})`);
    if (putBack.length) out.push(`${name}: put back ${putBack.length} seat${putBack.length === 1 ? '' : 's'} (${list(putBack)})`);
    const keys = new Set([...Object.keys(a.access), ...Object.keys(b.access)]);
    const byMark = new Map<string, string[]>();
    for (const k of keys) {
      if (a.access[k] === b.access[k]) continue;
      const label = a.access[k] ? (ACCESSIBILITY.find((x) => x.value === a.access[k])?.label.toLowerCase() ?? a.access[k]) : 'no accessibility mark';
      byMark.set(label, [...(byMark.get(label) ?? []), k]);
    }
    for (const [label, ks] of byMark) out.push(`${name}: marked ${ks.length} seat${ks.length === 1 ? '' : 's'} as ${label} (${list(ks)})`);
  }
  const order = (l: SeatMapLayout) => l.sections.map((s) => s.id).filter((id) => prev.has(id) && next.has(id)).join(',');
  if (order(before) !== order(after)) out.push('Changed the order of sections (best seats are offered first)');
  const prevShapes = new Map(before.shapes.map((s) => [s.id, s]));
  const nextShapes = new Map(after.shapes.map((s) => [s.id, s]));
  const shapeName = (s: Shape) => `${s.kind}${s.text ? ` “${s.text}”` : ''}`;
  for (const s of after.shapes) if (!prevShapes.has(s.id)) out.push(`Added ${shapeName(s)}`);
  for (const s of before.shapes) if (!nextShapes.has(s.id)) out.push(`Removed ${shapeName(s)}`);
  for (const b of before.shapes) {
    const a = nextShapes.get(b.id);
    if (!a) continue;
    if (a.text !== b.text || a.kind !== b.kind) out.push(`Changed ${shapeName(b)} to ${shapeName(a)}`);
    if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h) out.push(`Moved or resized ${shapeName(a)}`);
  }
  return out;
}
