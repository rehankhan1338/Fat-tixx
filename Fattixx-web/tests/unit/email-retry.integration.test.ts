/**
 * Automatic email retries (plan 13.1). Points SMTP at a closed port so every send fails, then checks
 * the exponential backoff bookkeeping and that the retry job re-attempts only messages that are due.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, execute, queryOne, type Row } from "@/lib/db";

const tag = randomUUID().slice(0, 8);
let email: typeof import("@/lib/email");

beforeAll(async () => {
  delete process.env.BREVO_API_KEY;
  process.env.SMTP_URL = "smtp://127.0.0.1:1"; // nothing listens on port 1: connection refused immediately
  email = await import("@/lib/email");
});

afterAll(async () => {
  await execute(`DELETE FROM email_outbox WHERE to_email = ?`, [`retry-${tag}@test.local`]);
  delete process.env.SMTP_URL;
  await db.end();
});

describe("email retries", () => {
  it("records a failed send with a backoff and retries it once due", async () => {
    const id = await email.sendEmail({ to: `retry-${tag}@test.local`, subject: "Retry me", text: "x" });
    const row = await queryOne<Row & { status: string; attempts: number; next_attempt_at: Date | null }>(`SELECT status, attempts, next_attempt_at FROM email_outbox WHERE id = ?`, [id]);
    expect(row!.status).toBe("failed");
    expect(Number(row!.attempts)).toBe(1);
    expect(new Date(row!.next_attempt_at!).getTime()).toBeGreaterThan(Date.now());

    // Not due yet: untouched.
    await email.retryDueEmails();
    expect(Number((await queryOne<Row & { attempts: number }>(`SELECT attempts FROM email_outbox WHERE id = ?`, [id]))!.attempts)).toBe(1);

    await execute(`UPDATE email_outbox SET next_attempt_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?`, [id]);
    const r = await email.retryDueEmails();
    expect(r.retried).toBeGreaterThanOrEqual(1);
    const after = await queryOne<Row & { attempts: number; next_attempt_at: Date | null }>(`SELECT attempts, next_attempt_at FROM email_outbox WHERE id = ?`, [id]);
    expect(Number(after!.attempts)).toBe(2);
    expect(new Date(after!.next_attempt_at!).getTime()).toBeGreaterThan(Date.now());
  }, 30_000);

  it("stops retrying after the maximum number of attempts", async () => {
    const id = await email.sendEmail({ to: `retry-${tag}@test.local`, subject: "Give up", text: "x" });
    await execute(`UPDATE email_outbox SET attempts = ? WHERE id = ?`, [email.MAX_ATTEMPTS - 1, id]);
    await execute(`UPDATE email_outbox SET next_attempt_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?`, [id]);
    await email.retryDueEmails();
    const row = await queryOne<Row & { attempts: number; next_attempt_at: Date | null }>(`SELECT attempts, next_attempt_at FROM email_outbox WHERE id = ?`, [id]);
    expect(Number(row!.attempts)).toBe(email.MAX_ATTEMPTS);
    expect(row!.next_attempt_at).toBeNull();
  }, 30_000);
});
