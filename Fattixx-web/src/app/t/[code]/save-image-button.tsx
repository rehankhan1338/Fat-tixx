"use client";

import { SaveImageButton } from "@/components/save-image-button";

export function SaveTicketImageButton({ ticketCode, k }: { ticketCode: string; k: string }) {
  return (
    <SaveImageButton href={`/t/${ticketCode}/image?k=${encodeURIComponent(k)}`} filename={`ticket-${ticketCode}.jpg`} shareTitle="Ticket" className="bg-zinc-900 text-white hover:bg-zinc-800">
      Download ticket
    </SaveImageButton>
  );
}
