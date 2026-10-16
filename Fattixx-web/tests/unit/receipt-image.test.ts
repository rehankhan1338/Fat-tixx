/**
 * The order receipt image route renders a JPG from order data (queries and access are mocked, no database).
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import sharp from "sharp";

const order = {
  id: 1, code: "FTX7K2M9", status: "paid", currency: "USD", org_name: "Night Owl Events", event_title: "Summer Rooftop Party with a fairly long title that wraps",
  event_starts_at: new Date("2026-07-04T23:00:00Z"), event_timezone: "America/New_York", venue_name: "The Loft",
  buyer_name: "Jordan Lee", buyer_email: "jordan@example.com", paid_at: new Date("2026-06-01T15:04:00Z"), created_at: new Date("2026-06-01T15:00:00Z"),
  discount_cents: 500, platform_fee_cents: 350, processing_fee_cents: 120, tax_cents: 410, total_cents: 7380, refunded_cents: 0,
};

vi.mock("@/lib/orders/queries", () => ({
  getOrderByCode: vi.fn(async (code: string) => (code === order.code ? order : null)),
  listOrderItems: vi.fn(async () => [{ id: 1, quantity: 2, ticket_type_name: "General Admission", unit_price_cents: 2500, unit_discount_cents: 250 }]),
  listOrderAddons: vi.fn(async () => [{ id: 1, quantity: 1, addon_name: "Parking", unit_price_cents: 1500 }]),
}));
vi.mock("@/lib/orders/access", () => ({ canAccessOrder: vi.fn(async (_o: unknown, token: string | null) => token === "good-token") }));

describe("GET /orders/[code]/receipt", () => {
  it("renders a JPG receipt for an accessible paid order", async () => {
    const { GET } = await import("@/app/orders/[code]/receipt/route");
    const res = await GET(new Request(`http://localhost/orders/${order.code}/receipt?t=good-token`), { params: Promise.resolve({ code: order.code }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toContain(`receipt-${order.code}.jpg`);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(800);
    if (process.env.RECEIPT_OUT) fs.writeFileSync(process.env.RECEIPT_OUT, buf);
  });

  it("hides the receipt without access and before payment", async () => {
    const { GET } = await import("@/app/orders/[code]/receipt/route");
    const denied = await GET(new Request(`http://localhost/orders/${order.code}/receipt?t=bad`), { params: Promise.resolve({ code: order.code }) });
    expect(denied.status).toBe(404);
    const { getOrderByCode } = await import("@/lib/orders/queries");
    vi.mocked(getOrderByCode).mockResolvedValueOnce({ ...order, status: "pending" } as never);
    const pending = await GET(new Request(`http://localhost/orders/${order.code}/receipt?t=good-token`), { params: Promise.resolve({ code: order.code }) });
    expect(pending.status).toBe(410);
  });
});
