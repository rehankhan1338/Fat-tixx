import { describe, expect, it } from "vitest";
import {
  diffLayouts, drawingFor, emptyLayout, expandLayout, newRowsSection, newTableSection, parseLayout, rowLabels, seatCount, sectionSeats, type SeatMapLayout,
} from "@/lib/seating/layout";

const layout = (over: Partial<SeatMapLayout> = {}): SeatMapLayout => ({ ...emptyLayout(), ...over });

describe("seat map layouts", () => {
  it("labels rows with letters, numbers, and optionally skips I and O", () => {
    expect(rowLabels("A", 3)).toEqual(["A", "B", "C"]);
    expect(rowLabels("Y", 4)).toEqual(["Y", "Z", "AA", "AB"]);
    expect(rowLabels("1", 3)).toEqual(["1", "2", "3"]);
    expect(rowLabels("G", 4, true)).toEqual(["G", "H", "J", "K"]);
    expect(rowLabels("N", 3, true)).toEqual(["N", "P", "Q"]);
  });

  it("generates rows of seats with stable keys, numbering and labels", () => {
    const sec = newRowsSection({ id: "orch", name: "Orchestra", rows: 2, seatsPerRow: 3, firstSeat: 101 });
    const seats = expandLayout(layout({ sections: [sec] }));
    expect(seats).toHaveLength(6);
    expect(seats[0]).toMatchObject({ key: "orch:A:101", row: "A", number: "101", label: "Orchestra · Row A · Seat 101", sort: 0 });
    expect(seats[5].key).toBe("orch:B:103");
    // right-to-left numbering puts the lowest number on the right
    const rtl = sectionSeats({ ...sec, numbering: "rtl" });
    expect(rtl[0].number).toBe("103");
    expect(rtl[0].x).toBeLessThan(rtl[2].x);
  });

  it("takes out removed seats and keeps accessibility marks", () => {
    const sec = newRowsSection({ id: "s1", name: "Floor", rows: 1, seatsPerRow: 4, removed: ["A-2"], access: { "A-1": "wheelchair", "A-3": "companion" } });
    const seats = expandLayout(layout({ sections: [sec] }));
    expect(seats.map((s) => s.number)).toEqual(["1", "3", "4"]);
    expect(seats[0].access).toBe("wheelchair");
    expect(seats[1].access).toBe("companion");
    expect(seatCount(layout({ sections: [sec] }))).toBe(3);
  });

  it("puts table seats around the table, numbered from 1", () => {
    const t = newTableSection({ id: "t5", name: "Table 5", seats: 6, x: 100, y: 100 });
    const seats = sectionSeats(t);
    expect(seats.map((s) => s.label)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Table 5 · Seat ${n}`));
    for (const s of seats) expect(Math.hypot(s.x - 100, s.y - 100)).toBeGreaterThan(20);
    expect(drawingFor(layout({ sections: [t] })).tables).toHaveLength(1);
  });

  it("validates and cleans what the builder sends", () => {
    const ok = parseLayout({ width: 99999, sections: [{ id: "a", kind: "rows", name: "  Balcony ", rows: 500, seatsPerRow: 10, firstRow: "a", removed: ["A-1", "bogus", "A-11"], access: { "A-2": "wheelchair", "A-3": "vip" } }] });
    expect("layout" in ok).toBe(true);
    if (!("layout" in ok)) return;
    const sec = ok.layout.sections[0];
    expect(ok.layout.width).toBe(6000);
    expect(sec.name).toBe("Balcony");
    expect(sec.kind === "rows" && sec.rows).toBe(100);
    expect(sec.kind === "rows" && sec.firstRow).toBe("A");
    expect(sec.removed).toEqual(["A-1"]);
    expect(sec.access).toEqual({ "A-2": "wheelchair" });
  });

  it("refuses duplicate section names, unnamed sections and oversized maps", () => {
    expect(parseLayout({ sections: [{ kind: "rows", name: "A" }, { kind: "table", name: "a" }] })).toEqual({ error: expect.stringMatching(/Two sections/) });
    expect(parseLayout({ sections: [{ kind: "rows", name: "" }] })).toEqual({ error: expect.stringMatching(/needs a name/) });
    const big = Array.from({ length: 3 }, (_, i) => ({ kind: "rows", name: `S${i}`, rows: 100, seatsPerRow: 200 }));
    expect(parseLayout({ sections: big })).toEqual({ error: expect.stringMatching(/at most/) });
  });

  it("describes every change between two saves", () => {
    const a = newRowsSection({ id: "a", name: "Orchestra", rows: 5 });
    const before = layout({ sections: [a] });
    const after = layout({
      width: 1400,
      sections: [{ ...a, rows: 6, x: a.x + 20, removed: ["A-1", "A-2"], access: { "B-1": "wheelchair" } }, newTableSection({ id: "t", name: "Table 1", seats: 8 })],
      shapes: [{ id: "st", kind: "stage", x: 0, y: 0, w: 300, h: 60, text: "Stage" }],
    });
    const lines = diffLayouts(before, after);
    expect(lines).toEqual(expect.arrayContaining([
      "Canvas 1200×800 → 1400×800",
      "Added table “Table 1” (8 seats)",
      "“Orchestra”: rows 5 → 6",
      "Moved “Orchestra”",
      "“Orchestra”: took out 2 seats (A-1, A-2)",
      "“Orchestra”: marked 1 seat as wheelchair space (B-1)",
      "Added stage “Stage”",
    ]));
    expect(diffLayouts(after, after)).toEqual([]);
  });
});
