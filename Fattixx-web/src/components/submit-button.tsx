"use client";

import { useFormStatus } from "react-dom";
import { Loader2Icon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function SubmitButton({
  children, pendingText, ...props
}: { children: ReactNode; pendingText?: string } & Omit<ComponentProps<typeof Button>, "type">) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} type="submit" disabled={pending || props.disabled} aria-busy={pending}>
      {pending ? <Loader2Icon className="animate-spin" /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}
