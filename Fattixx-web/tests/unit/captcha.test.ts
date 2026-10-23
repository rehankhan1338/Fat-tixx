/**
 * CAPTCHA on checkout and sign-up (src/lib/security/captcha.ts): off without keys, Cloudflare's answer decides
 * otherwise, and an outage at Cloudflare does not block buyers. `fetch` is mocked; nothing leaves the machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captchaEnabled, verifyCaptcha } from "@/lib/security/captcha";
import { humanCheck } from "@/lib/security/bot";

const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("Turnstile CAPTCHA", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
    process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is off unless both keys are set", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(captchaEnabled()).toBe(false);
    const f = answer({ success: false });
    vi.stubGlobal("fetch", f);
    expect(await verifyCaptcha(null, null)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects a missing token without asking Cloudflare", async () => {
    const f = answer({ success: true });
    vi.stubGlobal("fetch", f);
    expect(await verifyCaptcha("", "203.0.113.5")).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("sends secret, token and a real client IP; follows Cloudflare's verdict", async () => {
    const ok = answer({ success: true });
    vi.stubGlobal("fetch", ok);
    expect(await verifyCaptcha("tok", "203.0.113.5")).toBe(true);
    const body = (ok.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("203.0.113.5");
    expect(body.get("secret")).toBe("1x0000000000000000000000000000000AA");

    vi.stubGlobal("fetch", answer({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    expect(await verifyCaptcha("reused", "direct")).toBe(false);
  });

  it("lets requests through when Cloudflare is unreachable or our secret is wrong", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await verifyCaptcha("tok", null)).toBe(true);
    vi.stubGlobal("fetch", answer({}, 502));
    expect(await verifyCaptcha("tok", null)).toBe(true);
    vi.stubGlobal("fetch", answer({ success: false, "error-codes": ["invalid-input-secret"] }));
    expect(await verifyCaptcha("tok", null)).toBe(true);
  });

  it("humanCheck: honeypot first, then the CAPTCHA token from the form", async () => {
    vi.stubGlobal("fetch", answer({ success: false }));
    const fd = new FormData();
    fd.set("homepage", "spam");
    expect(await humanCheck(fd, null)).toBe("honeypot");
    fd.delete("homepage");
    fd.set("cf-turnstile-response", "bad");
    expect(await humanCheck(fd, null)).toBe("captcha");
    vi.stubGlobal("fetch", answer({ success: true }));
    expect(await humanCheck(fd, null)).toBeNull();
  });
});
