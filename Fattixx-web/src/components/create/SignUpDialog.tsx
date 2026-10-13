"use client";

/*
 * The last step before the event is saved: sign in (the draft waits in this browser), name the organizer when the
 * account has no organization yet, or pick the organization when it has several.
 */

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { button, cx } from "@/components/ui/styles";
import { input, labelCls } from "./ui";

export type Organization = { slug: string; name: string; verified: boolean };
export type FinishChoice = { org?: string; organizerName?: string; draft?: boolean };

export default function SignUpDialog({
  open,
  onClose,
  onDone,
  signedIn,
  organizations,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (choice: FinishChoice) => void;
  signedIn: boolean;
  organizations: Organization[];
  busy?: boolean;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [org, setOrg] = useState(organizations[0]?.slug ?? "");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const next = encodeURIComponent("/create");
  const mode = !signedIn ? "auth" : organizations.length === 0 ? "organizer" : "choose";
  const title = mode === "auth" ? "Sign in to create your event" : mode === "organizer" ? "Name your organizer account" : "Who is hosting?";

  function finish(e: FormEvent) {
    e.preventDefault();
    if (mode === "organizer") {
      if (name.trim().length < 2) return setErr("Add the organizer name buyers will see.");
      setErr("");
      onDone({ organizerName: name.trim() });
    } else {
      if (!org) return setErr("Choose an organization.");
      setErr("");
      onDone({ org });
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="su-title"
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()} // a click on the blurred backdrop lands on the dialog itself
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[28px] border-0 bg-fx-white p-0 text-fx-red shadow-[0_40px_80px_-30px_rgba(78,7,11,.6)] backdrop:bg-fx-red-deep/45 backdrop:backdrop-blur-[3px]"
    >
      <div className="relative p-7 max-[641px]:p-5">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute top-4 right-4 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-fx-red/78 hover:bg-fx-sand">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="text-[12px] font-semibold tracking-[.14em] text-fx-red/78 uppercase">Almost there</div>
        <h2 id="su-title" className="mt-2 pr-10 font-display text-[26px] leading-[1.1] font-semibold tracking-[-0.03em]">
          {title}
        </h2>

        {mode === "auth" && (
          <div className="mt-5 grid gap-4">
            <p className="m-0 text-[15px] leading-[1.55] text-fx-red/78">Your event is ready. Sign in or create a free account to save it. Your draft stays in this browser until then.</p>
            <a href={`/login?next=${next}`} className={cx(button("red"), "w-full")}>
              Sign in
            </a>
            <a href={`/register?next=${next}`} className={cx(button("outline"), "w-full bg-white")}>
              Create an account
            </a>
            <p className="m-0 text-[13px] leading-[1.5] text-fx-red/78">
              By continuing, you agree to the Fattixx{" "}
              <a href="/terms" target="_blank" className="font-semibold underline underline-offset-2">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/terms#organizer-agreement" target="_blank" className="font-semibold underline underline-offset-2">
                Organizer Agreement
              </a>
              , and confirm you’ve read the{" "}
              <a href="/privacy" target="_blank" className="font-semibold underline underline-offset-2">
                Privacy Policy
              </a>
              .
            </p>
          </div>
        )}

        {mode !== "auth" && (
          <form onSubmit={finish} className="mt-5 grid gap-4" noValidate>
            {mode === "organizer" ? (
              <div>
                <label htmlFor="su-org" className={labelCls}>
                  Organizer name
                </label>
                <input id="su-org" className={cx(input, "mt-2")} autoComplete="organization" placeholder="What buyers see as the host" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                <p className="mt-2 mb-0 text-[13px] text-fx-red/78">You can change this later, e.g. to your brand name. We verify every organizer before tickets go on sale.</p>
              </div>
            ) : (
              <div>
                <label htmlFor="su-pick" className={labelCls}>
                  Organization
                </label>
                <select id="su-pick" className={cx(input, "mt-2 cursor-pointer")} value={org} onChange={(e) => setOrg(e.target.value)} autoFocus>
                  {organizations.map((o) => (
                    <option key={o.slug} value={o.slug}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(err || error) && <p className="m-0 text-[14px] font-semibold text-fx-red-second">{err || error}</p>}
            <p className="m-0 text-[13px] leading-[1.5] text-fx-red/78">
              By continuing, you agree to the Fattixx{" "}
              <a href="/terms" target="_blank" className="font-semibold underline underline-offset-2">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/terms#organizer-agreement" target="_blank" className="font-semibold underline underline-offset-2">
                Organizer Agreement
              </a>
              .
            </p>
            <button type="submit" disabled={busy} className={cx(button("primary"), "w-full disabled:opacity-60")}>
              {busy ? "Saving…" : "Create event"}
            </button>
          </form>
        )}
      </div>
    </dialog>
  );
}
