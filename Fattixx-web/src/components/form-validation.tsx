"use client";

import { useEffect, useRef, type RefObject } from "react";
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * App-wide form behaviour:
 *  - Validation feedback. The browser's own required/pattern checks still run; instead of its small transient
 *    bubble, the field turns red, the reason is written under it, and the page scrolls to the first problem.
 *    Server errors that name a field (`state.field`) get the same treatment.
 *  - No lost input. React 19 resets a form after every action, so a server error used to wipe everything typed.
 *    That automatic reset is cancelled everywhere; forms that should be blank again after a successful save
 *    opt in with `useClearOnSuccess`.
 */
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const isControl = (el: unknown): el is Control =>
  el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;

const messageId = (c: Control) => `${c.form?.id || "f"}-${c.id || c.name}-fx-error`;

/**
 * Where the message goes: under the box a person sees (the select wrapper, the checkbox's label, the input group
 * around a password field and its show/hide button), never inside it.
 */
function anchorFor(c: Control): Element {
  if (c instanceof HTMLInputElement && (c.type === "checkbox" || c.type === "radio")) return c.closest("label") ?? c;
  return c.closest('[data-slot="native-select-wrapper"], [data-slot="input-group"]') ?? c;
}

/** Radio buttons share one name: flag the whole group. */
function group(c: Control): Control[] {
  if (c instanceof HTMLInputElement && c.type === "radio" && c.form) {
    return [...c.form.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(c.name)}"]`)];
  }
  return [c];
}

function describedBy(c: Control, id: string, add: boolean) {
  const ids = new Set((c.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean));
  if (add) ids.add(id); else ids.delete(id);
  if (ids.size) c.setAttribute("aria-describedby", [...ids].join(" ")); else c.removeAttribute("aria-describedby");
}

export function showFieldError(c: Control, message: string) {
  const id = messageId(c);
  let p = document.getElementById(id);
  if (!p) {
    p = document.createElement("p");
    p.id = id;
    p.className = "text-xs font-medium text-destructive";
    anchorFor(c).after(p);
  }
  p.textContent = message;
  for (const el of group(c)) { el.setAttribute("aria-invalid", "true"); describedBy(el, id, true); }
}

export function clearFieldError(c: Control) {
  const id = messageId(c);
  document.getElementById(id)?.remove();
  for (const el of group(c)) { el.removeAttribute("aria-invalid"); describedBy(el, id, false); }
}

function reveal(el: HTMLElement) {
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
}

/** Reset a form on purpose (the global listener cancels every other reset). */
export function clearForm(form: HTMLFormElement) {
  form.dataset.fxClear = "1";
  form.reset();
}

/** For "add another" forms that stay on screen: blank the form after a successful save. Pass no state to opt out. */
export function useClearOnSuccess(state: { ok?: boolean } | undefined): RefObject<HTMLFormElement | null> {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && form.current) clearForm(form.current); }, [state]);
  return form;
}

/** Mounted once in the root layout; listens to every form on every page. */
export function FormValidation() {
  useEffect(() => {
    let lastReveal = 0;
    // `invalid` fires for each bad field, in page order, when a form is submitted; it does not bubble.
    const onInvalid = (e: Event) => {
      if (!isControl(e.target)) return;
      e.preventDefault(); // replace the browser bubble with the inline message
      showFieldError(e.target, e.target.validationMessage);
      const now = performance.now();
      if (now - lastReveal > 400) { lastReveal = now; reveal(e.target); }
    };
    const onEdit = (e: Event) => {
      const c = e.target;
      if (!isControl(c) || c.getAttribute("aria-invalid") !== "true") return;
      if (c.validity.valid) clearFieldError(c); else showFieldError(c, c.validationMessage);
    };
    // Cancel React's automatic post-action reset (and any other unrequested one); clearForm() is let through.
    const onReset = (e: Event) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.fxClear) {
        delete form.dataset.fxClear;
        for (const el of form.elements) if (isControl(el) && el.getAttribute("aria-invalid") === "true") clearFieldError(el);
        return;
      }
      e.preventDefault();
    };
    document.addEventListener("reset", onReset, true);
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    return () => {
      document.removeEventListener("reset", onReset, true);
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
    };
  }, []);
  return null;
}

/**
 * Error box for a server action result. Each new result scrolls into view; when the action names the
 * field (`field`), that field is highlighted and focused instead.
 */
const ERROR_TITLE = "Something went wrong";

export function ErrorAlert({ message, field, result }: { message: string; field?: string; result: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const item = field ? box.closest("form")?.elements.namedItem(field) : null;
    const control = item instanceof RadioNodeList ? item[0] : item;
    if (isControl(control) && control.type !== "hidden") {
      showFieldError(control, message);
      reveal(control);
    } else {
      reveal(box);
    }
  }, [message, field, result]);
  return (
    <Alert ref={ref} tabIndex={-1} variant="destructive" className="outline-none">
      <AlertCircleIcon />
      <AlertTitle>{ERROR_TITLE}</AlertTitle>
      {message === ERROR_TITLE ? null : <AlertDescription>{message}</AlertDescription>}
    </Alert>
  );
}

/**
 * Success box for a server action result (something saved, added or deleted). Like ErrorAlert, each new
 * result scrolls the box into view, so a message rendered above a long form is still seen after pressing
 * Save at the bottom of it.
 */
export function SuccessAlert({ message, result, className = "" }: { message: string; result: unknown; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) reveal(ref.current);
  }, [message, result]);
  return (
    <Alert ref={ref} tabIndex={-1} className={`border-emerald-500/40 text-emerald-700 outline-none dark:text-emerald-300 [&>svg]:text-emerald-700 dark:[&>svg]:text-emerald-300 ${className}`}>
      <CheckCircle2Icon />
      <AlertTitle>{message}</AlertTitle>
    </Alert>
  );
}
