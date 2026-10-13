"use client";

import { useRouter } from "next/navigation";
import { transferTicketFromLink } from "@/lib/orders/actions";
import { TransferTicketDialog } from "@/components/transfer-ticket-dialog";

export function HolderTransferButton({ ticketCode, k }: { ticketCode: string; k: string }) {
  const router = useRouter();
  return (
    <TransferTicketDialog
      action={transferTicketFromLink}
      fields={{ ticket: ticketCode, k }}
      ticketCode={ticketCode}
      triggerProps={{ variant: "ghost", size: "sm", className: "text-zinc-600 hover:text-zinc-900" }}
      onDone={() => router.refresh()}
    />
  );
}
