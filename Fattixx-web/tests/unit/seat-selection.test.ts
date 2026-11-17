/** The seat selection shortcuts shared by the builder, the Seating tab and the comp-ticket picker (src/lib/seating/selection.ts). */
import { describe, expect, it } from "vitest";
import { applySelection, boxMode, isDrag, pointsInRect, rangeBetween, sameRow } from "@/lib/seating/selection";

const keys = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
const seats = [
  { id: 1, section: "Floor", row: "A", x: 0, y: 0 }, { id: 2, section: "Floor", row: "A", x: 20, y: 0 }, { id: 3, section: "Floor", row: "A", x: 40, y: 0 },
  { id: 4, section: "Floor", row: "B", x: 0, y: 30 }, { id: 5, section: "Floor", row: "B", x: 20, y: 30 },
  { id: 6, section: "Table 1", row: null, x: 200, y: 200 }, { id: 7, section: "Table 1", row: null, x: 220, y: 200 },
];

describe("box selection", () => {
  it("picks the seats inside the box, either drag direction, counting seats it touches", () => {
    expect(pointsInRect(seats, { x0: -5, y0: -5, x1: 25, y1: 5 }).map((s) => s.id)).toEqual([1, 2]);
    expect(pointsInRect(seats, { x1: -5, y1: -5, x0: 25, y0: 5 }).map((s) => s.id)).toEqual([1, 2]);
    expect(pointsInRect(seats, { x0: 22, y0: 2, x1: 30, y1: 28 }, 4).map((s) => s.id)).toEqual([2, 5]);
  });

  it("replaces by default, adds with Shift or Ctrl/⌘, removes with Alt", () => {
    expect(boxMode(keys)).toBe("replace");
    expect(boxMode({ ...keys, shiftKey: true })).toBe("add");
    expect(boxMode({ ...keys, metaKey: true })).toBe("add");
    expect(boxMode({ ...keys, altKey: true, shiftKey: true })).toBe("remove");
    const cur = new Set([1, 2]);
    expect([...applySelection(cur, [3], "replace")]).toEqual([3]);
    expect([...applySelection(cur, [2, 3], "add")]).toEqual([1, 2, 3]);
    expect([...applySelection(cur, [2, 3], "remove")]).toEqual([1]);
    expect([...cur]).toEqual([1, 2]);
  });

  it("is a click until the pointer moves a few pixels", () => {
    expect(isDrag(3, -3)).toBe(false);
    expect(isDrag(5, 0)).toBe(true);
  });
});

describe("Shift+click ranges, rows and toggling", () => {
  it("selects everything between the last seat clicked and this one, in map order", () => {
    expect(rangeBetween(seats, (s) => s.id, 2, 5).map((s) => s.id)).toEqual([2, 3, 4, 5]);
    expect(rangeBetween(seats, (s) => s.id, 5, 2).map((s) => s.id)).toEqual([2, 3, 4, 5]);
    expect(rangeBetween(seats, (s) => s.id, null, 3).map((s) => s.id)).toEqual([3]);
    expect(rangeBetween(seats, (s) => s.id, 99, 3).map((s) => s.id)).toEqual([3]);
  });

  it("finds a seat's whole row; a table is one row", () => {
    expect(sameRow(seats, seats[1]).map((s) => s.id)).toEqual([1, 2, 3]);
    expect(sameRow(seats, seats[6]).map((s) => s.id)).toEqual([6, 7]);
  });

  it("toggles one seat, and a row all on or (when all were on) all off", () => {
    expect([...applySelection(new Set([1]), [1], "toggle")]).toEqual([]);
    expect([...applySelection(new Set([1]), [1, 2, 3], "toggle")]).toEqual([1, 2, 3]);
    expect([...applySelection(new Set([1, 2, 3]), [1, 2, 3], "toggle")]).toEqual([]);
  });
});
