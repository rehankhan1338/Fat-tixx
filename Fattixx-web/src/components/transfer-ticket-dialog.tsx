"use client";

import { useActionState, useState, type ComponentProps, type ReactNode } from "react";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormStatus, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

type State = { error?: string; ok?: boolean; message?: string } | undefined;

/** Transfer one ticket to someone else. `action` is a transfer server action; `fields` are its hidden inputs. */
export function TransferTicketDialog({ action, fields, ticketCode, description, trigger, triggerProps, onDone }: {
  action: (prev: State, fd: FormData) => Promise<State>;
  fields: Record<string, string | number>;
  ticketCode: string;
  description?: ReactNode;
  trigger?: ReactNode;
  triggerProps?: ComponentProps<typeof Button>;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(async (prev: State, fd: FormData) => {
    const r = await action(prev, fd);
    if (r?.ok) { toast.success(r.message ?? "Ticket transferred"); setOpen(false); onDone?.(); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" {...triggerProps} />}>{trigger ?? <><SendIcon /> Transfer ticket</>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer ticket {ticketCode}</DialogTitle>
          <DialogDescription>{description ?? "The recipient gets a new ticket by email. Your current QR code and ticket link stop working immediately. This cannot be undone."}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <FormStatus state={state} />
          {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Recipient name" id={`tr-name-${ticketCode}`} name="to_name" required minLength={2} autoComplete="off" />
            <TextField label="Recipient email" id={`tr-email-${ticketCode}`} name="to_email" type="email" required autoComplete="off" />
          </div>
          <TextAreaField label="Message (optional, included in the email)" id={`tr-note-${ticketCode}`} name="note" rows={2} maxLength={300} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton pendingText="Transferring…">Transfer & email</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
