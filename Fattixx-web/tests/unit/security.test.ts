import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, passwordPolicyErrors, verifyPassword } from "@/lib/security/password";
import { lockDurationMinutes } from "@/lib/security/rate-limit";
import { signTicket, verifyTicketPayload } from "@/lib/tickets";

describe("password policy", () => {
  it("enforces length, repetition and email rules", () => {
    expect(passwordPolicyErrors("short")).toContain("Use at least 12 characters.");
    expect(passwordPolicyErrors("aaaa-bbbb-cccc")).toContain("No character repeated four or more times in a row.");
    expect(passwordPolicyErrors("onlylettersnodigits")).toContain("Use more than only letters.");
    expect(passwordPolicyErrors("rehan-super-secret-1", "rehan@example.com")).toContain("Must not contain your email name.");
    expect(passwordPolicyErrors("Correct-Horse-Battery-9")).toEqual([]);
  });

  it("hashes with Argon2id and verifies", async () => {
    const hash = await hashPassword("Correct-Horse-Battery-9");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "Correct-Horse-Battery-9")).toBe(true);
    expect(await verifyPassword(hash, "wrong-password-xx")).toBe(false);
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
    expect(needsRehash(hash)).toBe(false);
    expect(needsRehash("$argon2id$v=19$m=4096,t=1,p=1$abc$def")).toBe(true);
    expect(needsRehash("$2b$10$bcrypt")).toBe(true);
  }, 20_000);
});

describe("lockout schedule", () => {
  it("locks after 5 failures and doubles up to 24h", () => {
    expect(lockDurationMinutes(4)).toBe(0);
    expect(lockDurationMinutes(5)).toBe(15);
    expect(lockDurationMinutes(6)).toBe(30);
    expect(lockDurationMinutes(7)).toBe(60);
    expect(lockDurationMinutes(20)).toBe(1440);
  });
});

describe("signed ticket payloads", () => {
  const code = "H2BT56TWX6TT", secret = "0123456789abcdef0123456789abcdef";
  it("signs and verifies", () => {
    const payload = signTicket(code, secret);
    expect(payload.startsWith(`FTX1.${code}.${secret}.`)).toBe(true);
    expect(verifyTicketPayload(payload)).toEqual({ code, secret });
  });
  it("rejects tampering", () => {
    const payload = signTicket(code, secret);
    expect(verifyTicketPayload(payload.replace(code, "H2BT56TWX6TX"))).toBeNull();
    expect(verifyTicketPayload(payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(verifyTicketPayload("FTX1.BADCODE1234.deadbeef.xx")).toBeNull();
    expect(verifyTicketPayload("")).toBeNull();
    expect(verifyTicketPayload("garbage")).toBeNull();
  });
});
