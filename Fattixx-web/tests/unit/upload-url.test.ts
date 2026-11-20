import { describe, expect, it } from "vitest";
import { uploadUrl } from "@/lib/uploads";

describe("uploadUrl", () => {
  it("passes Space URLs (CDN and origin) through unchanged", () => {
    const cdn = "https://fattixx.sfo3.cdn.digitaloceanspaces.com/uploads/events/mwp2ux4m-6f2be03f2270.webp";
    const origin = "https://fattixx.sfo3.digitaloceanspaces.com/uploads/orgs/abc-123.webp";
    expect(uploadUrl(cdn)).toBe(cdn);
    expect(uploadUrl(origin)).toBe(origin);
  });

  it("serves locally stored uploads from /api/uploads", () => {
    expect(uploadUrl("events/mwoy5fuy-1d6602fcf00b.webp")).toBe("/api/uploads/events/mwoy5fuy-1d6602fcf00b.webp");
    expect(uploadUrl("seatmaps/abc-123.pdf")).toBe("/api/uploads/seatmaps/abc-123.pdf");
  });

  it("returns null for old Vercel Blob URLs, so pages show their no-image state", () => {
    expect(uploadUrl("https://abcd1234.public.blob.vercel-storage.com/uploads/events/x-1.webp")).toBeNull();
  });

  it("returns null for nothing or anything unrecognised", () => {
    expect(uploadUrl(null)).toBeNull();
    expect(uploadUrl(undefined)).toBeNull();
    expect(uploadUrl("")).toBeNull();
    expect(uploadUrl("../../etc/passwd")).toBeNull();
    expect(uploadUrl("https://example.com/image.webp")).toBeNull();
  });
});
