import { describe, expect, it } from "vitest";
import { humanCode, slugify } from "@/lib/slug";
import { randomToken, safeEqual, sha256 } from "@/lib/security/crypto";

describe("slugify", () => {
  it("normalises titles", () => {
    expect(slugify("Demo Night Live!")).toBe("demo-night-live");
    expect(slugify("  Café — Été 2026 ")).toBe("cafe-ete-2026");
    expect(slugify("///")).toBe("item");
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(60);
  });
});

describe("humanCode", () => {
  it("uses an unambiguous alphabet and a prefix", () => {
    for (let i = 0; i < 200; i++) {
      const c = humanCode(12);
      expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
    }
    expect(humanCode(6, "FTX-")).toMatch(/^FTX-[A-Z2-9]{6}$/);
  });
});

describe("crypto helpers", () => {
  it("tokens are url-safe and unique", () => {
    const a = randomToken(), b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("sha256 is stable", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("safeEqual compares in constant time semantics", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreT")).toBe(false);
    expect(safeEqual("short", "longer-value")).toBe(false);
  });
});
