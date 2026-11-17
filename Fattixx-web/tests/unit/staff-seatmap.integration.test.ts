/**
 * Seat maps a Super Admin builds without an organizer's request, and the builder's autosave, against the `fattixx_test`
 * database: create, autosave (no history entry), save (clears the autosave), publish, back to draft, delete; maps that
 * belong to a request can't be edited this way, and only a Super Admin may.
 *   Create the DB once:  DB_NAME=fattixx_test node scripts/db-setup.mjs
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const role = vi.hoisted(() => ({ current: "super_admin" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, has: () => false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); } }));
vi.mock("@/lib/auth/guard", async (original) => {
  const real = await original<typeof import("@/lib/auth/guard")>();
  return {
    ...real,
    assertPlatformRole: async (allowed: string[]) => {
      if (!allowed.includes(role.current)) throw new Error("Forbidden");
      return { id: "s", user: { id: null, name: "IT Admin", roles: [role.current] } };
    },
  };
});

import { db, execute, query, queryOne, type Row } from "@/lib/db";
import { autosaveSeatMapLayout, saveSeatMapLayout, staffDeleteMap, staffMapToDraft, staffPublishMap } from "@/lib/seating/actions";
import { createStaffMap } from "@/lib/seating/requests";
import { getSeatMap, listStaffDraftMaps, listUsableMaps, mapAutosave } from "@/lib/seating/queries";
import { emptyLayout, newRowsSection, type SeatMapLayout } from "@/lib/seating/layout";

const tag = randomUUID().slice(0, 8);
let orgId: number, mapId: number, libraryMapId: number, requestMapId: number;

const form = (fields: Record<string, string | number>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
  return fd;
};
const withRows: SeatMapLayout = { ...emptyLayout(), sections: [newRowsSection({ id: "a", name: "Stalls", rows: 3, seatsPerRow: 10 })] };
const changes = async (id: number) => (await query<Row & { action: string }>(`SELECT action FROM seat_map_changes WHERE seat_map_id = ? ORDER BY id`, [id])).map((r) => r.action);

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  orgId = (await execute(`INSERT INTO organizations (slug, name, contact_email, pro_until) VALUES (?, 'IT Staff Maps', 'it@test.local', NOW() + INTERVAL 30 DAY)`, [`it-smap-${tag}`])).insertId;
  mapId = await createStaffMap({ organizationId: orgId, userId: null as unknown as number, mapName: `Hall ${tag}`, venueName: "The Hall", venueCity: "Austin", venueRegion: "TX", floorPlan: null });
  libraryMapId = await createStaffMap({ organizationId: null, userId: null as unknown as number, mapName: `Library ${tag}`, venueName: "Open Air", venueCity: null, venueRegion: null, floorPlan: null });
  // A map that belongs to an organizer's request.
  requestMapId = (await execute(`INSERT INTO seat_maps (organization_id, name, venue_name, status, layout) VALUES (?, ?, 'Req Venue', 'draft', ?)`, [orgId, `Req ${tag}`, JSON.stringify(emptyLayout())])).insertId;
  await execute(`INSERT INTO seat_map_requests (organization_id, venue_name, map_name, status, seat_map_id, fee_cents, fee_status) VALUES (?, 'Req Venue', ?, 'in_progress', ?, 0, 'waived')`, [orgId, `Req ${tag}`, requestMapId]);
});

afterAll(async () => {
  await execute(`DELETE FROM seat_maps WHERE id IN (?, ?, ?)`, [mapId, libraryMapId, requestMapId]);
  if (orgId) await execute(`DELETE FROM organizations WHERE id = ?`, [orgId]);
  await db.end();
});

describe("a Super Admin builds a map without a request", () => {
  it("starts an empty draft, listed among the staff drafts", async () => {
    const map = (await getSeatMap(mapId))!;
    expect(map).toMatchObject({ status: "draft", organization_id: orgId, request_id: null, seat_count: 0 });
    expect((await listStaffDraftMaps()).map((m) => Number(m.id))).toEqual(expect.arrayContaining([mapId, libraryMapId]));
    expect((await listStaffDraftMaps()).map((m) => Number(m.id))).not.toContain(requestMapId);
    expect(await changes(mapId)).toEqual(["created"]);
  });

  it("autosaves work in progress without touching the saved layout or the history", async () => {
    expect(await autosaveSeatMapLayout(form({ map_id: mapId, layout: JSON.stringify(withRows), name: `Hall ${tag} v2`, client_at: 1234 }))).toMatchObject({ ok: true });
    const map = (await getSeatMap(mapId))!;
    expect(map.seat_count).toBe(0);
    expect(mapAutosave(map)).toMatchObject({ name: `Hall ${tag} v2`, at: 1234, layout: { sections: [{ name: "Stalls", rows: 3 }] } });
    expect(await changes(mapId)).toEqual(["created"]);
    // A layout that doesn't validate isn't stored on the server (the browser keeps its own copy).
    const dup = { ...withRows, sections: [...withRows.sections, newRowsSection({ id: "b", name: "Stalls" })] };
    expect(await autosaveSeatMapLayout(form({ map_id: mapId, layout: JSON.stringify(dup), name: "x" }))).toMatchObject({ error: expect.stringMatching(/Two sections/) });
    expect(mapAutosave((await getSeatMap(mapId))!)?.name).toBe(`Hall ${tag} v2`);
  });

  it("won't publish while the builder has unsaved changes", async () => {
    expect(await staffPublishMap(form({ map_id: mapId }))).toMatchObject({ error: expect.stringMatching(/unsaved changes/) });
  });

  it("saves: the layout, the name and a history entry, and clears the autosave", async () => {
    expect(await saveSeatMapLayout(undefined, form({ map_id: mapId, layout: JSON.stringify(withRows), name: `Hall ${tag} v2` }))).toMatchObject({ ok: true });
    const map = (await getSeatMap(mapId))!;
    expect(map).toMatchObject({ seat_count: 30, name: `Hall ${tag} v2`, draft_layout: null });
    expect(await changes(mapId)).toEqual(["created", "saved"]);
    // An autosave of exactly the saved map leaves nothing unsaved.
    expect(await autosaveSeatMapLayout(form({ map_id: mapId, layout: JSON.stringify(withRows), name: `Hall ${tag} v2` }))).toMatchObject({ ok: true });
    expect((await getSeatMap(mapId))!.draft_layout).toBeNull();
  });

  it("publishes for its organization, optionally in the library; a map for no organization is always listed", async () => {
    expect(await staffPublishMap(form({ map_id: mapId, listed: 0 }))).toMatchObject({ ok: true });
    expect((await getSeatMap(mapId))!).toMatchObject({ status: "approved", in_library: 0 });
    expect((await listUsableMaps(orgId)).map((m) => Number(m.id))).toContain(mapId);
    expect(await staffPublishMap(form({ map_id: libraryMapId }))).toMatchObject({ error: expect.stringMatching(/no seats/) });
    await saveSeatMapLayout(undefined, form({ map_id: libraryMapId, layout: JSON.stringify(withRows), name: "" }));
    expect(await staffPublishMap(form({ map_id: libraryMapId, listed: 0 }))).toMatchObject({ ok: true });
    expect((await getSeatMap(libraryMapId))!).toMatchObject({ status: "approved", in_library: 1 });
  });

  it("can't be edited once published, until it goes back to draft (only while no event uses it)", async () => {
    expect(await saveSeatMapLayout(undefined, form({ map_id: mapId, layout: JSON.stringify(emptyLayout()), name: "" }))).toMatchObject({ error: expect.stringMatching(/published/) });
    expect(await staffMapToDraft(form({ map_id: mapId }))).toMatchObject({ ok: true });
    expect((await getSeatMap(mapId))!).toMatchObject({ status: "draft", in_library: 0 });
    const eventId = (await execute(
      `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'Uses map', NOW() + INTERVAL 30 DAY, 'UTC', 'draft', 'public', 'buyer_pays')`, [orgId, `it-smap-ev-${tag}`],
    )).insertId;
    await execute(`INSERT INTO event_seating (event_id, seat_map_id, layout) VALUES (?, ?, ?)`, [eventId, libraryMapId, JSON.stringify(withRows)]);
    expect(await staffMapToDraft(form({ map_id: libraryMapId }))).toMatchObject({ error: expect.stringMatching(/1 event uses this map/) });
  });

  it("leaves maps of a request to the request page, and is for Super Admins only", async () => {
    expect(await autosaveSeatMapLayout(form({ map_id: requestMapId, layout: JSON.stringify(withRows), name: "" }))).toMatchObject({ error: expect.stringMatching(/request/) });
    expect(await staffPublishMap(form({ map_id: requestMapId }))).toMatchObject({ error: expect.stringMatching(/request/) });
    role.current = "support";
    try {
      expect(await saveSeatMapLayout(undefined, form({ map_id: mapId, layout: JSON.stringify(withRows), name: "" }))).toMatchObject({ error: "Forbidden" });
    } finally { role.current = "super_admin"; }
  });

  it("deletes a draft (with its history)", async () => {
    await expect(staffDeleteMap(form({ map_id: mapId }))).rejects.toMatchObject({ to: "/admin/seating" });
    expect(await getSeatMap(mapId)).toBeNull();
    expect(await queryOne(`SELECT id FROM seat_map_changes WHERE seat_map_id = ?`, [mapId])).toBeNull();
  });
});
