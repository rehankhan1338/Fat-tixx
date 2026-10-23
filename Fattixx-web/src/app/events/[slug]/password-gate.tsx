"use client";

/* Shown instead of the event page when the organizer set an event password (plan 5.6). */

import { useActionState } from "react";
import { submitEventPassword } from "@/lib/events/password-actions";
import { button, cx } from "@/components/ui/styles";

export function PasswordGate({ slug, title, organizer, query }: { slug: string; title: string; organizer: string; query: string }) {
  const [state, action, pending] = useActionState(submitEventPassword, undefined);
  return (
    <main className="bg-fx-ivory px-(--pad) pt-[140px] pb-28 text-fx-red max-[901px]:pt-[112px]">
      <div className="mx-auto max-w-[460px] rounded-[28px] border border-fx-red/12 bg-white p-8 shadow-[0_30px_60px_-38px_rgba(78,7,11,.5)] max-[641px]:p-6">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-fx-yellow" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
          </svg>
        </span>
        <p className="mt-5 text-[13px] font-semibold tracking-[.12em] text-fx-red/78 uppercase">Password protected</p>
        <h1 className="mt-2 font-display text-[28px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance">{title}</h1>
        <p className="mt-2 text-[15px] leading-[1.55] text-fx-red/78">{organizer} asks for a password to see this event. They share it with their guests.</p>
        <form action={action} className="mt-6 grid gap-3">
          <input type="hidden" name="event" value={slug} />
          <input type="hidden" name="query" value={query} />
          <label htmlFor="event-password" className="text-[13px] font-semibold text-fx-red/78">
            Event password
          </label>
          <input
            id="event-password"
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="off"
            aria-invalid={!!state?.error}
            aria-describedby={state?.error ? "event-password-error" : undefined}
            className="min-h-12 w-full rounded-[14px] border border-fx-red/20 bg-white px-4 text-[15px] text-fx-ink outline-none focus:border-fx-red aria-invalid:border-fx-red-second"
          />
          {state?.error && (
            <p id="event-password-error" role="alert" className="m-0 text-[14px] font-semibold text-fx-red-second">
              {state.error}
            </p>
          )}
          <button type="submit" disabled={pending} className={cx(button("primary"), "mt-1 w-full disabled:opacity-60")}>
            {pending ? "Checking…" : "Open the event"}
          </button>
        </form>
      </div>
    </main>
  );
}
