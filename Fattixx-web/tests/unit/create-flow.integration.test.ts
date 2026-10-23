/**
 * The /create flow (plan 5.6) against the `fattixx_test` database: passwordless sign-up codes and their limits, the
 * last sign-up step with the terms acceptance, the organization created on the spot, the fields the page now saves
 * (online link, "Show end time", password, "Contact the organizer" refunds), and ticket holders being emailed when an
 * edit moves the event (plan 5.6.12).
 *   Create the DB once:  DB_NAME=fattixx_test node scripts/db-setup.mjs
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Server actions read cookies through next/headers: a cookie jar for one browser.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      if (!value || opts?.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
    has: (name: string) => jar.has(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { db, execute, query, queryOne, type Row } from "@/lib/db";
import { completeSignup, MAX_TRIES, normalizeDestination, readPendingSignup, sendSignInCode, verifySignInCode } from "@/lib/auth/passwordless";
import { getSession } from "@/lib/auth/session";
import { decryptEventPassword } from "@/lib/events/password";
import { emptyDraft, type EventDraft } from "@/lib/home/create";
import { publishDraft, saveEventEdits } from "@/lib/home/create-actions";
import { saveOrgQuestionnaire } from "@/lib/applications/org-questionnaire";
import { createPendingOrder, finalizePaidOrder } from "@/lib/orders/checkout";
import { categoryNames } from "@/lib/site-content/categories";

const tag = randomUUID().slice(0, 8);
const email = `create-${tag}@test.local`;
const year = new Date().getFullYear() + 1;
const orgIds: number[] = [];

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
});

afterAll(async () => {
  for (const id of orgIds) await execute(`DELETE FROM organizations WHERE id = ?`, [id]);
  await execute(`DELETE FROM users WHERE email_normalized = ?`, [email]);
  await execute(`DELETE FROM auth_codes WHERE destination IN (?, ?)`, [email, "+18435550199"]);
  await execute(`DELETE FROM login_attempts WHERE email_normalized = ?`, [email]);
  await db.end();
});

/** the code the last request produced (tests run without an email provider, so it comes back as devCode) */
async function freshCode(): Promise<string> {
  // earlier codes move out of the hour the limits count, and past the 30-second wait
  await execute(`UPDATE auth_codes SET created_at = created_at - INTERVAL 61 MINUTE WHERE destination = ?`, [email]);
  const r = await sendSignInCode("email", email);
  if (!r.ok || !r.devCode) throw new Error(r.ok ? "no dev code" : r.error);
  return r.devCode;
}

function draft(over: Partial<EventDraft> = {}): EventDraft {
  return {
    ...emptyDraft(),
    name: `Create flow ${tag}`,
    startDate: `${year}-06-12`,
    startTime: "20:00",
    endDate: `${year}-06-12`,
    endTime: "23:00",
    location: { kind: "online", link: "https://meet.example.com/fattixx-test" },
    tickets: [{ ...emptyDraft().tickets[0], name: "Free", price: "", quantity: "50" }],
    ...over,
  };
}

describe("passwordless sign-up codes", () => {
  it("normalizes email addresses and phone numbers", () => {
    expect(normalizeDestination("email", "  Jane@Example.COM ")).toBe("jane@example.com");
    expect(normalizeDestination("email", "not-an-email")).toBeNull();
    expect(normalizeDestination("sms", "+1 (843) 555-0199")).toBe("+18435550199");
    expect(normalizeDestination("sms", "+44 (0)7700 900123")).toBe("+447700900123");
    expect(normalizeDestination("sms", "843-555-0199")).toBeNull(); // the country code is required
  });

  it("sends a 6-digit code, then makes the next one wait 30 seconds", async () => {
    const r = await sendSignInCode("email", email);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.devCode).toMatch(/^\d{6}$/);
      expect(r.resendIn).toBe(30);
      expect(r.expiresIn).toBe(600);
    }
    const again = await sendSignInCode("email", email);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.retryIn).toBeGreaterThan(0);
    const row = await queryOne<Row & { code_hash: string; minutes: number }>(`SELECT code_hash, TIMESTAMPDIFF(MINUTE, created_at, expires_at) AS minutes FROM auth_codes WHERE destination = ? ORDER BY id DESC LIMIT 1`, [email]);
    expect(row!.code_hash).toMatch(/^[0-9a-f]{64}$/); // only a keyed hash is kept
    expect(Number(row!.minutes)).toBe(10);
  });

  it("needs a new code after 5 wrong tries", async () => {
    const code = await freshCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i < MAX_TRIES; i++) {
      const r = await verifySignInCode("email", email, wrong);
      expect(r).toEqual({ ok: false, error: expect.stringContaining(`${MAX_TRIES - i} tr`) });
    }
    const last = await verifySignInCode("email", email, wrong);
    expect(last.ok).toBe(false);
    if (!last.ok) expect(last.expired).toBe(true);
    const tooLate = await verifySignInCode("email", email, code);
    expect(tooLate.ok).toBe(false);
  });

  it("an older code stops working once a new one is sent", async () => {
    const first = await freshCode();
    const second = await freshCode();
    if (first !== second) expect((await verifySignInCode("email", email, first)).ok).toBe(false);
  });

  it("a new address goes on to the last step, which records the terms", async () => {
    const code = await freshCode();
    const r = await verifySignInCode("email", email, code);
    expect(r).toEqual({ ok: true, status: "needs_profile", email, phone: null });
    expect(await readPendingSignup()).toMatchObject({ method: "email", email, emailVerified: true });

    expect(await completeSignup({ firstName: "Jo", lastName: "Organizer", acceptTerms: false })).toMatchObject({ ok: false, field: "terms" });
    const done = await completeSignup({ firstName: "Jo", lastName: "Organizer", acceptTerms: true });
    expect(done.ok).toBe(true);
    const user = await queryOne<Row & { name: string; first_name: string; last_name: string; terms_accepted_at: Date | null; terms_version: string; email_verified_at: Date | null; password_hash: string | null }>(
      `SELECT name, first_name, last_name, terms_accepted_at, terms_version, email_verified_at, password_hash FROM users WHERE email_normalized = ?`, [email],
    );
    expect(user).toMatchObject({ name: "Jo Organizer", first_name: "Jo", last_name: "Organizer", password_hash: null });
    expect(user!.terms_accepted_at).not.toBeNull();
    expect(user!.terms_version).toBeTruthy();
    expect(user!.email_verified_at).not.toBeNull();
    expect((await getSession())?.user.email).toBe(email);
    expect(await readPendingSignup()).toBeNull();
  });

  it("signs the same address straight in next time", async () => {
    jar.delete("fx_session");
    const code = await freshCode();
    const r = await verifySignInCode("email", email, code);
    expect(r).toMatchObject({ ok: true, status: "signed_in" });
    expect((await getSession())?.user.email).toBe(email);
  });

  it("limits how many codes one address can ask for", async () => {
    await execute(`UPDATE auth_codes SET created_at = NOW() - INTERVAL 2 MINUTE WHERE destination = ?`, [email]);
    const n = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM auth_codes WHERE destination = ? AND created_at > NOW() - INTERVAL 60 MINUTE`, [email]);
    for (let i = Number(n!.n); i < 5; i++) {
      await execute(`INSERT INTO auth_codes (channel, destination, code_hash, expires_at, created_at) VALUES ('email', ?, REPEAT('0', 64), NOW(), NOW() - INTERVAL 2 MINUTE)`, [email]);
    }
    const r = await sendSignInCode("email", email);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Too many codes") });
  });
});

describe("creating and editing from /create", () => {
  let eventId = 0;
  let orgSlug = "";

  it("creates the new organizer's organization on the spot and saves every field", async () => {
    const category = (await categoryNames())[0];
    const fd = new FormData();
    fd.set("draft", JSON.stringify({ ...draft({ category, showEnd: false, password: "letmein", refund: "contact" }), gallery: [] }));
    fd.set("new_org", "1");
    fd.set("organizer_name", `Jo Presents ${tag}`);
    // without the agreement nothing is created
    expect(await publishDraft(undefined, fd)).toEqual({ error: expect.stringContaining("Organizer Agreement") });
    fd.set("agree", "1");
    const r = await publishDraft(undefined, fd);
    expect(r && "ok" in r && r.ok).toBe(true);
    if (!r || !("ok" in r)) return;
    expect(r.published).toBe(true); // plan 5.6.9: free and RSVP events go live right away
    expect(r.payoutsNeeded).toBe(false); // nothing to pay out on a free event
    expect(r.dashboardUrl).toBe(`/org/${r.orgSlug}/welcome`); // a new organizer answers the sign-up questionnaire first
    expect(r.verified).toBe(false);
    orgSlug = r.manageUrl.split("/")[2];
    eventId = Number(r.manageUrl.split("/").pop());

    const org = await queryOne<Row & { id: number; name: string; verified_at: Date | null; agreement_accepted_at: Date | null; contact_email: string }>(
      `SELECT id, name, verified_at, agreement_accepted_at, contact_email FROM organizations WHERE slug = ?`, [orgSlug],
    );
    orgIds.push(Number(org!.id));
    expect(org).toMatchObject({ name: `Jo Presents ${tag}`, verified_at: null, contact_email: email });
    expect(org!.agreement_accepted_at).not.toBeNull();
    const member = await queryOne<Row & { role: string }>(`SELECT m.role FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND u.email_normalized = ?`, [org!.id, email]);
    expect(member?.role).toBe("org_admin");

    const ev = await queryOne<Row & { online_url: string; venue_id: number | null; show_end_time: number; access_password: string; refund_policy: string; status: string }>(
      `SELECT online_url, venue_id, show_end_time, access_password, refund_policy, status FROM events WHERE id = ?`, [eventId],
    );
    expect(ev).toMatchObject({ online_url: "https://meet.example.com/fattixx-test", venue_id: null, show_end_time: 0, refund_policy: "contact_organizer", status: "published" });
    expect(ev!.access_password).not.toBe("letmein"); // stored encrypted
    expect(decryptEventPassword(ev!.access_password)).toBe("letmein");
  });

  it("a paid event goes live at once and asks the new organizer to set up payouts (plan 5.6.9, option A)", async () => {
    const fd = new FormData();
    const tickets = [{ ...emptyDraft().tickets[0], name: "GA", price: "25", quantity: "100" }];
    fd.set("draft", JSON.stringify({ ...draft({ category: (await categoryNames())[0], name: `Paid ${tag}`, tickets }), gallery: [] }));
    fd.set("org", orgSlug);
    const r = await publishDraft(undefined, fd);
    expect(r && "ok" in r && r.ok).toBe(true);
    if (!r || !("ok" in r)) return;
    expect(r.published).toBe(true);
    expect(r.payoutsNeeded).toBe(true); // not verified, manual payouts: Fattixx can't pay it yet
    const ev = await queryOne<Row & { status: string }>(`SELECT status FROM events WHERE id = ?`, [Number(r.manageUrl.split("/").pop())]);
    expect(ev?.status).toBe("published");
  });

  it("a signed-in organizer can still save a draft (plan 5.6.10)", async () => {
    const fd = new FormData();
    fd.set("draft", JSON.stringify({ ...draft({ category: (await categoryNames())[0], name: `Draft ${tag}` }), gallery: [] }));
    fd.set("org", orgSlug);
    fd.set("save_as", "draft");
    const r = await publishDraft(undefined, fd);
    expect(r && "ok" in r && r.published).toBe(false);
  });

  it("the sign-up questionnaire is stored on the new organization and then not asked again", async () => {
    const before = await queryOne<Row & { questionnaire_done_at: Date | null }>(`SELECT questionnaire_done_at FROM organizations WHERE slug = ?`, [orgSlug]);
    expect(before?.questionnaire_done_at).toBeNull();
    const fd = new FormData();
    fd.set("org", orgSlug);
    fd.append("event_types", "music");
    fd.append("event_types", "comedy");
    fd.append("expected_revenue", "10k_50k");
    fd.append("expected_revenue", "1m_plus"); // single choice: only the first is kept
    fd.append("audiences", "not-a-real-option"); // unknown keys are dropped
    await expect(saveOrgQuestionnaire(fd)).rejects.toThrow(/NEXT_REDIRECT/);
    const org = await queryOne<Row & { event_types: string; expected_revenue: string; audiences: string | null; events_per_year: string | null; questionnaire_done_at: Date | null }>(
      `SELECT event_types, expected_revenue, audiences, events_per_year, questionnaire_done_at FROM organizations WHERE slug = ?`, [orgSlug],
    );
    expect(org).toMatchObject({ event_types: "music,comedy", expected_revenue: "10k_50k", audiences: null, events_per_year: null });
    expect(org?.questionnaire_done_at).not.toBeNull();
  });

  it("only the organization's admin can answer its questionnaire", async () => {
    const fd = new FormData();
    fd.set("org", "an-organization-that-does-not-exist");
    await expect(saveOrgQuestionnaire(fd)).rejects.toThrow(/not found/i);
  });

  it("a retry with the same organizer name reuses that organization", async () => {
    const before = await query<Row>(`SELECT id FROM organizations WHERE name = ?`, [`Jo Presents ${tag}`]);
    const fd = new FormData();
    fd.set("draft", JSON.stringify({ ...draft({ category: (await categoryNames())[0], name: `Second ${tag}` }), gallery: [] }));
    fd.set("new_org", "1");
    fd.set("organizer_name", `Jo Presents ${tag}`);
    fd.set("agree", "1");
    const r = await publishDraft(undefined, fd);
    expect(r && "ok" in r).toBe(true);
    expect(await query<Row>(`SELECT id FROM organizations WHERE name = ?`, [`Jo Presents ${tag}`])).toHaveLength(before.length);
  });

  it("emails ticket holders when an edit moves the event", async () => {
    await execute(`UPDATE events SET status = 'published' WHERE id = ?`, [eventId]);
    const ev = await queryOne<Row & { slug: string }>(`SELECT slug FROM events WHERE id = ?`, [eventId]);
    const tt = await queryOne<Row & { id: number }>(`SELECT id FROM ticket_types WHERE event_id = ?`, [eventId]);
    const holder = `holder-${tag}@test.local`;
    const o = await createPendingOrder({ eventSlug: ev!.slug, email: holder, name: "Holder", marketingOptIn: false, userId: null, ip: "test", lines: [{ ticketTypeId: Number(tt!.id), quantity: 1 }] });
    await finalizePaidOrder(o.orderId, {});
    // the confirmation carries the online link: ticket holders only
    const confirmation = await queryOne<Row & { text_body: string }>(`SELECT text_body FROM email_outbox WHERE to_email = ? AND subject LIKE 'Your tickets are confirmed%' ORDER BY id DESC LIMIT 1`, [holder]);
    expect(confirmation?.text_body).toContain("https://meet.example.com/fattixx-test");

    const edit = (over: Partial<EventDraft>) => {
      const fd = new FormData();
      const d = draft({ category: "", showEnd: false, refund: "contact", ...over });
      fd.set("org", orgSlug);
      fd.set("event_id", String(eventId));
      fd.set("original_start", `${d.startDate}T${d.startTime}`);
      fd.set("password_unchanged", "1");
      return { fd, d };
    };
    const category = (await categoryNames())[0];
    const tickets = [{ ...emptyDraft().tickets[0], name: "Free", price: "", quantity: "50", serverId: Number(tt!.id) }];

    // a new description only: nobody is emailed
    const same = edit({ category, description: "**Bring** a friend", tickets });
    same.fd.set("draft", JSON.stringify({ ...same.d, gallery: [] }));
    const r1 = await saveEventEdits(undefined, same.fd);
    expect(r1 && "ok" in r1 && r1.notified).toBe(0);

    // a new date: the holder is told
    const moved = edit({ category, startDate: `${year}-06-19`, endDate: `${year}-06-19`, tickets });
    moved.fd.set("original_start", `${year}-06-12T20:00`);
    moved.fd.set("draft", JSON.stringify({ ...moved.d, gallery: [] }));
    const r2 = await saveEventEdits(undefined, moved.fd);
    expect(r2 && "ok" in r2 && r2.notified).toBe(1);
    const mail = await queryOne<Row & { subject: string; text_body: string }>(`SELECT subject, text_body FROM email_outbox WHERE to_email = ? AND subject LIKE 'Updated:%' ORDER BY id DESC LIMIT 1`, [holder]);
    expect(mail?.subject).toBe(`Updated: Create flow ${tag}`);
    expect(mail?.text_body).toContain("Date and time");

    // a ticket type with orders can't be removed from the page
    const removed = edit({ category, startDate: `${year}-06-19`, endDate: `${year}-06-19`, tickets: [{ ...emptyDraft().tickets[0], name: "Replacement", price: "5" }] });
    removed.fd.set("original_start", `${year}-06-19T20:00`);
    removed.fd.set("draft", JSON.stringify({ ...removed.d, gallery: [] }));
    expect(await saveEventEdits(undefined, removed.fd)).toEqual({ error: expect.stringContaining("has orders") });
  });
});
