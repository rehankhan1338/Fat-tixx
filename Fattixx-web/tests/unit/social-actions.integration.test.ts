/**
 * Social & Community server actions (plan section 11) against `fattixx_test`, called as different signed-in people:
 * permissions, validation and edge cases for profiles, privacy, follows, blocks, the guest list, the event feed,
 * reports and moderation, referral offers and invitations, organizer settings, audience messages and account deletion.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const who = vi.hoisted(() => ({ current: null as null | { id: number; email: string; name: string; roles: string[] } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, has: () => false, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); } }));
vi.mock("@/lib/auth/session", async (original) => {
  const real = await original<typeof import("@/lib/auth/session")>();
  return {
    ...real,
    getSession: async () => who.current && ({
      id: "vitest", via: "cookie", createdAt: new Date(), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
      user: { id: who.current.id, publicId: "x", email: who.current.email, name: who.current.name, roles: who.current.roles, emailVerified: true },
    }),
    revokeAllUserSessions: async () => 0,
    clearSessionCookie: async () => {},
  };
});

import { db, execute, query, queryOne, type Row } from "@/lib/db";
import { createPendingOrder, finalizePaidOrder } from "@/lib/orders/checkout";
import {
  answerFollowRequest, followUser, saveProfile, savePrivacy, setBlocked, setGuestListChoice, setOrgFollow, setOrgMuted, unfollowUser,
} from "@/lib/social/actions";
import { createPost, deletePost, fetchFeed, moderateMember, react, setFeedNotificationsMuted, setPinned } from "@/lib/social/feed-actions";
import { listReportsForOrg, listReportsForStaff, reportContent, resolveOrgReport, resolveStaffReport } from "@/lib/social/moderation";
import {
  acceptReferralInvite, clearRewardFlag, inviteReferrers, joinPublicOffer, markReferrerPaid, removeReferrer, reverseFlaggedReward, saveManualPayoutDetails,
  saveReferralOffer, saveReferralShare, listOwedReferrers,
} from "@/lib/social/referral-actions";
import { recordShare, saveEventSocial, saveOrgSocial, sendAudienceMessage, unsubscribeFromOrg } from "@/lib/social/org-actions";
import { audienceUnsubToken } from "@/lib/social/audience";
import { profileView, whosGoing } from "@/lib/social/queries";
import { deleteMyAccount } from "@/lib/privacy/actions";
import { getSettings } from "@/lib/settings";

const tag = randomUUID().slice(0, 8);
type U = { id: number; email: string; name: string; roles: string[] };
const u: Record<string, U> = {};
let orgId = 0, orgSlug = "", otherOrgSlug = "", eventId = 0, eventSlug = "", typeId = 0, freeEventId = 0;

const as = (key: string | null) => { who.current = key ? u[key] : null; };
const fd = (o: Record<string, string | string[] | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

async function user(key: string, o: { profile?: boolean; roles?: string[] } = {}) {
  const email = `${key}-${tag}@test.local`;
  const id = (await execute(
    `INSERT INTO users (public_id, email, email_normalized, name, email_verified_at, username, age_confirmed_at, show_on_guest_lists, phone)
     VALUES (?, ?, ?, ?, NOW(), ?, ?, 1, '+18435550100')`,
    [randomUUID(), email, email, `${key} person`, o.profile === false ? null : `${key}_${tag}`.slice(0, 30), o.profile === false ? null : new Date()],
  )).insertId;
  for (const r of o.roles ?? []) await execute(`INSERT INTO user_platform_roles (user_id, role) VALUES (?, ?)`, [id, r]);
  u[key] = { id, email, name: `${key} person`, roles: o.roles ?? [] };
}

async function buy(key: string, qty = 1, extra: { trackingLinkId?: number; marketing?: boolean; ip?: string } = {}) {
  const o = await createPendingOrder({
    eventSlug, email: u[key].email, name: u[key].name, marketingOptIn: !!extra.marketing, userId: u[key].id, ip: extra.ip ?? `10.1.0.${u[key].id % 250}`,
    lines: [{ ticketTypeId: typeId, quantity: qty }], attribution: extra.trackingLinkId ? { trackingLinkId: extra.trackingLinkId } : undefined,
  });
  await finalizePaidOrder(o.orderId, {});
  return o;
}

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  orgSlug = `sa-org-${tag}`; otherOrgSlug = `sa-other-${tag}`; eventSlug = `sa-event-${tag}`;
  orgId = (await execute(`INSERT INTO organizations (slug, name, contact_email, verified_at) VALUES (?, 'SA Org', 'sa@test.local', NOW())`, [orgSlug])).insertId;
  const otherOrg = (await execute(`INSERT INTO organizations (slug, name, contact_email, verified_at) VALUES (?, 'Other Org', 'o@test.local', NOW())`, [otherOrgSlug])).insertId;
  eventId = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode, feed_enabled, guest_list_mode)
     VALUES (?, ?, 'SA Event', NOW() + INTERVAL 30 DAY, 'America/New_York', 'published', 'public', 'organizer_absorbs', 1, 'faces')`, [orgId, eventSlug],
  )).insertId;
  typeId = (await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'GA', 2000, 200)`, [eventId])).insertId;
  freeEventId = (await execute(
    `INSERT INTO events (organization_id, slug, title, starts_at, timezone, status, visibility, fee_mode) VALUES (?, ?, 'Free one', NOW() + INTERVAL 30 DAY, 'America/New_York', 'published', 'public', 'buyer_pays')`,
    [orgId, `sa-free-${tag}`],
  )).insertId;
  await execute(`INSERT INTO ticket_types (event_id, name, price_cents, quantity) VALUES (?, 'Free', 0, 50)`, [freeEventId]);
  for (const k of ["ann", "bob", "cat", "dan", "eve", "promo", "fresh"]) await user(k, { profile: k !== "fresh" });
  // staff and organizers have no attendee profile
  await user("orgadmin", { profile: false }); await user("otheradmin", { profile: false }); await user("support", { profile: false, roles: ["support"] });
  await user("finance", { profile: false, roles: ["finance"] }); await user("superadm", { profile: false, roles: ["super_admin"] });
  await execute(`INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'org_admin'), (?, ?, 'org_admin')`, [orgId, u.orgadmin.id, otherOrg, u.otheradmin.id]);
  await buy("ann", 1, { marketing: true }); await buy("bob"); await buy("cat"); await buy("promo"); await buy("fresh");
});

afterAll(async () => {
  const ids = Object.values(u).map((x) => x.id);
  await execute(`DELETE FROM organizations WHERE slug IN (?, ?)`, [orgSlug, otherOrgSlug]);
  if (ids.length) {
    await execute(`DELETE FROM orders WHERE user_id IN (${ids.map(() => "?").join(",")})`, ids);
    await execute(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  }
  await db.end();
});

beforeEach(() => as(null));

// ---------------------------------------------------------------------------
describe("profile and privacy (11.3, 11.11)", () => {
  it("requires sign-in", async () => {
    expect((await saveProfile(undefined, fd({ username: "x" })))?.error).toMatch(/sign in/i);
  });

  it("validates username, bio, handles and the 18+ confirmation", async () => {
    as("fresh");
    const base = { name: "Fresh Person", username: `fresh_${tag}`, adult: "on" };
    expect((await saveProfile(undefined, fd({ ...base, username: "ab" })))?.field).toBe("username");
    expect((await saveProfile(undefined, fd({ ...base, username: "admin" })))?.error).toMatch(/reserved/);
    expect((await saveProfile(undefined, fd({ ...base, username: `ann_${tag}` })))?.error).toMatch(/taken/);
    expect((await saveProfile(undefined, fd({ ...base, bio: "x".repeat(161) })))?.field).toBe("bio");
    expect((await saveProfile(undefined, fd({ ...base, instagram: "not valid!" })))?.field).toBe("instagram");
    expect((await saveProfile(undefined, fd({ name: "Fresh Person", username: `fresh_${tag}` })))?.field).toBe("adult");
    expect((await saveProfile(undefined, fd({ ...base, name: "x" })))?.field).toBe("name");
  });

  it("creates the profile, normalizes handles, keeps only known categories", async () => {
    as("fresh");
    const r = await saveProfile(undefined, fd({
      name: "Fresh Person", username: `@Fresh_${tag}`, adult: "on", bio: "Hi", city: "Charleston, SC",
      instagram: "https://instagram.com/fresh.ig/", x: "@freshx", categories: ["Music", "Not a category"],
    }));
    expect(r?.ok).toBe(true);
    const row = await queryOne<Row & { username: string; instagram: string; x_handle: string; favorite_categories: string | null; age_confirmed_at: Date | null }>(`SELECT * FROM users WHERE id = ?`, [u.fresh.id]);
    expect(row?.username).toBe(`fresh_${tag}`);
    expect(row?.instagram).toBe("fresh.ig");
    expect(row?.x_handle).toBe("freshx");
    expect(row?.age_confirmed_at).not.toBeNull();
    expect(row?.favorite_categories ?? "").not.toContain("Not a category");
  });

  it("rejects a non-image avatar", async () => {
    as("fresh");
    const r = await saveProfile(undefined, fd({ name: "Fresh Person", username: `fresh_${tag}`, avatar: new File([Buffer.from("hello")], "x.png", { type: "image/png" }) }));
    expect(r?.field).toBe("avatar");
  });

  it("switching to 'anyone can follow' approves people who were waiting", async () => {
    as("eve");
    await savePrivacy(undefined, fd({ profile_public: "on", who_can_follow: "approved" }));
    as("dan");
    expect((await followUser(u.eve.id)).state).toBe("pending");
    as("eve");
    await savePrivacy(undefined, fd({ profile_public: "on", who_can_follow: "anyone" }));
    expect((await queryOne<Row & { status: string }>(`SELECT status FROM user_follows WHERE follower_id = ? AND followee_id = ?`, [u.dan.id, u.eve.id]))?.status).toBe("active");
    await execute(`DELETE FROM user_follows WHERE follower_id = ?`, [u.dan.id]);
  });

  it("a private profile shows name and photo only until the follow is approved", async () => {
    as("eve");
    await savePrivacy(undefined, fd({ who_can_follow: "approved", show_events_on_profile: "on" })); // profile_public off
    let p = await profileView(`eve_${tag}`, u.dan.id);
    expect(p?.limited).toBe(true);
    expect(p?.eventIds).toBeNull();
    as("dan");
    await followUser(u.eve.id);
    as("eve");
    await answerFollowRequest(u.dan.id, true);
    p = await profileView(`eve_${tag}`, u.dan.id);
    expect(p?.limited).toBe(false);
    await savePrivacy(undefined, fd({ profile_public: "on", who_can_follow: "anyone", show_on_guest_lists: "on" }));
  });
});

// ---------------------------------------------------------------------------
describe("follows and blocks (11.5, 11.6, 11.11)", () => {
  it("organizer follow needs sign-in, then follows, mutes and unfollows", async () => {
    expect((await setOrgFollow(orgSlug, true)).error).toBe("signin");
    as("dan");
    expect((await setOrgFollow(orgSlug, true, "page")).following).toBe(true);
    expect((await setOrgFollow(orgSlug, true)).ok).toBe(true); // idempotent
    await setOrgMuted(orgSlug, true);
    expect(Number((await queryOne<Row & { muted: number }>(`SELECT muted FROM org_follows WHERE user_id = ? AND organization_id = ?`, [u.dan.id, orgId]))?.muted)).toBe(1);
    expect((await setOrgFollow("no-such-org-xyz", true)).ok).toBe(false);
    await setOrgFollow(orgSlug, false);
    expect(await queryOne(`SELECT 1 FROM org_follows WHERE user_id = ? AND organization_id = ?`, [u.dan.id, orgId])).toBeNull();
  });

  it("following people needs a profile; you can't follow yourself", async () => {
    as("orgadmin"); // no profile
    expect((await followUser(u.ann.id)).error).toBe("profile");
    as("ann");
    expect((await followUser(u.ann.id)).ok).toBe(false);
    expect((await followUser(999_999_999)).ok).toBe(false);
  });

  it("blocking removes follows both ways and stops new follows and profile views", async () => {
    as("ann"); await followUser(u.bob.id);
    as("bob"); await followUser(u.ann.id);
    as("ann");
    expect((await setBlocked(u.bob.id, true)).ok).toBe(true);
    expect(await query(`SELECT 1 FROM user_follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)`, [u.ann.id, u.bob.id, u.bob.id, u.ann.id])).toHaveLength(0);
    as("bob");
    expect((await followUser(u.ann.id)).ok).toBe(false);
    expect(await profileView(`ann_${tag}`, u.bob.id)).toBeNull();     // blocked person can't see the blocker
    expect((await profileView(`bob_${tag}`, u.ann.id))?.viewerBlocked).toBe(true); // blocker can still open theirs
    as("ann");
    await setBlocked(u.bob.id, false);
    expect(await profileView(`ann_${tag}`, u.bob.id)).not.toBeNull();
  });

  it("decline removes a request; unfollow removes a follow", async () => {
    as("eve"); await savePrivacy(undefined, fd({ profile_public: "on", who_can_follow: "approved", show_on_guest_lists: "on" }));
    as("cat"); expect((await followUser(u.eve.id)).state).toBe("pending");
    as("eve"); await answerFollowRequest(u.cat.id, false);
    expect(await queryOne(`SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?`, [u.cat.id, u.eve.id])).toBeNull();
    await savePrivacy(undefined, fd({ profile_public: "on", who_can_follow: "anyone", show_on_guest_lists: "on" }));
    as("cat"); await followUser(u.eve.id); await unfollowUser(u.eve.id);
    expect(await queryOne(`SELECT 1 FROM user_follows WHERE follower_id = ? AND followee_id = ?`, [u.cat.id, u.eve.id])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("guest list choice (11.4)", () => {
  it("only signed-in ticket holders with a profile can show themselves", async () => {
    expect((await setGuestListChoice(eventId, true)).error).toBe("signin");
    as("dan"); // profile, no ticket
    expect((await setGuestListChoice(eventId, true)).ok).toBe(false);
    as("orgadmin"); // no profile
    expect((await setGuestListChoice(eventId, true)).error).toBe("profile");
    as("cat");
    expect((await setGuestListChoice(eventId, false)).ok).toBe(true);
    let g = await whosGoing({ id: eventId, guest_list_mode: "faces", access_password: null }, null, 50);
    expect(g.people.map((p) => p.id)).not.toContain(u.cat.id);
    expect((await setGuestListChoice(eventId, true)).ok).toBe(true);
    g = await whosGoing({ id: eventId, guest_list_mode: "faces", access_password: null }, null, 50);
    expect(g.people.map((p) => p.id)).toContain(u.cat.id);
  });

  it("refunded ticket holders drop off the list", async () => {
    await user("refund");
    const o = await buy("refund");
    expect((await whosGoing({ id: eventId, guest_list_mode: "faces", access_password: null }, null, 50)).people.map((p) => p.id)).toContain(u.refund.id);
    await execute(`UPDATE orders SET status = 'refunded' WHERE id = ?`, [o.orderId]);
    await execute(`UPDATE tickets SET status = 'refunded' WHERE order_id = ?`, [o.orderId]);
    expect((await whosGoing({ id: eventId, guest_list_mode: "faces", access_password: null }, null, 50)).people.map((p) => p.id)).not.toContain(u.refund.id);
  });
});

// ---------------------------------------------------------------------------
describe("event feed (11.7)", () => {
  let annPost = 0;
  const post = (body: string, extra: Record<string, string> = {}) => createPost(fd({ event_id: String(eventId), body, ...extra }));

  it("people without a ticket can't read or post; signed-out can't either", async () => {
    expect((await fetchFeed(eventId)).ok).toBe(false);
    as("dan");
    expect((await fetchFeed(eventId)).ok).toBe(false);
    expect((await post("hello")).ok).toBe(false);
  });

  it("ticket holders post, reply and react; replies notify the author by email", async () => {
    as("ann");
    const r = await post("Who's going early?");
    expect(r.ok).toBe(true);
    annPost = r.posts!.find((p) => p.body === "Who's going early?")!.id;
    as("bob");
    const reply = await createPost(fd({ event_id: String(eventId), body: "Me!", parent_id: String(annPost) }));
    expect(reply.posts!.find((p) => p.id === annPost)!.replies.map((x) => x.body)).toContain("Me!");
    expect((await react(eventId, annPost, "🔥")).posts!.find((p) => p.id === annPost)!.reactions).toEqual([{ emoji: "🔥", count: 1, mine: true }]);
    expect((await react(eventId, annPost, "🔥")).posts!.find((p) => p.id === annPost)!.reactions).toEqual([]); // toggles off
    expect((await react(eventId, annPost, "💩")).ok).toBe(false); // unknown reaction
    await new Promise((res) => setTimeout(res, 300));
    const mail = await queryOne(`SELECT 1 FROM email_outbox WHERE to_email = ? AND subject LIKE 'New reply in%'`, [u.ann.email]);
    expect(mail).not.toBeNull();
  });

  it("no reply notice when the author muted the feed", async () => {
    as("ann"); await setFeedNotificationsMuted(eventId, true);
    const before = await query(`SELECT id FROM email_outbox WHERE to_email = ? AND subject LIKE 'New reply in%'`, [u.ann.email]);
    as("cat"); await createPost(fd({ event_id: String(eventId), body: "Count me in", parent_id: String(annPost) }));
    await new Promise((res) => setTimeout(res, 300));
    expect(await query(`SELECT id FROM email_outbox WHERE to_email = ? AND subject LIKE 'New reply in%'`, [u.ann.email])).toHaveLength(before.length);
    as("ann"); await setFeedNotificationsMuted(eventId, false);
  });

  it("filters links and slurs for attendees, rejects duplicates and replies to replies", async () => {
    as("cat");
    expect((await post("go to bit.ly/abc")).error).toMatch(/Links/);
    expect((await post("you retard")).error).toMatch(/community rules/);
    expect((await post("Count me in")).error).toMatch(/already posted/); // same text as cat's reply just before
    expect((await post("Count me in too")).ok).toBe(true);
    expect((await post("Count me in too")).error).toMatch(/already posted/);
    const reply = (await fetchFeed(eventId)).posts!.find((p) => p.id === annPost)!.replies[0];
    expect((await createPost(fd({ event_id: String(eventId), body: "nested", parent_id: String(reply.id) }))).ok).toBe(false);
  });

  it("attendees can't post alerts or photos unless allowed; only the organizer pins", async () => {
    as("fresh"); // cat has used up the 6-posts-a-minute limit (rejected attempts count too)
    const r = await post("ALERT? no", { alert: "on" });
    expect(r.posts!.find((p) => p.body === "ALERT? no")!.kind).toBe("post");
    const photo = await post("pic", { image: new File([Buffer.from("x")], "a.png", { type: "image/png" }) } as never);
    expect(photo.error).toMatch(/Only the organizer can add photos/);
    expect((await setPinned(eventId, annPost, true)).ok).toBe(false);
  });

  it("the organizer posts alerts (pinned, emailed to holders), pins and deletes anything", async () => {
    as("orgadmin");
    const r = await post("Doors at 7 sharp, see www.example.com", { alert: "on" });
    expect(r.ok).toBe(true); // organizer posts aren't link-filtered
    const alert = r.posts![0];
    expect(alert.kind).toBe("alert");
    expect(alert.pinned).toBe(true);
    expect(alert.author.organizer).toBe(true);
    await new Promise((res) => setTimeout(res, 500));
    expect(await queryOne(`SELECT 1 FROM email_outbox WHERE to_email = ? AND subject LIKE 'Alert from SA Org%'`, [u.bob.email])).not.toBeNull();
    expect(await queryOne(`SELECT 1 FROM email_outbox WHERE to_email = ? AND subject LIKE 'Alert from SA Org%'`, [u.dan.email])).toBeNull(); // no ticket
    expect((await setPinned(eventId, annPost, true)).ok).toBe(true);
    expect((await deletePost(eventId, annPost)).ok).toBe(true);
    expect((await fetchFeed(eventId)).posts!.map((p) => p.id)).not.toContain(annPost);
  });

  it("attendees can delete only their own posts", async () => {
    as("bob");
    const mine = (await post("bob's post")).posts!.find((p) => p.body === "bob's post")!.id;
    as("cat");
    expect((await deletePost(eventId, mine)).ok).toBe(false);
    as("bob");
    expect((await deletePost(eventId, mine)).ok).toBe(true);
  });

  it("muted people can read but not post or react; removed people can't read; their posts go", async () => {
    as("bob"); await post("bob again");
    as("orgadmin");
    expect((await moderateMember(eventId, u.bob.id, "muted")).ok).toBe(true);
    as("bob");
    expect((await fetchFeed(eventId)).ok).toBe(true);
    expect((await post("can I post?")).ok).toBe(false);
    as("orgadmin");
    await moderateMember(eventId, u.bob.id, "removed");
    as("bob");
    expect((await fetchFeed(eventId)).ok).toBe(false);
    as("ann");
    expect((await fetchFeed(eventId)).posts!.map((p) => p.body)).not.toContain("bob again");
    as("cat"); // an attendee can't moderate
    expect((await moderateMember(eventId, u.ann.id, "removed")).ok).toBe(false);
    as("orgadmin"); await moderateMember(eventId, u.bob.id, "ok");
  });

  it("another organization's admin is not a moderator here", async () => {
    as("otheradmin");
    expect((await fetchFeed(eventId)).ok).toBe(false);
    expect((await moderateMember(eventId, u.ann.id, "removed")).ok).toBe(false);
  });

  it("turns read-only after the open period and is invisible when off", async () => {
    await execute(`UPDATE events SET starts_at = NOW() - INTERVAL 20 DAY, ends_at = NOW() - INTERVAL 19 DAY, feed_open_days = 7 WHERE id = ?`, [eventId]);
    as("cat");
    expect((await fetchFeed(eventId)).ok).toBe(true);
    expect((await post("late post")).error).toMatch(/read-only/);
    await execute(`UPDATE events SET starts_at = NOW() + INTERVAL 30 DAY, ends_at = NULL, feed_enabled = 0 WHERE id = ?`, [eventId]);
    expect((await fetchFeed(eventId)).ok).toBe(false);
    await execute(`UPDATE events SET feed_enabled = 1 WHERE id = ?`, [eventId]);
  });
});

// ---------------------------------------------------------------------------
describe("reports and moderation (11.11)", () => {
  let postId = 0;
  beforeAll(async () => {
    as("bob");
    const r = await createPost(fd({ event_id: String(eventId), body: "report me please" }));
    postId = r.posts!.find((p) => p.body === "report me please")!.id;
  });

  it("needs sign-in and a reason; duplicate open reports are merged", async () => {
    expect((await reportContent("post", postId, "spam"))?.error).toMatch(/sign in/i);
    as("cat");
    expect((await reportContent("post", postId, "x"))?.error).toBeTruthy();
    expect((await reportContent("post", postId, "This is spam"))?.ok).toBe(true);
    expect((await reportContent("post", postId, "Still spam"))?.message).toMatch(/already/);
    expect((await reportContent("profile", u.bob.id, "Fake profile"))?.ok).toBe(true);
    expect((await reportContent("post", 999_999_999, "gone"))?.error).toBeTruthy();
  });

  it("the event's organizer sees and resolves post reports; another org can't", async () => {
    as("orgadmin");
    const reports = await listReportsForOrg(orgSlug);
    const rep = reports.find((r) => Number(r.target_id) === postId)!;
    expect(rep.reason).toBe("This is spam");
    expect(reports.some((r) => r.target_type === "profile")).toBe(false); // profile reports are for support only
    as("otheradmin");
    expect((await resolveOrgReport(otherOrgSlug, Number(rep.id), "remove"))?.error).toBeTruthy();
    as("orgadmin");
    expect((await resolveOrgReport(orgSlug, Number(rep.id), "remove"))?.ok).toBe(true);
    expect(await queryOne(`SELECT 1 FROM event_posts WHERE id = ? AND deleted_at IS NULL`, [postId])).toBeNull();
    expect(await queryOne(`SELECT 1 FROM audit_log WHERE action = 'social.post.removed' AND target_id = ?`, [String(postId)])).not.toBeNull();
  });

  it("support removes profile content and suspends accounts (audit-logged); attendees and finance can't", async () => {
    as("cat");
    await expect(listReportsForStaff()).rejects.toThrow();
    as("finance");
    await expect(resolveStaffReport(1, "dismiss")).rejects.toThrow();
    as("support");
    const rep = (await listReportsForStaff()).find((r) => r.target_type === "profile" && Number(r.target_id) === u.bob.id)!;
    await execute(`UPDATE users SET bio = 'bad bio' WHERE id = ?`, [u.bob.id]);
    expect((await resolveStaffReport(Number(rep.id), "remove"))?.ok).toBe(true);
    expect((await queryOne<Row & { bio: string | null }>(`SELECT bio FROM users WHERE id = ?`, [u.bob.id]))?.bio).toBeNull();
    as("cat"); await reportContent("profile", u.bob.id, "Again");
    as("support");
    const again = (await listReportsForStaff()).find((r) => r.target_type === "profile" && Number(r.target_id) === u.bob.id)!;
    expect((await resolveStaffReport(Number(again.id), "suspend"))?.ok).toBe(true);
    expect((await queryOne<Row & { status: string }>(`SELECT status FROM users WHERE id = ?`, [u.bob.id]))?.status).toBe("suspended");
    expect(await queryOne(`SELECT 1 FROM audit_log WHERE action = 'user.status.changed' AND target_id = ?`, [String(u.bob.id)])).not.toBeNull();
    // suspended people vanish from guest lists and profiles
    expect((await whosGoing({ id: eventId, guest_list_mode: "faces", access_password: null }, null, 50)).people.map((p) => p.id)).not.toContain(u.bob.id);
    expect(await profileView(`bob_${tag}`, null)).toBeNull();
    await execute(`UPDATE users SET status = 'active' WHERE id = ?`, [u.bob.id]);
  });

  it("staff accounts can't be suspended from a report", async () => {
    as("cat"); await reportContent("profile", u.support.id, "x".repeat(5)).catch(() => null);
    // support has no username, so the report is refused before that
    expect(await queryOne(`SELECT 1 FROM content_reports WHERE target_type = 'profile' AND target_id = ?`, [u.support.id])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("referral rewards (11.9)", () => {
  const offer = (o: Record<string, string>) => saveReferralOffer(undefined, fd({ org: orgSlug, event_id: String(eventId), ...o }));

  it("only the organizer sets offers; values are validated; free events can't have one", async () => {
    as("cat");
    expect((await offer({ kind: "public", reward_type: "fixed", reward_value: "3" }))?.error).toBe("Forbidden");
    as("orgadmin");
    expect((await offer({ kind: "public", reward_type: "fixed", reward_value: "0" }))?.error).toBeTruthy();
    expect((await offer({ kind: "public", reward_type: "percent", reward_value: "60" }))?.error).toMatch(/50%/);
    expect((await saveReferralOffer(undefined, fd({ org: orgSlug, event_id: String(freeEventId), kind: "public", reward_type: "fixed", reward_value: "3", active: "1" })))?.error).toMatch(/paid events/);
    expect((await offer({ kind: "public", reward_type: "fixed", reward_basis: "ticket", reward_value: "$3.00", active: "1" }))?.ok).toBe(true);
    const row = await queryOne<Row & { reward_value: number; active: number }>(`SELECT reward_value, active FROM referral_offers WHERE event_id = ? AND kind = 'public'`, [eventId]);
    expect(Number(row?.reward_value)).toBe(300);
    expect(Number(row?.active)).toBe(1);
  });

  it("joining needs sign-in, a ticket and the terms", async () => {
    expect((await joinPublicOffer(eventId, true))?.error).toBe("signin");
    as("dan");
    expect((await joinPublicOffer(eventId, true))?.error).toMatch(/Buy a ticket/);
    as("promo");
    expect((await joinPublicOffer(eventId, false))?.error).toMatch(/Terms/);
    const r = await joinPublicOffer(eventId, true);
    expect(r?.url).toMatch(/\/r\/x[a-z0-9]+$/);
    expect((await joinPublicOffer(eventId, true))?.code).toBe(r?.code); // same link again
  });

  it("removed referrers can't rejoin and their link stops", async () => {
    as("cat");
    await joinPublicOffer(eventId, true);
    const ref = await queryOne<Row & { id: number; tracking_link_id: number }>(`SELECT r.id, r.tracking_link_id FROM referrers r WHERE r.user_id = ?`, [u.cat.id]);
    as("otheradmin");
    expect((await removeReferrer(otherOrgSlug, Number(ref!.id)))?.error).toBeTruthy();
    as("orgadmin");
    expect((await removeReferrer(orgSlug, Number(ref!.id)))?.ok).toBe(true);
    expect(Number((await queryOne<Row & { active: number }>(`SELECT active FROM tracking_links WHERE id = ?`, [ref!.tracking_link_id]))?.active)).toBe(0);
    as("cat");
    expect((await joinPublicOffer(eventId, true))?.error).toMatch(/removed/);
  });

  it("invite-only: invitations by email and phone, bad lines reported, duplicates skipped, accept once", async () => {
    as("orgadmin");
    const inv = (contacts: string) => inviteReferrers(undefined, fd({ org: orgSlug, event_id: String(eventId), contacts }));
    expect((await inv("x@y.z"))?.error).toMatch(/invite-only offer first/);
    await offer({ kind: "invite", reward_type: "percent", reward_value: "15", active: "1" });
    const r = await inv(`${u.eve.email}\n(843) 555-0199\nnot-a-contact`);
    expect(r?.message).toMatch(/2 invitation/);
    expect(r?.error).toMatch(/^2 invitation\(s\) sent\. .*not-a-contact/);
    expect((await inv(u.eve.email))?.message).toMatch(/0 invitation/);
    const mail = await queryOne<Row & { text_body: string }>(`SELECT text_body FROM email_outbox WHERE to_email = ? AND subject LIKE '%invited you to promote%' ORDER BY id DESC`, [u.eve.email]);
    const token = mail!.text_body.match(/\/referrals\/accept\/([A-Za-z0-9_-]+)/)![1];
    as(null);
    expect((await acceptReferralInvite(token, true))?.error).toBe("signin");
    as("eve");
    expect((await acceptReferralInvite(token, false))?.error).toMatch(/Terms/);
    expect((await acceptReferralInvite("bogus-token-bogus-token-123", true))?.error).toMatch(/no longer valid/);
    const ok = await acceptReferralInvite(token, true);
    expect(ok?.url).toMatch(/\/r\/x/);
    as("dan");
    expect((await acceptReferralInvite(token, true))?.error).toMatch(/another account/);
  });

  it("manual payout details are stored encrypted and Finance sees them decrypted", async () => {
    as("promo");
    expect((await saveManualPayoutDetails(undefined, fd({ method: "bank", handle: "x" })))?.error).toBeTruthy();
    expect((await saveManualPayoutDetails(undefined, fd({ method: "paypal", handle: "promo@pay.pal" })))?.ok).toBe(true);
    const raw = await queryOne<Row & { manual_details: string }>(`SELECT manual_details FROM referrer_payout_accounts WHERE user_id = ?`, [u.promo.id]);
    expect(raw?.manual_details).not.toContain("promo@pay.pal");
  });

  it("rewards: paid on referred sales, flagged for one-network patterns, payable after the event, Finance pays", async () => {
    const link = Number((await queryOne<Row & { id: number }>(
      `SELECT tl.id FROM referrers r JOIN tracking_links tl ON tl.id = r.tracking_link_id JOIN referral_offers f ON f.id = r.offer_id WHERE r.user_id = ? AND f.kind = 'public'`, [u.promo.id],
    ))!.id);
    for (const k of ["r1", "r2", "r3"]) { await user(k); await buy(k, 1, { trackingLinkId: link, ip: "203.0.113.9" }); }
    const rows = await query<Row & { flagged: number; amount_cents: number }>(`SELECT flagged, amount_cents FROM referral_rewards WHERE user_id = ?`, [u.promo.id]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => Number(r.flagged) === 1)).toBe(true);
    expect(rows.every((r) => Number(r.amount_cents) === 300)).toBe(true);

    as("superadm");
    expect((await saveReferralShare(undefined, fd({ share_percent: "120" })))?.error).toBeTruthy();
    expect((await saveReferralShare(undefined, fd({ share_percent: "20" })))?.ok).toBe(true);
    expect((await getSettings()).referral_platform_share_bps).toBe("2000");

    // clear two flags, reverse one
    as("support");
    const ids = (await query<Row & { id: number }>(`SELECT id FROM referral_rewards WHERE user_id = ? ORDER BY id`, [u.promo.id])).map((r) => Number(r.id));
    await clearRewardFlag(ids[0]); await clearRewardFlag(ids[1]); await reverseFlaggedReward(ids[2]);
    // the event ends; the daily job makes them payable
    await execute(`UPDATE events SET starts_at = NOW() - INTERVAL 40 DAY, ends_at = NOW() - INTERVAL 39 DAY WHERE id = ?`, [eventId]);
    const { runReferralJobs } = await import("@/lib/social/referrals");
    await runReferralJobs();
    const st = await query<Row & { status: string }>(`SELECT status FROM referral_rewards WHERE user_id = ? ORDER BY id`, [u.promo.id]);
    expect(st.map((r) => r.status)).toEqual(["payable", "payable", "reversed"]);

    as("cat");
    await expect(listOwedReferrers()).rejects.toThrow();
    as("finance");
    const owed = (await listOwedReferrers()).find((o) => o.userId === u.promo.id)!;
    expect(owed.owed).toBe(600); // earned before the 20% share was set: the share is not applied after the fact
    expect(owed.method).toBe("paypal: promo@pay.pal");
    expect((await markReferrerPaid(u.promo.id, ""))?.error).toBeTruthy();
    expect((await markReferrerPaid(u.promo.id, "PP-123"))?.message).toMatch(/2 reward/);
    expect((await query<Row & { status: string }>(`SELECT status FROM referral_rewards WHERE user_id = ? AND status = 'paid'`, [u.promo.id]))).toHaveLength(2);
    as("superadm"); await saveReferralShare(undefined, fd({ share_percent: "0" }));
    await execute(`UPDATE events SET starts_at = NOW() + INTERVAL 30 DAY, ends_at = NULL WHERE id = ?`, [eventId]);
  });

  it("new rewards take the Fattixx share", async () => {
    as("superadm"); await saveReferralShare(undefined, fd({ share_percent: "20" }));
    const link = Number((await queryOne<Row & { id: number }>(
      `SELECT tl.id FROM referrers r JOIN tracking_links tl ON tl.id = r.tracking_link_id JOIN referral_offers f ON f.id = r.offer_id WHERE r.user_id = ? AND f.kind = 'public'`, [u.promo.id],
    ))!.id);
    await user("r4"); const o = await buy("r4", 2, { trackingLinkId: link });
    const rr = await queryOne<Row & { amount_cents: number; platform_cents: number }>(`SELECT amount_cents, platform_cents FROM referral_rewards WHERE order_id = ?`, [o.orderId]);
    expect(Number(rr?.amount_cents)).toBe(600);
    expect(Number(rr?.platform_cents)).toBe(120);
    await saveReferralShare(undefined, fd({ share_percent: "0" }));
  });
});

// ---------------------------------------------------------------------------
describe("organizer settings, audience and shares (11.5, 11.8, 11.10)", () => {
  it("event social settings: organizer only, validated", async () => {
    const save = (o: Record<string, string>) => saveEventSocial(undefined, fd({ org: orgSlug, event_id: String(eventId), ...o }));
    as("cat");
    await expect(save({ guest_list_mode: "off", feed_open_days: "7" })).rejects.toThrow();
    as("orgadmin");
    expect((await save({ guest_list_mode: "everyone", feed_open_days: "7" }))?.error).toBeTruthy();
    expect((await save({ guest_list_mode: "off", feed_open_days: "91" }))?.error).toMatch(/90/);
    expect((await save({ guest_list_mode: "faces_total", feed_enabled: "1", feed_attendee_photos: "1", feed_open_days: "3" }))?.ok).toBe(true);
    const e = await queryOne<Row & { guest_list_mode: string; feed_enabled: number; feed_attendee_photos: number; feed_open_days: number }>(`SELECT * FROM events WHERE id = ?`, [eventId]);
    expect([e?.guest_list_mode, Number(e?.feed_enabled), Number(e?.feed_attendee_photos), Number(e?.feed_open_days)]).toEqual(["faces_total", 1, 1, 3]);
    as("otheradmin");
    expect((await saveEventSocial(undefined, fd({ org: otherOrgSlug, event_id: String(eventId), guest_list_mode: "off", feed_open_days: "1" })))?.error).toMatch(/not found/);
  });

  it("organizer social links: only real profile URLs on the right site, https", async () => {
    as("orgadmin");
    const save = (o: Record<string, string>) => saveOrgSocial(undefined, fd({ org: orgSlug, ...o }));
    expect((await save({ social_instagram: "https://evil.com/x" }))?.error).toBeTruthy();
    expect((await save({ social_instagram: "javascript:alert(1)" }))?.error).toBeTruthy();
    expect((await save({ social_instagram: "instagram.com/saorg", social_x: "http://twitter.com/saorg", hide_follower_count: "1" }))?.ok).toBe(true);
    const o = await queryOne<Row & { social_links: string; hide_follower_count: number }>(`SELECT social_links, hide_follower_count FROM organizations WHERE id = ?`, [orgId]);
    expect(JSON.parse(o!.social_links)).toEqual({ instagram: "https://instagram.com/saorg", x: "https://twitter.com/saorg" });
    expect(Number(o?.hide_follower_count)).toBe(1);
  });

  it("audience messages reach unmuted followers and opted-in attendees only, with a working unsubscribe", async () => {
    as("dan"); await setOrgFollow(orgSlug, true);
    as("eve"); await setOrgFollow(orgSlug, true); await setOrgMuted(orgSlug, true);
    as("cat");
    await expect(sendAudienceMessage(undefined, fd({ org: orgSlug, subject: "Hi there", body: "A message for you all" }))).rejects.toThrow();
    as("orgadmin");
    expect((await sendAudienceMessage(undefined, fd({ org: orgSlug, subject: "x", body: "y" })))?.error).toBeTruthy();
    const r = await sendAudienceMessage(undefined, fd({ org: orgSlug, subject: "Big news", body: "Our next show is coming soon." }));
    expect(r?.ok).toBe(true);
    const to = (await query<Row & { to_email: string }>(`SELECT to_email FROM email_outbox WHERE subject = 'SA Org: Big news'`)).map((x) => x.to_email);
    expect(to).toContain(u.dan.email);       // follower
    expect(to).not.toContain(u.eve.email);   // muted
    expect(to).toContain(u.ann.email);       // opted in at checkout
    expect(to).not.toContain(u.cat.email);   // never opted in
    expect(await unsubscribeFromOrg("garbage.token")).toEqual({ error: "This link is not valid." });
    expect((await unsubscribeFromOrg(audienceUnsubToken(orgId, u.ann.email)))?.ok).toBe(true);
    await sendAudienceMessage(undefined, fd({ org: orgSlug, subject: "Second news", body: "Another message for everyone." }));
    const to2 = (await query<Row & { to_email: string }>(`SELECT to_email FROM email_outbox WHERE subject = 'SA Org: Second news'`)).map((x) => x.to_email);
    expect(to2).not.toContain(u.ann.email);
  });

  it("shares are counted per channel, rate limited, only for live events", async () => {
    as("ann");
    for (let i = 0; i < 7; i++) await recordShare(eventId, "story");
    await recordShare(eventId, "<script>");
    const rows = await query<Row & { channel: string; n: number }>(`SELECT channel, COUNT(*) AS n FROM event_shares WHERE event_id = ? GROUP BY channel`, [eventId]);
    expect(rows.find((r) => r.channel === "story")?.n).toBe(5);
    expect(rows.find((r) => r.channel === "other")?.n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("account deletion removes social data (11.11)", () => {
  it("deletes profile, follows, blocks and posts", async () => {
    await user("leaver");
    await buy("leaver");
    as("leaver");
    await followUser(u.ann.id); await setOrgFollow(orgSlug, true); await setBlocked(u.cat.id, true);
    await createPost(fd({ event_id: String(eventId), body: "bye all" }));
    await expect(deleteMyAccount(undefined, fd({ confirm: "DELETE" }))).rejects.toThrow("NEXT_REDIRECT");
    const id = u.leaver.id;
    for (const [sql, n] of [
      [`SELECT 1 FROM user_follows WHERE follower_id = ? OR followee_id = ?`, 2], [`SELECT 1 FROM org_follows WHERE user_id = ?`, 1],
      [`SELECT 1 FROM user_blocks WHERE blocker_id = ? OR blocked_id = ?`, 2], [`SELECT 1 FROM event_posts WHERE user_id = ?`, 1],
    ] as const) expect(await query(sql, Array(n).fill(id))).toHaveLength(0);
    const row = await queryOne<Row & { username: string | null; status: string }>(`SELECT username, status FROM users WHERE id = ?`, [id]);
    expect(row?.username).toBeNull();
    expect(row?.status).toBe("disabled");
  });
});
