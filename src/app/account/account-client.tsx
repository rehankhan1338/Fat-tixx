"use client";

import { useActionState, useState, useTransition } from "react";
import { DownloadIcon, MailCheckIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { resendVerificationEmail } from "@/lib/auth/actions";
import { deleteMyAccount } from "@/lib/privacy/actions";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function VerifyEmailBanner({ email, justSent }: { email: string; justSent: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Alert className="mt-6">
      <MailCheckIcon />
      <AlertTitle>{justSent ? "Check your inbox to confirm your email" : "Confirm your email address"}</AlertTitle>
      <AlertDescription>
        <p>We sent a link to <strong>{email}</strong>. Once you confirm it, tickets you bought earlier as a guest with this email appear here.</p>
        <Button size="sm" variant="outline" className="mt-2" disabled={pending} onClick={() => start(async () => {
          const r = await resendVerificationEmail();
          if (r?.error) toast.error(r.error); else toast.success(r?.message ?? "Sent");
        })}>Send the link again</Button>
      </AlertDescription>
    </Alert>
  );
}

export function PrivacyPanel({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(deleteMyAccount, undefined);
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" nativeButton={false} render={<a href="/api/account/export" download />}><DownloadIcon /> Download my data</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="ghost" className="text-destructive" />}><Trash2Icon /> Delete my account</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Your name, email, phone and password are removed and you are signed out everywhere. Order and check-in records are kept, without your account, for as long as accounting and dispute rules require. Tickets you already bought stay valid.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="space-y-4">
            <FormStatus state={state} />
            {hasPassword ? <TextField label="Your password" id="del-password" name="password" type="password" autoComplete="current-password" required /> : null}
            <TextField label="Type DELETE to confirm" id="del-confirm" name="confirm" required autoComplete="off" />
            <SubmitButton variant="destructive" className="w-full" pendingText="Deleting…">Delete my account</SubmitButton>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
