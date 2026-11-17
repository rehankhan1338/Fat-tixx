/*
 * Seat selection shortcuts shared by the staff builder, the organizer's Seating tab and the comp-ticket seat picker:
 *   - drag a box over seats (plain: replace the selection, Shift/Ctrl: add to it, Alt: remove from it);
 *   - Shift+click: every seat between the last one clicked and this one, in map order;
 *   - Ctrl/⌘+click: toggle one seat;
 *   - double-click (or Alt+click in the builder): the seat's whole row.
 * Pure functions only, so the rules are unit-tested (tests/unit/seat-selection.test.ts).
 */

export type SelectMode = 'replace' | 'add' | 'remove';
export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** What a box drag does, from the keys held when it started. */
export function boxMode(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): SelectMode {
  if (e.altKey) return 'remove';
  if (e.shiftKey || e.ctrlKey || e.metaKey) return 'add';
  return 'replace';
}

export function normRect(r: Rect): { minX: number; minY: number; maxX: number; maxY: number } {
  return { minX: Math.min(r.x0, r.x1), minY: Math.min(r.y0, r.y1), maxX: Math.max(r.x0, r.x1), maxY: Math.max(r.y0, r.y1) };
}

/** Points inside the box; `pad` counts a seat that the box only touches (its radius). */
export function pointsInRect<T extends { x: number; y: number }>(points: T[], r: Rect, pad = 0): T[] {
  const b = normRect(r);
  return points.filter((p) => p.x >= b.minX - pad && p.x <= b.maxX + pad && p.y >= b.minY - pad && p.y <= b.maxY + pad);
}

/** Was the pointer moved far enough (in screen pixels) to be a drag rather than a click? */
export function isDrag(dx: number, dy: number, threshold = 4): boolean {
  return Math.abs(dx) > threshold || Math.abs(dy) > threshold;
}

/** The items from `from` to `to` (either order), inclusive, in list order. Just `to` when `from` isn't in the list. */
export function rangeBetween<T, K>(list: T[], keyOf: (t: T) => K, from: K | null, to: K): T[] {
  const j = list.findIndex((t) => keyOf(t) === to);
  if (j < 0) return [];
  const i = from == null ? -1 : list.findIndex((t) => keyOf(t) === from);
  if (i < 0) return [list[j]];
  return list.slice(Math.min(i, j), Math.max(i, j) + 1);
}

export function applySelection<K>(cur: Set<K>, ids: Iterable<K>, mode: SelectMode | 'toggle'): Set<K> {
  const list = [...ids];
  if (mode === 'replace') return new Set(list);
  const next = new Set(cur);
  if (mode === 'toggle') {
    // One click: flip the seat. Several (a whole row): select them all, or clear them all if they were all selected.
    const all = list.length > 0 && list.every((k) => next.has(k));
    for (const k of list) { if (all) next.delete(k); else next.add(k); }
    return next;
  }
  for (const k of list) { if (mode === 'add') next.add(k); else next.delete(k); }
  return next;
}

/** Every seat in the same row of the same section (a table counts as one row). */
export function sameRow<T extends { section: string; row: string | null }>(list: T[], seat: Pick<T, 'section' | 'row'>): T[] {
  return list.filter((s) => s.section === seat.section && (s.row ?? '') === (seat.row ?? ''));
}
