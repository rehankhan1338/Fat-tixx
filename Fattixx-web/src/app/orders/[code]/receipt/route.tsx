import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getOrderByCode, listOrderAddons, listOrderItems } from "@/lib/orders/queries";
import { canAccessOrder } from "@/lib/orders/access";
import { formatCents } from "@/lib/money";
import { formatEventDate } from "@/lib/tz";

const STATUS_LABEL: Record<string, string> = { paid: "Paid", partially_refunded: "Partially refunded", refunded: "Refunded", cancelled: "Cancelled" };

/**
 * The order receipt as a JPG, so buyers can keep it in their photos or attach it to an expense claim.
 * Same access rule as the order page (?t= token from the email link, the order cookie, or a signed-in owner).
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const token = new URL(req.url).searchParams.get("t");
  const order = await getOrderByCode(code.toUpperCase());
  if (!order || !(await canAccessOrder(order, token))) return new Response("Not found", { status: 404 });
  if (!(order.status in STATUS_LABEL)) return new Response("This order has no receipt yet.", { status: 410 });
  const [items, addons] = await Promise.all([listOrderItems(order.id), listOrderAddons(order.id)]);

  const money = (cents: number) => formatCents(cents, order.currency);
  const lines: { label: string; amount: string; color?: string }[] = [
    ...items.map((i) => ({ label: `${i.quantity} × ${i.ticket_type_name}`, amount: money((Number(i.unit_price_cents) + Number(i.unit_discount_cents ?? 0)) * Number(i.quantity)) })),
    ...addons.map((a) => ({ label: `${a.quantity} × ${a.addon_name} (add-on)`, amount: money(Number(a.unit_price_cents) * Number(a.quantity)) })),
  ];
  if (Number(order.discount_cents)) lines.push({ label: "Promo discount", amount: `−${money(Number(order.discount_cents))}`, color: "#047857" });
  if (Number(order.platform_fee_cents)) lines.push({ label: "Service fee", amount: money(Number(order.platform_fee_cents)), color: "#71717a" });
  if (Number(order.processing_fee_cents)) lines.push({ label: "Card processing", amount: money(Number(order.processing_fee_cents)), color: "#71717a" });
  if (Number(order.tax_cents)) lines.push({ label: "Tax", amount: money(Number(order.tax_cents)), color: "#71717a" });
  const refunded = Number(order.refunded_cents);
  const paidAt = order.paid_at ?? order.created_at;

  const label = { fontSize: 18, color: "#71717a", textTransform: "uppercase" as const, letterSpacing: 2 };
  const value = { fontSize: 26, fontWeight: 700, color: "#18181b" };
  const row = { display: "flex", justifyContent: "space-between", fontSize: 24, color: "#18181b", padding: "9px 0" };
  // Satori needs a fixed canvas: header, event and buyer blocks, one row per line, totals, and the footer.
  // Long titles wrap at roughly 40 characters per line at this size; spare rows just widen the bottom margin.
  const titleRows = Math.ceil(order.event_title.length / 40);
  const height = 840 + titleRows * 34 + lines.length * 48 + (refunded ? 48 : 0) + (addons.length ? 32 : 0);

  const png = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "flex-start", justifyContent: "center", background: "#f4f4f5", padding: 48 }}>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", background: "#ffffff", borderRadius: 48, overflow: "hidden" }}>
          <div style={{ display: "flex", flexDirection: "column", background: "#18181b", color: "#ffffff", padding: "36px 48px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fbbf24", textTransform: "uppercase", letterSpacing: 3 }}>{`Fattixx · ${order.org_name}`}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#18181b", background: refunded ? "#fde68a" : "#a7f3d0", borderRadius: 999, padding: "6px 14px", textTransform: "uppercase", letterSpacing: 2 }}>{STATUS_LABEL[order.status]}</div>
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, marginTop: 10, lineHeight: 1.15 }}>Receipt</div>
            <div style={{ fontSize: 24, color: "#d4d4d8", marginTop: 12, fontFamily: "monospace", letterSpacing: 3 }}>{order.code}</div>
            <div style={{ fontSize: 20, color: "#a1a1aa", marginTop: 4 }}>{formatEventDate(new Date(paidAt), order.event_timezone, { withTime: true, withZone: true })}</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", padding: "36px 48px 0" }}>
            <div style={label}>Event</div>
            <div style={{ ...value, marginTop: 4 }}>{order.event_title}</div>
            <div style={{ fontSize: 22, color: "#52525b", marginTop: 6 }}>{`${formatEventDate(new Date(order.event_starts_at), order.event_timezone)}${order.venue_name ? ` · ${order.venue_name}` : ""}`}</div>
            <div style={{ ...label, marginTop: 24 }}>Billed to</div>
            <div style={{ ...value, marginTop: 4 }}>{order.buyer_name ?? order.buyer_email}</div>
            {order.buyer_name ? <div style={{ fontSize: 22, color: "#52525b", marginTop: 4 }}>{order.buyer_email}</div> : null}
          </div>

          <div style={{ display: "flex", flexDirection: "column", margin: "32px 48px 0", paddingTop: 24, borderTop: "3px dashed #d4d4d8" }}>
            {lines.map((l, i) => (
              <div key={i} style={{ ...row, color: l.color ?? "#18181b" }}>
                <div style={{ display: "flex", flex: 1, paddingRight: 24 }}>{l.label}</div>
                <div style={{ display: "flex", fontFamily: "monospace" }}>{l.amount}</div>
              </div>
            ))}
            <div style={{ ...row, fontSize: 30, fontWeight: 700, marginTop: 12, paddingTop: 20, borderTop: "3px solid #18181b" }}>
              <div style={{ display: "flex" }}>Total paid</div>
              <div style={{ display: "flex", fontFamily: "monospace" }}>{money(Number(order.total_cents))}</div>
            </div>
            {refunded ? (
              <div style={{ ...row, color: "#b91c1c", fontWeight: 700 }}>
                <div style={{ display: "flex" }}>Refunded</div>
                <div style={{ display: "flex", fontFamily: "monospace" }}>{`−${money(refunded)}`}</div>
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", flexDirection: "column", padding: "28px 48px 40px", fontSize: 18, color: "#71717a" }}>
            <div>{`Sold by ${order.org_name} via Fattixx. Prices in ${order.currency}.`}</div>
            {addons.length ? <div style={{ marginTop: 6 }}>Add-ons have no QR code: show this order number at the venue to collect them.</div> : null}
          </div>
        </div>
      </div>
    ),
    { width: 800, height },
  );
  // ImageResponse only renders PNG; a JPG is what phones file under photos.
  const jpg = await sharp(Buffer.from(await png.arrayBuffer())).flatten({ background: "#f4f4f5" }).jpeg({ quality: 92 }).toBuffer();
  return new Response(new Uint8Array(jpg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="receipt-${order.code}.jpg"`,
      "X-Robots-Tag": "noindex",
    },
  });
}
