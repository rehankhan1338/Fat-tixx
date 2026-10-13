"use client";

import { useState, type ComponentProps } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

/**
 * Password input with a show/hide (eye) toggle. Drop-in for `<Input type="password">`: all props go to
 * the underlying <input>, so name, id, autocomplete and validation behave exactly as before.
 */
export function PasswordInput({ className, disabled, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "Hide password" : "Show password";
  return (
    <InputGroup className={className}>
      <InputGroupInput {...props} type={visible ? "text" : "password"} disabled={disabled} />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label={label} aria-pressed={visible} title={label} disabled={disabled} onClick={() => setVisible((v) => !v)}>
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
