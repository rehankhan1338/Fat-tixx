"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeftIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { saveOrgQuestionnaire } from "@/lib/applications/org-questionnaire";
import { QUESTIONS, type Question, type QuestionName } from "@/lib/applications/questionnaire";
import { button, cx, eyebrow } from "@/components/ui/styles";

/**
 * The organizer sign-up questionnaire for someone who signed up on /create (project plan, "Organizer Sign Up"):
 * one question per screen, each skippable, as in the /sell application. The last step saves every answer.
 */

const chip = (on: boolean) => cx(
  "inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-colors duration-200 select-none",
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-fx-red",
  on ? "bg-fx-red text-fx-ivory" : "bg-fx-sand text-fx-red hover:bg-fx-red/10",
);

export function WelcomeForm({ org }: { org: string }) {
  const [step, setStep] = useState(1);
  const [answers, setAnswers] = useState<Partial<Record<QuestionName, string[]>>>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [pending, start] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const q = QUESTIONS[step - 1];
  const total = QUESTIONS.length;
  const picked = answers[q.name] ?? [];
  const options = q.more && moreOpen ? [...q.options, ...q.more] : q.options;

  // a new step: move focus to its question, for keyboard and screen-reader users
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    heading.current?.focus();
  }, [step]);

  function choose(question: Question, value: string) {
    setAnswers((a) => {
      const cur = a[question.name] ?? [];
      return { ...a, [question.name]: !question.multiple ? [value] : cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  }

  function next(skip: boolean) {
    const all = skip ? { ...answers, [q.name]: [] } : answers;
    if (skip) setAnswers(all);
    if (step < total) { setMoreOpen(false); setStep(step + 1); return; }
    const fd = new FormData();
    fd.set("org", org);
    for (const [name, values] of Object.entries(all)) for (const v of values ?? []) fd.append(name, v);
    start(() => saveOrgQuestionnaire(fd));
  }

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col py-6">
      <p className={eyebrow}>Organizer sign-up · Step {step} of {total}</p>
      <h1 ref={heading} tabIndex={-1} id="wq-h" className="mt-2 font-display text-[clamp(28px,6vw,38px)] leading-[1.08] font-semibold tracking-[-0.03em] outline-none">{q.title}</h1>
      {step === 1 && <p className="mt-3 text-[15px] leading-[1.55] text-fx-red/78">A few quick questions so we can set Fattixx up for your events. Skip any you like.</p>}
      {q.multiple && <p className="mt-3 text-[15px] leading-[1.55] text-fx-red/78">Choose all that apply.</p>}
      <div role={q.multiple ? "group" : "radiogroup"} aria-labelledby="wq-h" className="mt-6 flex flex-wrap gap-3">
        {options.map((x) => {
          const on = picked.includes(x.value);
          return (
            <label key={x.value} className={chip(on)}>
              <input type={q.multiple ? "checkbox" : "radio"} name={q.name} value={x.value} checked={on} onChange={() => choose(q, x.value)} className="sr-only" />
              {on && <CheckIcon className="size-4" strokeWidth={3} aria-hidden="true" />}
              {x.label}
            </label>
          );
        })}
        {q.more && !moreOpen && <button type="button" aria-expanded="false" onClick={() => setMoreOpen(true)} className={chip(false)}>More</button>}
      </div>

      <div className="mt-10 flex items-center gap-3">
        {step > 1 && (
          <button type="button" onClick={() => setStep(step - 1)} aria-label="Back" className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-fx-sand text-fx-red hover:bg-fx-red/10">
            <ArrowLeftIcon className="size-5" aria-hidden="true" />
          </button>
        )}
        <div className="ml-auto flex gap-3">
          <button type="button" disabled={pending} onClick={() => next(true)} className={cx(button("outline"), "min-w-24")}>Skip</button>
          <button type="button" disabled={pending || !picked.length} aria-busy={pending} onClick={() => next(false)} className={cx(button("primary"), "min-w-28 disabled:cursor-not-allowed disabled:opacity-45")}>
            {pending && <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />}
            {step < total ? "Next" : pending ? "Saving…" : "Finish"}
          </button>
        </div>
      </div>
      <div role="progressbar" aria-label="Sign-up progress" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step} aria-valuetext={`Step ${step} of ${total}`} className="mt-4 h-1 overflow-hidden rounded-full bg-fx-red/12">
        <div className="h-full rounded-full bg-fx-red-second transition-[width] duration-500" style={{ width: `${(step / total) * 100}%` }} />
      </div>
    </div>
  );
}
