"use client";

import { useActionState, useState } from "react";
import { PlusIcon } from "lucide-react";
import { createOrganization } from "@/lib/orgs/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { FormStatus, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";

export function NewOrganizationDialog({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, action] = useActionState(createOrganization, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}><PlusIcon /> New organization</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>An organization owns its events, team, reports and payouts. You can invite its first admin now or later.</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" id="name" name="name" required maxLength={160} autoFocus />
            <TextField label="URL slug" id="slug" name="slug" maxLength={64} placeholder="auto from name" hint="Lowercase letters, numbers, dashes" />
            <TextField label="Contact email" id="contact_email" name="contact_email" type="email" required />
            <TextField label="Phone" id="contact_phone" name="contact_phone" type="tel" />
            <TextField label="Legal name" id="legal_name" name="legal_name" hint="For settlement statements" />
            <TextField label="Website" id="website" name="website" type="url" placeholder="https://" />
          </div>
          <Separator />
          <p className="text-sm font-medium">First Organization Admin <span className="font-normal text-muted-foreground">(optional)</span></p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Admin name" id="admin_name" name="admin_name" />
            <TextField label="Admin email" id="admin_email" name="admin_email" type="email" hint="They receive a link to set their password." />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton pendingText="Creating…">Create organization</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
