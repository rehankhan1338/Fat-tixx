import type { ChangeEventHandler, ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ErrorAlert, SuccessAlert } from "@/components/form-validation";

/**
 * Renders the {error, ok} state returned by server actions. Both the error and the success box scroll
 * into view when they appear; an error that also names `field` (the input's name) gets that field
 * highlighted and focused instead.
 */
export function FormStatus({ state, successText }: { state: { error?: string; ok?: boolean; field?: string } | undefined; successText?: string }) {
  if (state?.error) return <ErrorAlert message={state.error} field={state.field} result={state} />;
  if (state?.ok && successText) return <SuccessAlert message={successText} result={state} />;
  return null;
}

export function FieldWrap({ label, htmlFor, hint, children, className = "" }: { label: ReactNode; htmlFor: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div data-fx-field="" className={`grid gap-1.5 ${className}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Text input with label and hint. `type="password"` automatically gets a show/hide (eye) toggle. */
export function TextField({ label, hint, className, ...props }: { label: ReactNode; hint?: ReactNode; className?: string } & ComponentProps<typeof Input> & { id: string; name: string }) {
  const { type, ...rest } = props;
  return (
    <FieldWrap label={label} htmlFor={props.id} hint={hint} className={className}>
      {type === "password" ? <PasswordInput {...rest} /> : <Input {...props} />}
    </FieldWrap>
  );
}

export function TextAreaField({ label, hint, className, ...props }: { label: ReactNode; hint?: ReactNode; className?: string } & ComponentProps<typeof Textarea> & { id: string; name: string }) {
  return (
    <FieldWrap label={label} htmlFor={props.id} hint={hint} className={className}>
      <Textarea {...props} />
    </FieldWrap>
  );
}

export function SelectField({ label, hint, options, className, ...props }: {
  label: ReactNode; hint?: ReactNode; className?: string; options: { value: string; label: string }[];
} & ComponentProps<typeof NativeSelect> & { id: string; name: string }) {
  return (
    <FieldWrap label={label} htmlFor={props.id} hint={hint} className={className}>
      <NativeSelect {...props}>
        {options.map((o) => <NativeSelectOption key={o.value} value={o.value}>{o.label}</NativeSelectOption>)}
      </NativeSelect>
    </FieldWrap>
  );
}

/** Native checkbox styled to match; submits "1" when checked. */
export function CheckField({ label, hint, id, name, defaultChecked, required, onChange }: { label: ReactNode; hint?: ReactNode; id: string; name: string; defaultChecked?: boolean; required?: boolean; onChange?: ChangeEventHandler<HTMLInputElement> }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-accent/40 has-aria-invalid:border-destructive has-aria-invalid:bg-destructive/5">
      <input id={id} name={name} type="checkbox" value="1" defaultChecked={defaultChecked} required={required} onChange={onChange} className="mt-0.5 size-4 accent-[var(--primary)]" />
      <span className="grid gap-0.5 text-sm">
        <span className="font-medium leading-none">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}
