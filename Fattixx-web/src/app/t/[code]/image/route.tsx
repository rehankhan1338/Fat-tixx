import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getTicketByCode, ticketDayLabel } from "@/lib/orders/queries";
import { ticketQrDataUrl } from "@/lib/tickets";
import { formatEventDate, formatTimeOnly } from "@/lib/tz";

/**
 * The full-screen ticket as a JPG, so holders can save it to their phone's photos. Same access rule as the
 * ticket page (first 12 chars of the ticket secret). The QR inside is the live credential, so never cache it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const k = new URL(req.url).searchParams.get("k") ?? "";
  const t = await getTicketByCode(code.toUpperCase());
  if (!t || k.length < 12 || !t.secret.startsWith(k)) return new Response("Not found", { status: 404 });
  if (!["valid", "used"].includes(t.ticket_status)) return new Response(`This ticket is ${t.ticket_status}.`, { status: 410 });

  const qr = await ticketQrDataUrl(t.ticket_code, t.secret);
  const day = ticketDayLabel(t, t.event_timezone);
  const ticketLine = `${t.ticket_type_name}${day ? ` · ${day}` : ""}${t.seat_label ? ` · ${t.seat_label}` : ""}`;
  const label = { fontSize: 18, color: "#71717a", textTransform: "uppercase" as const, letterSpacing: 2 };
  const value = { fontSize: 28, fontWeight: 700, color: "#18181b", marginBottom: 18 };

  const png = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#f4f4f5", padding: 48 }}>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", background: "#ffffff", borderRadius: 48, overflow: "hidden" }}>
          <div style={{ display: "flex", flexDirection: "column", background: "#18181b", color: "#ffffff", padding: "36px 48px" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fbbf24", textTransform: "uppercase", letterSpacing: 3 }}>{`Fattixx · ${t.org_name}`}</div>
            <div style={{ fontSize: 44, fontWeight: 700, marginTop: 10, lineHeight: 1.15 }}>{t.event_title}</div>
            <div style={{ fontSize: 24, color: "#d4d4d8", marginTop: 12 }}>{formatEventDate(new Date(t.event_starts_at), t.event_timezone)}</div>
            {t.venue_name ? <div style={{ fontSize: 24, color: "#d4d4d8" }}>{`${t.venue_name}${t.venue_city ? `, ${t.venue_city}` : ""}`}</div> : null}
            {t.doors_at ? <div style={{ fontSize: 20, color: "#a1a1aa", marginTop: 4 }}>{`Doors ${formatTimeOnly(new Date(t.doors_at), t.event_timezone)}`}</div> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 48px 0" }}>
            {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
            <img src={qr} width={520} height={520} />
            <div style={{ fontSize: 26, color: "#71717a", letterSpacing: 6, marginTop: 12, fontFamily: "monospace" }}>{t.ticket_code}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", margin: "32px 48px 40px", paddingTop: 28, borderTop: "3px dashed #d4d4d8" }}>
            <div style={label}>Ticket</div><div style={value}>{ticketLine}</div>
            <div style={label}>Attendee</div><div style={value}>{t.attendee_name ?? t.buyer_name ?? "—"}</div>
            <div style={label}>Order</div><div style={{ ...value, marginBottom: 0 }}>{t.order_code}</div>
            {t.age_restriction ? <div style={{ marginTop: 24, borderRadius: 16, background: "#fef3c7", color: "#78350f", padding: "14px 20px", fontSize: 20, fontWeight: 700 }}>{`${t.age_restriction}+ event — photo ID required`}</div> : null}
          </div>
        </div>
      </div>
    ),
    { width: 800, height: 1500 },
  );
  // ImageResponse only renders PNG; holders asked for a JPG they can keep in their photos.
  const jpg = await sharp(Buffer.from(await png.arrayBuffer())).flatten({ background: "#f4f4f5" }).jpeg({ quality: 92 }).toBuffer();
  return new Response(new Uint8Array(jpg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="ticket-${t.ticket_code}.jpg"`,
      "X-Robots-Tag": "noindex",
    },
  });
}
