"use client";

import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { ArrowLeftIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { submitApplication, type ActionState } from "@/lib/applications/actions";
import { QUESTIONS, type Question, type QuestionName } from "@/lib/applications/questionnaire";
import { BotFields } from "@/components/bot-fields";
import { Captcha } from "@/components/captcha";
import { CheckField, FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { button, cx, eyebrow } from "@/components/ui/styles";
import festImage from "../../../public/images/events/fest.jpg";
import clubImage from "../../../public/images/events/club.jpg";
import confImage from "../../../public/images/events/conf.jpg";
import galaImage from "../../../public/images/events/gala.jpg";
import goOutImage from "../../../public/images/hero/go-out.webp";
import throwOneImage from "../../../public/images/hero/throw-one.webp";

/**
 * The organizer application as short steps: the questionnaire (one question per screen, each skippable), then
 * "About you" and "Your organization". Every step stays mounted, hidden when it isn't the current one, so the last
 * step posts them all together; each step's fields are checked before moving on.
 */

const PHOTOS: Record<QuestionName, StaticImageData> = {
  event_types: festImage, expected_revenue: clubImage, events_per_year: throwOneImage,
  typical_attendance: confImage, attendee_ages: goOutImage, audiences: galaImage,
};
/** the questions, then "About you" and "Your organization" */
const YOU = QUESTIONS.length + 1;
const TOTAL = QUESTIONS.length + 2;

const toStep = (v: string | null) => Math.min(Math.max(Math.trunc(Number(v)) || 1, 1), TOTAL);
/** The step in the address bar, which is current even before React re-renders (a quick double click). */
const urlStep = () => toStep(new URLSearchParams(window.location.search).get("step"));

/** Runs the browser's checks on one step's fields; FormValidation writes the reason under each field that fails. */
function stepIsValid(section: Element) {
  let ok = true;
  for (const el of section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea")) {
    if (!el.checkValidity()) ok = false;
  }
  return ok;
}

const chip = (on: boolean) => cx(
  "inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-colors duration-200 select-none",
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-fx-red",
  on ? "bg-fx-red text-fx-ivory" : "bg-fx-sand text-fx-red hover:bg-fx-red/10",
);
const heading = "mt-2 font-display text-[clamp(28px,6vw,38px)] leading-[1.08] font-semibold tracking-[-0.03em] outline-none";
const lead = "mt-3 text-[15px] leading-[1.55] text-fx-red/78";

export function ApplyForm({ defaultName, defaultEmail, defaultEvents, notices }: { defaultName?: string; defaultEmail?: string; defaultEvents?: string; notices: string[] }) {
  const form = useRef<HTMLFormElement>(null);
  const firstMore = useRef<HTMLInputElement>(null);
  const step = toStep(useSearchParams().get("step"));
  const [answers, setAnswers] = useState<Partial<Record<QuestionName, string[]>>>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [state, dispatch, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await submitApplication(prev, fd);
    // the server can still turn down a field from an earlier step (a name of only spaces, say): go back to it
    const field = result?.field ? form.current?.elements.namedItem(result.field) : null;
    const at = Number(field instanceof Element ? field.closest<HTMLElement>("[data-step]")?.dataset.step : 0);
    if (at && at < urlStep()) window.history.go(at - urlStep());
    return result;
  }, undefined);

  // a new step: start at its top and move focus to its question (or to a field the server turned down), for keyboard and screen-reader users
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    const section = form.current?.querySelector(`[data-step="${step}"]`);
    const rejected = section?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (rejected) { rejected.focus(); return; }
    window.scrollTo({ top: 0 });
    section?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [step]);

  const question = step <= QUESTIONS.length ? QUESTIONS[step - 1] : null;

  /** Each step is a history entry, so the browser's back button returns to the previous one. */
  function forward() {
    const p = new URLSearchParams(window.location.search);
    p.set("step", String(Math.min(urlStep() + 1, TOTAL)));
    window.history.pushState(null, "", `?${p}`);
  }

  function choose(q: Question, value: string) {
    setAnswers((a) => {
      const cur = a[q.name] ?? [];
      return { ...a, [q.name]: !q.multiple ? [value] : cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  }

  function skip(q: Question) {
    setAnswers((a) => ({ ...a, [q.name]: [] }));
    forward();
  }

  function showMore() {
    flushSync(() => setMoreOpen(true));
    firstMore.current?.focus();
  }

  // Next, Enter in a field and the final "Apply" all land here. The form has noValidate: only the current step is checked.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const current = e.currentTarget.querySelector(`[data-step="${step}"]`);
    if (pending || !current || !stepIsValid(current)) return;
    if (step < TOTAL) return forward();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  }

  if (state?.ok) {
    return (
      <div className="mx-auto max-w-[560px] py-10 text-center">
        <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-fx-yellow text-fx-red">
          <CheckIcon className="size-8" strokeWidth={2.6} aria-hidden="true" />
        </span>
        <h1 ref={(el) => { el?.focus(); }} tabIndex={-1} className={cx(heading, "mt-6")}>Thanks for applying</h1>
        <p className={lead}>{state.message}</p>
        <Link href="/events" className={cx(button("red"), "mt-8")}>Browse events</Link>
      </div>
    );
  }

  return (
    <form ref={form} onSubmit={onSubmit} noValidate className="relative mx-auto flex w-full max-w-[640px] flex-col max-[901px]:min-h-[calc(100svh-96px)]">
      <BotFields />

      {QUESTIONS.map((q, i) => {
        const n = i + 1;
        const picked = answers[q.name] ?? [];
        const options = q.more && moreOpen ? [...q.options, ...q.more] : q.options;
        return (
          <section key={q.name} data-step={n} hidden={step !== n} aria-labelledby={`ap-${q.name}-h`} className="pb-6">
            {n === 1 && notices.map((t) => (
              <p key={t} className="mb-5 rounded-[16px] border border-fx-red/15 bg-fx-white px-4 py-3 text-[14px] leading-[1.5] text-fx-red">{t}</p>
            ))}
            <div className="relative aspect-[16/10] overflow-hidden rounded-[24px] bg-fx-sand shadow-[0_24px_48px_-30px_rgba(78,7,11,.55)] sm:aspect-[2/1]">
              {/* the next step's photo loads ahead so it is ready when Next is pressed */}
              <Image src={PHOTOS[q.name]} alt="" fill placeholder="blur" sizes="(max-width: 672px) 100vw, 640px" className="object-cover" preload={n === 1} loading={n === 1 ? undefined : n <= step + 1 ? "eager" : "lazy"} />
            </div>
            <p className={cx(eyebrow, "mt-8")}>Organizer sign-up · Step {n} of {TOTAL}</p>
            <h1 id={`ap-${q.name}-h`} tabIndex={-1} className={heading}>{q.title}</h1>
            {q.multiple && <p className={lead}>Choose all that apply.</p>}
            <div role={q.multiple ? "group" : "radiogroup"} aria-labelledby={`ap-${q.name}-h`} className="mt-6 flex flex-wrap gap-3">
              {options.map((x) => {
                const on = picked.includes(x.value);
                return (
                  <label key={x.value} className={chip(on)}>
                    <input
                      ref={x.value === q.more?.[0]?.value ? firstMore : undefined}
                      type={q.multiple ? "checkbox" : "radio"} name={q.name} value={x.value} checked={on} onChange={() => choose(q, x.value)} className="sr-only"
                    />
                    {on && <CheckIcon className="size-4" strokeWidth={3} aria-hidden="true" />}
                    {x.label}
                  </label>
                );
              })}
              {q.more && !moreOpen && <button type="button" aria-expanded="false" onClick={showMore} className={chip(false)}>More</button>}
            </div>
          </section>
        );
      })}

      <section data-step={YOU} hidden={step !== YOU} aria-labelledby="ap-you-h" className="pb-6">
        <p className={eyebrow}>Organizer sign-up · Step {YOU} of {TOTAL}</p>
        <h1 id="ap-you-h" tabIndex={-1} className={heading}>Tell us about you</h1>
        <p className={lead}>We’ll email you the result of your application.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <TextField label="Your name" id="ap-name" name="contact_name" required minLength={2} maxLength={160} autoComplete="name" defaultValue={defaultName} />
          <TextField label="Email" id="ap-email" name="contact_email" type="email" required maxLength={254} autoComplete="email" defaultValue={defaultEmail} />
          <TextField label="Phone" id="ap-phone" name="contact_phone" type="tel" maxLength={40} autoComplete="tel" hint="Optional" />
        </div>
      </section>

      <section data-step={TOTAL} hidden={step !== TOTAL} aria-labelledby="ap-org-h" className="pb-6">
        <p className={eyebrow}>Organizer sign-up · Step {TOTAL} of {TOTAL}</p>
        <h1 id="ap-org-h" tabIndex={-1} className={heading}>Your organization</h1>
        <p className={lead}>We verify every organizer before they can sell, which protects buyers and you. Most reviews take one to two business days.</p>
        <div className="mt-6 space-y-5">
          <FormStatus state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name buyers will see" id="ap-org" name="org_name" required minLength={2} maxLength={160} autoComplete="organization" />
            <SelectField label="Type" id="ap-type" name="business_type" defaultValue="company" options={[{ value: "company", label: "Company / promoter" }, { value: "venue", label: "Venue" }, { value: "nonprofit", label: "Nonprofit" }, { value: "individual", label: "Individual" }]} />
            <TextField label="Legal name (for payouts)" id="ap-legal" name="legal_name" required minLength={2} maxLength={200} hint="Person or registered business that will be paid" />
            <TextField label="Tax ID (last 4 digits)" id="ap-tax" name="tax_id_last4" inputMode="numeric" maxLength={4} pattern="\d{4}" hint="EIN or SSN; we never ask for the full number here" />
            <TextField label="Website or social page" id="ap-web" name="website" type="url" placeholder="https://" pattern="https?://\S+" title="Starts with http:// or https://" className="sm:col-span-2" />
            <TextField label="Business address" id="ap-addr" name="address" required minLength={5} maxLength={300} autoComplete="street-address" className="sm:col-span-2" />
            <TextAreaField label="What events will you sell?" id="ap-events" name="expected_events" rows={3} maxLength={500} defaultValue={defaultEvents} className="sm:col-span-2" hint="Optional. A sentence or two about your events" />
          </div>
          <CheckField id="ap-agree" name="agree" required label={<>I have read and accept the <Link href="/organizer-agreement" target="_blank" className="underline">Organizer Agreement</Link></>} />
          <p className="text-xs text-muted-foreground">By applying you agree to the <Link href="/organizer-agreement" className="underline">Organizer Agreement</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</p>
          {step === TOTAL ? <Captcha /> : null}
        </div>
      </section>

      <div className="sticky bottom-0 z-10 mt-auto bg-fx-ivory pt-4 pb-[max(12px,env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-fx-ivory before:to-transparent">
        <div className="flex items-center gap-3">
          {step > 1 && (
            <button type="button" onClick={() => window.history.back()} aria-label="Back" className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-fx-sand text-fx-red transition-colors duration-200 hover:bg-fx-red/10">
              <ArrowLeftIcon className="size-5" aria-hidden="true" />
            </button>
          )}
          <div className="ml-auto flex gap-3">
            {question && <button type="button" onClick={() => skip(question)} className={cx(button("outline"), "min-w-24")}>Skip</button>}
            <button type="submit" disabled={question ? !answers[question.name]?.length : pending} aria-busy={pending} className={cx(button("primary"), "min-w-28 disabled:cursor-not-allowed disabled:opacity-45")}>
              {pending && <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />}
              {step < TOTAL ? "Next" : pending ? "Sending…" : "Apply to sell tickets"}
            </button>
          </div>
        </div>
        <div role="progressbar" aria-label="Sign-up progress" aria-valuemin={1} aria-valuemax={TOTAL} aria-valuenow={step} aria-valuetext={`Step ${step} of ${TOTAL}`} className="mt-4 h-1 overflow-hidden rounded-full bg-fx-red/12">
          <div className="h-full rounded-full bg-fx-red-second transition-[width] duration-500 ease-fx" style={{ width: `${(step / TOTAL) * 100}%` }} />
        </div>
      </div>
    </form>
  );
}
