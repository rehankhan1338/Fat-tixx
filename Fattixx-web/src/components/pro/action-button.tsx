"use client";

import { useTransition, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * A button that runs a server action with hidden `fields` (no confirmation dialog; see ConfirmButton for that).
 * Errors and messages returned by the action appear as toasts; an action may also redirect.
 */
export function ActionButton({
  action, fields, children, variant = "outline", size = "sm", className,
}: {
  action: (fd: FormData) => Promise<{ error?: string; ok?: boolean; message?: string } | void | undefined>;
  fields: Record<string, string | number>;
  children: ReactNode;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "default" | "xs";
  className?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button" variant={variant} size={size} disabled={pending} className={className}
      onClick={() => start(async () => {
        const fd = new FormData();
        for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
        const r = await action(fd);
        if (r?.error) toast.error(r.error);
        else if (r?.message) toast.success(r.message);
      })}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      {children}
    </Button>
  );
}
