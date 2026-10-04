/**
 * Mobile API authentication against the `fattixx_test` database: shared credential checks, Bearer-token
 * sessions (long-lived, no idle timeout, revocable) and the generic failure messages.
 *   Create the DB once:  DB_NAME=fattixx_test node scripts/db-setup.mjs
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// Route handlers read the request through next/headers; here we hand it the headers / cookies of a fake request.
const req = { authorization: null as string | null, cookie: null as string | null };
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest", ...(req.authorization ? { authorization: req.authorization } : {}) }),
  cookies: async () => ({
    get: (name: string) => (req.cookie && name === "fx_session" ? { name, value: req.cookie } : undefined),
    set: () => {},
    has: (name: string) => !!req.cookie && name === "fx_session",
  }),
}));

import { db, execute, queryOne, type Row } from "@/lib/db";
import { hashPassword } from "@/lib/security/password";
import { authenticateWithPassword, registerAttendeeAccount, GENERIC_LOGIN_ERROR } from "@/lib/auth/credentials";
import { createBearerSession, getSession, MOBILE_SESSION_DAYS, MOBILE_UA_PREFIX, revokeSession } from "@/lib/auth/session";
import { mobileAccount } from "@/lib/mobile/auth";

const tag = randomUUID().slice(0, 8);
const email = `mobile-${tag}@test.local`;
const password = `Correct-Horse-${tag}-Battery`;
let userId: number;
const createdUsers: number[] = [];

beforeAll(async () => {
  const [[{ db: current }]] = await db.query<(Row & { db: string })[]>("SELECT DATABASE() AS db");
  if (current !== "fattixx_test") throw new Error(`Refusing to run integration tests against database "${current}"`);
  const r = await execute(
    `INSERT INTO users (public_id, email, email_normalized, name, password_hash, email_verified_at) VALUES (?, ?, ?, 'Mobile Tester', ?, NOW())`,
    [randomUUID(), email, email, await hashPassword(password)],
  );
  userId = r.insertId;
  createdUsers.push(userId);
});

afterAll(async () => {
  for (const id of createdUsers) await execute(`DELETE FROM users WHERE id = ?`, [id]);
  await execute(`DELETE FROM login_attempts WHERE email_normalized LIKE ?`, [`%-${tag}@test.local`]);
  await db.end();
});

describe("credentials shared by web and app", () => {
  it("rejects a wrong password and an unknown account with the same generic message", async () => {
    const wrong = await authenticateWithPassword(email, "not-the-password-at-all");
    expect(wrong).toEqual({ ok: false, error: GENERIC_LOGIN_ERROR, status: 400 });
    const unknown = await authenticateWithPassword(`nobody-${tag}@test.local`, password);
    expect(unknown).toEqual({ ok: false, error: GENERIC_LOGIN_ERROR, status: 400 });
    const attempts = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM login_attempts WHERE email_normalized = ? AND success = 0`, [email]);
    expect(Number(attempts?.n)).toBe(1);
  });

  it("accepts the right password", async () => {
    const r = await authenticateWithPassword(email.toUpperCase(), password);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.user.id).toBe(userId);
    const u = await queryOne<Row & { failed_login_count: number; last_login_at: Date | null }>(`SELECT failed_login_count, last_login_at FROM users WHERE id = ?`, [userId]);
    expect(Number(u?.failed_login_count)).toBe(0);
    expect(u?.last_login_at).not.toBeNull();
  });

  it("refuses weak registration passwords before touching the network", async () => {
    const r = await registerAttendeeAccount({ email: `weak-${tag}@test.local`, name: "Weak", password: "short" });
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.field).toBe("password");
  });

  it("registers a new attendee without a verified email", async () => {
    const r = await registerAttendeeAccount({ email: `new-${tag}@test.local`, name: "New Person", password: `Another-Long-Phrase-${tag}` });
    expect(r.kind).toBe("created");
    if (r.kind !== "created") return;
    createdUsers.push(r.userId);
    const acct = await mobileAccount(r.userId);
    expect(acct?.user.emailVerified).toBe(false);
    expect(acct?.user.id).toMatch(/^[0-9a-f-]{36}$/); // public id, never the numeric key
    expect(acct?.canScan).toBe(false);
  });
});

describe("bearer sessions", () => {
  let token: string;
  let sessionId: string;

  it("creates a 30-day session labelled as the app and resolves it from the Authorization header", async () => {
    const s = await createBearerSession(userId, "Pixel 8 / Android 15 / app 1.0.0");
    token = s.token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    req.authorization = `Bearer ${token}`;
    const session = await getSession();
    expect(session?.user.id).toBe(userId);
    expect(session?.via).toBe("bearer");
    sessionId = session!.id;
    const row = await queryOne<Row & { user_agent: string; days: number }>(`SELECT user_agent, DATEDIFF(expires_at, NOW()) AS days FROM sessions WHERE id = ?`, [sessionId]);
    expect(row?.user_agent.startsWith(MOBILE_UA_PREFIX)).toBe(true);
    expect(Number(row?.days)).toBeGreaterThanOrEqual(MOBILE_SESSION_DAYS - 1);
  });

  it("stays valid after hours of inactivity, while the same token as a browser cookie would have idled out", async () => {
    await execute(`UPDATE sessions SET last_seen_at = NOW() - INTERVAL 5 HOUR WHERE id = ?`, [sessionId]);
    req.authorization = `Bearer ${token}`;
    expect((await getSession())?.via).toBe("bearer");
    req.authorization = null;
    req.cookie = token;
    expect(await getSession()).toBeNull();
    req.cookie = null;
  });

  it("ignores malformed or unknown tokens", async () => {
    req.authorization = "Bearer short";
    expect(await getSession()).toBeNull();
    req.authorization = `Bearer ${"A".repeat(43)}`;
    expect(await getSession()).toBeNull();
    req.authorization = `Basic ${token}`;
    expect(await getSession()).toBeNull();
  });

  it("is rejected once revoked (sign out)", async () => {
    await revokeSession(sessionId, "logout");
    req.authorization = `Bearer ${token}`;
    expect(await getSession()).toBeNull();
    req.authorization = null;
  });
});
