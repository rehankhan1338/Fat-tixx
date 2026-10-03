"use client";

import { useTransition, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Destructive / irreversible actions go through an AlertDialog, then call a server action.
 * The action receives the hidden `fields` as FormData and may return { error } or { ok }.
 */
export function ConfirmButton({
  action, fields = {}, title, description, confirmText = "Confirm", children, variant = "destructive", size = "sm", successText,
}: {
  action: (formData: FormData) => Promise<{ error?: string; ok?: boolean } | void>;
  fields?: Record<string, string | number>;
  title: string; description?: ReactNode; confirmText?: string; children: ReactNode;
  variant?: "destructive" | "outline" | "default" | "secondary" | "ghost"; size?: "sm" | "default" | "xs"; successText?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant={variant} size={size} disabled={pending} />}>
        {pending ? <Loader2Icon className="animate-spin" /> : null}
        {children}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={() => start(async () => {
              const fd = new FormData();
              for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
              const res = await action(fd);
              if (res && "error" in res && res.error) toast.error(res.error);
              else if (successText) toast.success(successText);
            })}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
