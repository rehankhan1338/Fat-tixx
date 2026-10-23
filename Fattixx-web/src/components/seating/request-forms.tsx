"use client";

/* Small forms shared by the organizer's and the staff's seat map request pages. Actions are passed in as props. */

import { useActionState, useTransition, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { useClearOnSuccess } from "@/components/form-validation";
import { FormStatus, SelectField, TextAreaField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";

type State = { error?: string; ok?: boolean; message?: string } | undefined;

/** A message box posting `body` plus hidden fields to a (prev, formData) action. */
export function MessageForm({ action, fields, label, submit, hint, required = true, rows = 4, variant = "default" }: {
  action: (prev: State, fd: FormData) => Promise<State>; fields: Record<string, string | number>; label: string; submit: string; hint?: string; required?: boolean; rows?: number;
  variant?: "default" | "outline" | "destructive";
}) {
  const [state, run] = useActionState(action, undefined);
  const form = useClearOnSuccess(state);
  const id = `msg-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <form ref={form} action={run} className="space-y-3">
      <FormStatus state={state} successText={state?.message} />
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <TextAreaField label={label} id={id} name="body" required={required} rows={rows} maxLength={10_000} hint={hint} />
      <SubmitButton size="sm" variant={variant} pendingText="Sending…">{submit}</SubmitButton>
    </form>
  );
}

/** One button that runs an (formData) action and toasts the result. */
export function RunButton({ action, fields, children, variant = "outline", size = "sm", success }: {
  action: (fd: FormData) => Promise<State>; fields: Record<string, string | number>; children: ReactNode;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive"; size?: "sm" | "default" | "xs"; success?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant={variant} size={size} disabled={pending} onClick={() => start(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
      const r = await action(fd);
      if (r?.error) toast.error(r.error);
      else if (r?.message || success) toast.success(r?.message ?? success);
    })}>
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      {children}
    </Button>
  );
}

/** Choose an option and run an action with it (e.g. copy a map into the draft). */
export function SelectRun({ action, fields, name, label, options, submit }: {
  action: (fd: FormData) => Promise<State>; fields: Record<string, string | number>; name: string; label: string; options: { value: string; label: string }[]; submit: string;
}) {
  const [state, run] = useActionState(async (_p: State, fd: FormData) => action(fd), undefined);
  return (
    <form action={run} className="flex flex-wrap items-end gap-2">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SelectField label={label} id={`sel-${name}`} name={name} options={options} className="min-w-56 flex-1" />
      <SubmitButton size="sm" variant="outline" pendingText="Working…">{submit}</SubmitButton>
      <div className="basis-full"><FormStatus state={state} /></div>
    </form>
  );
}
