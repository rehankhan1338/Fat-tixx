import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTicketByCode, ticketDayLabel } from "@/lib/orders/queries";
import { ticketQrDataUrl } from "@/lib/tickets";
import { formatEventDate, formatTimeOnly } from "@/lib/tz";
import { StatusBadge } from "@/components/shared";
import { holderMayTransfer } from "@/lib/orders/transfer";
import { HolderTransferButton } from "./transfer-client";
import { SaveTicketImageButton } from "./save-image-button";

export const metadata: Metadata = { title: "Ticket", robots: { index: false } };

/** Full-screen ticket for the door. Access requires the first 12 chars of the ticket secret (from the email link). */
export default async function TicketPage({ params, searchParams }: PageProps<"/t/[code]">) {
  const { code } = await params;
  const sp = await searchParams;
  const t = await getTicketByCode(code.toUpperCase());
  if (!t || typeof sp.k !== "string" || !t.secret.startsWith(sp.k) || sp.k.length < 12) notFound();
  const live = ["valid", "used"].includes(t.ticket_status);
  const qr = live ? await ticketQrDataUrl(t.ticket_code, t.secret) : null;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-100 p-6 text-center">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white text-zinc-900 shadow-2xl">
        <div className="bg-zinc-900 px-6 py-4 text-left text-white">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Fat Tixx · {t.org_name}</p>
          <h1 className="mt-1 text-xl font-bold leading-tight">{t.event_title}</h1>
          <p className="mt-1 text-sm text-zinc-300">{formatEventDate(new Date(t.event_starts_at), t.event_timezone)}</p>
          {t.venue_name ? <p className="text-sm text-zinc-300">{t.venue_name}{t.venue_city ? `, ${t.venue_city}` : ""}</p> : null}
          {t.doors_at ? <p className="text-xs text-zinc-400">Doors {formatTimeOnly(new Date(t.doors_at), t.event_timezone)}</p> : null}
        </div>
        <div className="px-6 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr ? <img src={qr} alt="Ticket QR code" className="mx-auto w-64" /> : <div className="py-10 text-lg font-semibold text-red-600">This ticket is {t.ticket_status}.</div>}
          <p className="mt-2 font-mono text-sm tracking-widest text-zinc-500">{t.ticket_code}</p>
          <div className="mt-4 border-t border-dashed pt-4 text-left text-sm">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Ticket</p><p className="font-semibold">{t.ticket_type_name}{ticketDayLabel(t, t.event_timezone) ? ` · ${ticketDayLabel(t, t.event_timezone)}` : ""}{t.seat_label ? ` · ${t.seat_label}` : ""}</p>
            <p className="mt-2 text-xs uppercase tracking-wider text-zinc-500">Attendee</p><p className="font-semibold">{t.attendee_name ?? t.buyer_name ?? "—"}</p>
            <p className="mt-2 text-xs uppercase tracking-wider text-zinc-500">Order</p><p className="font-mono">{t.order_code}</p>
            {t.age_restriction ? <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900">{t.age_restriction}+ event — photo ID required</p> : null}
          </div>
        </div>
        <div className="flex items-center justify-between bg-zinc-100 px-6 py-3 text-xs text-zinc-500"><span>Status</span><StatusBadge status={t.ticket_status} /></div>
      </div>
      {qr ? <div className="mt-6"><SaveTicketImageButton ticketCode={t.ticket_code} k={sp.k} /></div> : null}
      <p className="mt-4 text-xs text-zinc-600">Screen brightness up. One scan per ticket.</p>
      {t.ticket_status === "valid" && !holderMayTransfer({ allow_transfers: t.allow_transfers, status: t.status, event_status: t.event_status, event_starts_at: t.event_starts_at }) ? (
        <div className="mt-3"><HolderTransferButton ticketCode={t.ticket_code} k={sp.k} /></div>
      ) : null}
    </main>
  );
}
