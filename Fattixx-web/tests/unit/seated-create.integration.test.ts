/**
 * Creating an event on a seat map from the create page, against the `fattixx_test` database: Pro only, only maps the
 * organization may use, no ticket needed, the seats copied onto a draft, and no publishing until seats are on sale.
 *   Create the DB once:  DB_NAME=fattixx_test node scripts/db-setup.mjs
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, has: () => false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  getSession: async () => ({ id: "s", user: { id: null, email: "seated@test.local", roles: [] } }),
}));
vi.mock("@/lib/authz", async (original) => {
  const real = await original<typeof import("@/lib/authz")>();
  const { queryOne } = await import("@/lib/db");
  return {
    ...real,
    canAccessEvent: async () => true,
    assertOrg: async (slug: string) => {
      const org = await queryOne(`SELECT * FROM organizations WHERE slug = ?`, [slug]);
      if (!org) throw new Error("Organization not found");
      return { session: { id: "s", user: { id: null, roles: [] } }, org, role: "org_admin", isOrgAdmin: true, isSuperAdmin: false, perms: {} };
    },
  };
});

import { db, execute, query, queryOne, type Row } from "@/lib/db";
import { emptyDraft, type EventDraft } from "@/lib/home/create";
import { publishDraft, saveEventEdits } from "@/lib/home/create-actions";
import { editorData, seatMapsByOrg } from "@/lib/home/create-context";
import { setEventStatus } from "@/lib/events/actions";
import { getEvent } from "@/lib/events/queries";
import { createSeatTier, updateEventSeats } from "@/lib/seating/actions";
import { newRowsSection, type SeatMapLayout } from "@/lib/seating/layout";
import { categoryNames } from "@/lib/site-content/categories";

const tag = randomUUID().slice(0, 8);
const proSlug = `it-map-pro-${tag}`, freeSlug = `it-map-free-${tag}`, otherSlug = `it-map-other-${tag}`;
const layout: SeatMapLayout = { version: 1, width: 600, height: 400, shapes: [], sections: [newRowsSection({ id: "s", name: "Floor", rows: 2, seatsPerRow: 4 })] };
const year = new Date().getFullYear() + 1;
let proId: number, freeId: number, otherId: number, ownMap: number, libraryMap: number, draftMap: number, foreignMap: number, emptyMap: number;
let category: string;

async function insertMap(orgId: number | null, name: string, status: string, library = 0, l: SeatMapLayout = layout): Promise<number> {
  return (await execute(
    `INSERT INTO seat_maps (organization_id, name, venue_name, status, in_library, layout, seat_count) VALUES (?, ?, 'IT Hall', ?, ?, ?, 8)`,
    [orgId, `${name} ${tag}`, status, library, JSON.stringify(l)],
  )).insertId;
}

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  proId = (await execute(`INSERT INTO organizations (slug, name, contact_email, pro_until, verified_at) VALUES (?, 'IT Pro', 'it@test.local', NOW() + INTERVAL 30 DAY, NOW())`, [proSlug])).insertId;
  freeId = (await execute(`INSERT INTO organizations (slug, name, contact_email, verified_at) VALUES (?, 'IT Free', 'it@test.local', NOW())`, [freeSlug])).insertId;
  otherId = (await execute(`INSERT INTO organizations (slug, name, contact_email, pro_until) VALUES (?, 'IT Other', 'it@test.local', NOW() + INTERVAL 30 DAY)`, [otherSlug])).insertId;
  ownMap = await insertMap(proId, "Own", "approved");
  draftMap = await insertMap(proId, "Unapproved", "draft");
  emptyMap = await insertMap(proId, "Empty", "approved", 0, { ...layout, sections: [] });
  foreignMap = await insertMap(otherId, "Foreign", "approved");
  libraryMap = await insertMap(null, "Library", "approved", 1);
  category = (await categoryNames())[0];
});

afterAll(async () => {
  for (const id of [proId, freeId, otherId]) if (id) await execute(`DELETE FROM organizations WHERE id = ?`, [id]);
  await execute(`DELETE FROM seat_maps WHERE name LIKE ?`, [`% ${tag}`]);
  await db.end();
});

function formFor(org: string, mapId: number): FormData {
  const d: EventDraft = {
    ...emptyDraft(), mode: "seated", seatMapId: String(mapId), tickets: [], category, name: `Seated ${tag}`,
    startDate: `${year}-06-12`, startTime: "20:00", endDate: `${year}-06-12`, endTime: "23:00",
    location: { kind: "online", link: "https://meet.example.com/seated" },
  };
  const fd = new FormData();
  fd.set("draft", JSON.stringify({ ...d, gallery: [] }));
  fd.set("org", org);
  return fd;
}

async function create(mapId: number): Promise<number> {
  const r = await publishDraft(undefined, formFor(proSlug, mapId));
  if (!r || !("ok" in r)) throw new Error(`not created: ${r?.error}`);
  return Number(r.manageUrl.split("/").pop());
}

const statusForm = (eventId: number) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ org: proSlug, event_id: String(eventId), status: "published" })) fd.set(k, v);
  return fd;
};
const statusOf = async (id: number) => (await queryOne<Row & { status: string }>(`SELECT status FROM events WHERE id = ?`, [id]))?.status;

describe("which maps the page offers", () => {
  it("lists a Pro organization's approved maps and the library, and nothing for an organization not on Pro", async () => {
    const maps = await seatMapsByOrg([{ id: proId, slug: proSlug }, { id: freeId, slug: freeSlug }]);
    const ids = maps[proSlug].map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([ownMap, libraryMap]));
    expect(ids).not.toContain(draftMap);
    expect(ids).not.toContain(foreignMap);
    expect(maps[freeSlug]).toBeUndefined();
  });
});

describe("creating an event on a map", () => {
  it("is refused for an organization not on Pro", async () => {
    expect(await publishDraft(undefined, formFor(freeSlug, libraryMap))).toEqual({ error: expect.stringContaining("Fattixx Pro") });
  });

  it("is refused for a map the organization can't use", async () => {
    for (const map of [foreignMap, draftMap, 0]) {
      expect(await publishDraft(undefined, formFor(proSlug, map))).toEqual({ error: expect.stringContaining("Choose") });
    }
    expect(await publishDraft(undefined, formFor(proSlug, emptyMap))).toEqual({ error: "This map has no seats." });
    expect(await query(`SELECT id FROM events WHERE organization_id = ?`, [proId])).toHaveLength(0);
  });

  it("saves a draft with the seats copied and no ticket, without asking for one", async () => {
    const id = await create(ownMap);
    expect(await statusOf(id)).toBe("draft");
    expect(await query(`SELECT id FROM ticket_types WHERE event_id = ?`, [id])).toHaveLength(0);
    const seats = await query<Row & { ticket_type_id: number | null }>(`SELECT ticket_type_id FROM event_seats WHERE event_id = ?`, [id]);
    expect(seats).toHaveLength(8);
    expect(seats.every((s) => s.ticket_type_id === null)).toBe(true);
    expect(Number((await queryOne<Row & { seat_map_id: number }>(`SELECT seat_map_id FROM event_seating WHERE event_id = ?`, [id]))?.seat_map_id)).toBe(ownMap);
  });

  it("can use a Venue Library map", async () => {
    expect(await query(`SELECT id FROM event_seats WHERE event_id = ?`, [await create(libraryMap)])).toHaveLength(8);
  });
});

describe("publishing an event made on a map", () => {
  let id: number;
  const fields = (extra: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ org: proSlug, event_id: String(id), ...extra })) fd.set(k, v);
    return fd;
  };

  beforeAll(async () => { id = await create(ownMap); });

  it("waits until seats are on sale", async () => {
    expect(await setEventStatus(statusForm(id))).toEqual({ error: expect.stringContaining("Seating tab") });
    // a pricing tier with no seats has nothing to sell either
    expect(await createSeatTier(undefined, fields({ name: "Orchestra", price: "45" }))).toMatchObject({ ok: true });
    expect(await setEventStatus(statusForm(id))).toEqual({ error: expect.stringContaining("Seating tab") });
    expect(await statusOf(id)).toBe("draft");
  });

  it("opens on the page as a seated event, and saving it adds no general admission ticket", async () => {
    const editor = await editorData((await getEvent(proId, id))!);
    expect(editor.draft.mode).toBe("seated");
    expect(editor.draft.tickets).toEqual([]);
    expect(editor.seatMapName).toBe(`Own ${tag}`);
    const fd = formFor(proSlug, 0);
    const start = `${year}-06-12T20:00`;
    fd.set("draft", JSON.stringify({ ...editor.draft, cover: null, gallery: [], name: `Renamed ${tag}` }));
    fd.set("event_id", String(id));
    fd.set("original_start", start);
    expect(await saveEventEdits(undefined, fd)).toMatchObject({ ok: true });
    const types = await query<Row & { seated: number }>(`SELECT seated FROM ticket_types WHERE event_id = ?`, [id]);
    expect(types.map((t) => Number(t.seated))).toEqual([1]);

    fd.set("save_as", "publish");
    expect(await saveEventEdits(undefined, fd)).toEqual({ error: expect.stringContaining("Seating tab") });
    expect(await statusOf(id)).toBe("draft");
  });

  it("goes live once seats are assigned to a tier", async () => {
    const tier = await queryOne<Row & { id: number }>(`SELECT id FROM ticket_types WHERE event_id = ?`, [id]);
    const seats = await query<Row & { id: number }>(`SELECT id FROM event_seats WHERE event_id = ?`, [id]);
    expect(await updateEventSeats(fields({ op: "assign", tier_id: String(tier!.id), seat_ids: seats.map((s) => s.id).join(",") }))).toMatchObject({ ok: true });
    expect(await setEventStatus(statusForm(id))).toMatchObject({ ok: true });
    expect(await statusOf(id)).toBe("published");
  });
});
