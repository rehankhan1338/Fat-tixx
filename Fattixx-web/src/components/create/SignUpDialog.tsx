"use client";

/*
 * The last step before the event is saved (plan 5.6): a passwordless sign-up window. The visitor continues with their
 * email or phone (a 6-digit code, valid 10 minutes, a new one after 30 seconds, a fresh code after 5 wrong tries) or
 * with Google. Someone new then gives their first and last name and the organizer name, and accepts the terms (the
 * date and time are stored). Signed-in organizers only name their organizer, or pick the organization hosting it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { button, cx } from "@/components/ui/styles";
import { Captcha, captchaOn, type CaptchaHandle } from "@/components/captcha";
import { checkSignInCode, finishSignup, requestSignInCode } from "@/lib/auth/passwordless-actions";
import { COUNTRIES, flag, toE164, type Country } from "@/lib/home/countries";
import { FieldError, input, labelCls, Segmented } from "./ui";

export type Organization = { slug: string; name: string; verified: boolean };
/** `newOrg`: create the organization on the spot with `organizerName` (the agreement was accepted). */
export type FinishChoice = { org?: string; organizerName?: string; agree?: boolean; newOrg?: boolean; draft?: boolean };
export type PendingSignup = { method: "email" | "phone" | "google"; email: string | null; emailVerified: boolean; phone: string | null; firstName: string | null; lastName: string | null };

type Step = "start" | "code" | "profile" | "organizer" | "choose";
type Method = "email" | "sms";

const NEW_ORG = "__new__";

function Terms({ checked, onChange, error }: { checked: boolean; onChange: (v: boolean) => void; error?: string }) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-[1.5]">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={!!error} className="mt-[3px] h-5 w-5 shrink-0 cursor-pointer accent-fx-red" />
        <span>
          I agree to the Fattixx{" "}
          <a href="/terms" target="_blank" className="font-semibold underline underline-offset-2">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/terms#organizer-agreement" target="_blank" className="font-semibold underline underline-offset-2">
            Organizer Agreement
          </a>
          , and I’ve read the{" "}
          <a href="/privacy" target="_blank" className="font-semibold underline underline-offset-2">
            Privacy Policy
          </a>
          .
        </span>
      </label>
      <FieldError>{error}</FieldError>
    </div>
  );
}

export default function SignUpDialog({
  open,
  onClose,
  onDone,
  onSignedIn,
  signedIn,
  organizations,
  busy,
  error,
  googleEnabled = false,
  pending = null,
  nextPath = "/create",
}: {
  open: boolean;
  onClose: () => void;
  onDone: (choice: FinishChoice) => void;
  /** the visitor just signed in (or signed up): their organizations, so the page knows who is hosting */
  onSignedIn: (organizations: Organization[]) => void;
  signedIn: boolean;
  organizations: Organization[];
  busy?: boolean;
  error?: string;
  googleEnabled?: boolean;
  /** a verified email / phone / Google account waiting for its last step (e.g. back from Google) */
  pending?: PendingSignup | null;
  /** where Google sends the visitor back to */
  nextPath?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const captcha = useRef<CaptchaHandle>(null);
  const [step, setStep] = useState<Step>("start");
  const [method, setMethod] = useState<Method>("email");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  const [phone, setPhone] = useState("");
  const [destination, setDestination] = useState(""); // where the code went, as the server normalized it
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [expired, setExpired] = useState(false);
  const [profile, setProfile] = useState<PendingSignup | null>(pending);
  const [first, setFirst] = useState(pending?.firstName ?? "");
  const [last, setLast] = useState(pending?.lastName ?? "");
  const [profileEmail, setProfileEmail] = useState("");
  const [orgNameTyped, setOrgName] = useState<string | null>(null);
  // the organizer name defaults to the person's name until they type their own (plan 5.6.8)
  const orgName = orgNameTyped ?? (step === "profile" ? `${first} ${last}`.trim() : "");
  const [agree, setAgree] = useState(false);
  const [org, setOrg] = useState(organizations[0]?.slug ?? "");
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);

  // open / close the native dialog; each time it opens, start at the step that fits who is here
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setErr(null);
      setStep(signedIn ? (organizations.length ? "choose" : "organizer") : profile ? "profile" : "start");
      setOrg((o) => o || organizations[0]?.slug || "");
    }
    if (!open && d.open) d.close();
  }, [open, signedIn, organizations, profile]);

  // the resend countdown
  useEffect(() => {
    if (step !== "code") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const sentTo = useMemo(() => (method === "email" ? destination : destination.replace(/^(\+\d{1,3})(\d+)(\d{4})$/, (_, a, b, c) => `${a} ${"•".repeat(b.length)} ${c}`)), [method, destination]);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setErr(null);
    const raw = method === "email" ? email.trim() : toE164(country, phone);
    if (method === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return setErr({ field: "email", message: "Enter a valid email address." });
    if (method === "sms" && !/^\+[1-9]\d{7,14}$/.test(raw)) return setErr({ field: "phone", message: "Enter a valid mobile number, including the area code." });
    const token = captcha.current?.token() ?? null;
    if (captchaOn && !token) return setErr({ message: "Please complete the “I’m human” check first." });
    setWorking(true);
    try {
      const r = await requestSignInCode(method, raw, token);
      captcha.current?.reset();
      if (!r.ok) {
        if (r.retryIn) setResendAt(Date.now() + r.retryIn * 1000);
        setErr({ message: r.error });
        return;
      }
      setDestination(r.destination);
      setResendAt(Date.now() + r.resendIn * 1000);
      setNow(Date.now());
      setDevCode(r.devCode ?? null);
      setExpired(false);
      setCode("");
      setStep("code");
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch {
      setErr({ message: "We couldn’t send the code. Check your connection and try again." });
    } finally {
      setWorking(false);
    }
  }

  async function checkCode(value: string) {
    if (value.length !== 6 || working) return;
    setErr(null);
    setWorking(true);
    try {
      const r = await checkSignInCode(method, destination, value);
      if (!r.ok) {
        setExpired(!!r.expired);
        setErr({ field: "code", message: r.error });
        setCode("");
        return;
      }
      if (r.status === "signed_in") {
        onSignedIn(r.organizations);
        setOrg(r.organizations[0]?.slug ?? "");
        setStep(r.organizations.length ? "choose" : "organizer");
      } else {
        setProfile({ method: method === "email" ? "email" : "phone", email: r.email, emailVerified: !!r.email, phone: r.phone, firstName: null, lastName: null });
        setStep("profile");
      }
    } catch {
      setErr({ message: "We couldn’t check the code. Check your connection and try again." });
    } finally {
      setWorking(false);
    }
  }

  async function submitProfile(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!first.trim()) return setErr({ field: "first_name", message: "Enter your first name." });
    if (!last.trim()) return setErr({ field: "last_name", message: "Enter your last name." });
    if (!profile?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileEmail.trim())) return setErr({ field: "email", message: "Enter your email address." });
    if (orgName.trim().length < 2) return setErr({ field: "organizer", message: "Add the organizer name buyers will see." });
    if (!agree) return setErr({ field: "terms", message: "Please accept the terms to continue." });
    setWorking(true);
    try {
      const r = await finishSignup({ firstName: first, lastName: last, email: profile?.email ? undefined : profileEmail.trim(), acceptTerms: agree });
      if (!r.ok) {
        setErr({ field: r.field, message: r.error });
        if (r.restart) {
          setProfile(null);
          setStep("start");
        }
        return;
      }
      setProfile(null);
      onSignedIn([]);
      onDone({ organizerName: orgName.trim(), agree: true, newOrg: true });
    } catch {
      setErr({ message: "We couldn’t create your account. Check your connection and try again." });
    } finally {
      setWorking(false);
    }
  }

  function submitOrganizer(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const creating = step === "organizer" || org === NEW_ORG;
    if (creating) {
      if (orgName.trim().length < 2) return setErr({ field: "organizer", message: "Add the organizer name buyers will see." });
      if (!agree) return setErr({ field: "terms", message: "Please accept the Organizer Agreement to continue." });
      return onDone({ organizerName: orgName.trim(), agree: true, newOrg: true });
    }
    if (!org) return setErr({ field: "org", message: "Choose an organization." });
    onDone({ org });
  }

  const errorFor = (field: string) => (err?.field === field ? err.message : undefined);
  const generalError = (err && !["email", "phone", "code", "first_name", "last_name", "organizer", "terms", "org"].includes(err.field ?? "") ? err.message : "") || error || "";
  const loading = working || !!busy;
  const title =
    step === "start" ? "Sign up to publish your event"
      : step === "code" ? "Check your " + (method === "email" ? "email" : "messages")
        : step === "profile" ? "A bit about you"
          : step === "organizer" ? "Name your organizer"
            : "Who is hosting?";

  const organizerField = (
    <div>
      <label htmlFor="su-orgname" className={labelCls}>
        Organizer name
      </label>
      <input id="su-orgname" className={cx(input, "mt-2")} autoComplete="organization" placeholder="What buyers see as the host" value={orgName} aria-invalid={!!errorFor("organizer")} onChange={(e) => setOrgName(e.target.value)} />
      {errorFor("organizer") ? <FieldError>{errorFor("organizer")}</FieldError> : <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Your brand, venue or your own name. You can change it later.</p>}
    </div>
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby="su-title"
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()} // a click on the blurred backdrop lands on the dialog itself
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(460px,calc(100vw-32px))] overflow-y-auto rounded-[28px] border-0 bg-fx-white p-0 text-fx-red shadow-[0_40px_80px_-30px_rgba(78,7,11,.6)] backdrop:bg-fx-red-deep/45 backdrop:backdrop-blur-[3px]"
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

        {step === "start" && (
          <form onSubmit={sendCode} className="mt-5 grid gap-4" noValidate>
            <p className="m-0 text-[15px] leading-[1.55] text-fx-red/78">Your event is ready. No password needed: we’ll send you a code. Your draft stays in this browser.</p>
            <Segmented
              label="Continue with"
              value={method}
              onChange={(v) => {
                setMethod(v);
                setErr(null);
              }}
              options={[
                { v: "email", label: "Email" },
                { v: "sms", label: "Phone" },
              ]}
            />
            {method === "email" ? (
              <div>
                <label htmlFor="su-email" className={labelCls}>
                  Email
                </label>
                <input id="su-email" type="email" inputMode="email" autoComplete="email" className={cx(input, "mt-2")} placeholder="you@example.com" value={email} aria-invalid={!!errorFor("email")} onChange={(e) => setEmail(e.target.value)} autoFocus />
                <FieldError>{errorFor("email")}</FieldError>
              </div>
            ) : (
              <div>
                <span className={labelCls} id="su-phone-l">
                  Mobile number
                </span>
                <div className="mt-2 grid grid-cols-[minmax(0,128px)_minmax(0,1fr)] gap-2">
                  <label htmlFor="su-country" className="sr-only">
                    Country
                  </label>
                  <select
                    id="su-country"
                    className={cx(input, "cursor-pointer px-3")}
                    value={country.code}
                    onChange={(e) => setCountry(COUNTRIES.find((c) => c.code === e.target.value) ?? COUNTRIES[0])}
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {flag(c.code)} {c.name} +{c.dial}
                      </option>
                    ))}
                  </select>
                  <input
                    id="su-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    aria-labelledby="su-phone-l"
                    className={input}
                    placeholder={country.dial === "1" ? "(843) 555-0123" : "Number"}
                    value={phone}
                    aria-invalid={!!errorFor("phone")}
                    onChange={(e) => setPhone(e.target.value)}
                    autoFocus
                  />
                </div>
                {errorFor("phone") ? <FieldError>{errorFor("phone")}</FieldError> : <p className="mt-2 mb-0 text-[13px] text-fx-red/78">We text you a code. Message and data rates may apply.</p>}
              </div>
            )}
            {generalError && <p role="alert" className="m-0 text-[14px] font-semibold text-fx-red-second">{generalError}</p>}
            <Captcha ref={captcha} />
            <button type="submit" disabled={loading} className={cx(button("red"), "w-full disabled:opacity-60")}>
              {working ? "Sending…" : "Send code"}
            </button>
            {googleEnabled && (
              <>
                <div className="flex items-center gap-3 text-[13px] text-fx-red/78" aria-hidden="true">
                  <span className="h-px flex-1 bg-fx-red/15" /> or <span className="h-px flex-1 bg-fx-red/15" />
                </div>
                <a href={`/api/auth/google?next=${encodeURIComponent(nextPath)}`} className={cx(button("outline"), "w-full bg-white")}>
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                  </svg>
                  Continue with Google
                </a>
              </>
            )}
            <p className="m-0 text-[13px] leading-[1.5] text-fx-red/78">
              Already selling on Fattixx with a password?{" "}
              <a href={`/login?next=${encodeURIComponent(nextPath)}`} className="font-semibold underline underline-offset-2">
                Sign in
              </a>
              .
            </p>
          </form>
        )}

        {step === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void checkCode(code);
            }}
            className="mt-5 grid gap-4"
            noValidate
          >
            <p className="m-0 text-[15px] leading-[1.55] text-fx-red/78">
              We sent a 6-digit code to <b className="text-fx-red">{sentTo}</b>. It expires in 10 minutes.
            </p>
            {devCode && (
              <p className="m-0 rounded-[14px] bg-fx-yellow/40 px-3 py-2 text-[13px] text-fx-red" role="status">
                Test mode (no {method === "email" ? "email" : "SMS"} provider configured): your code is <b className="font-mono tracking-[.2em]">{devCode}</b>
              </p>
            )}
            <div>
              <label htmlFor="su-code" className={labelCls}>
                Code
              </label>
              <input
                id="su-code"
                ref={codeRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                className={cx(input, "mt-2 text-center font-mono text-[24px] tracking-[.5em]")}
                value={code}
                aria-invalid={!!errorFor("code")}
                aria-describedby={errorFor("code") ? "su-code-err" : undefined}
                disabled={expired}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                  if (v.length === 6) void checkCode(v);
                }}
              />
              {errorFor("code") && (
                <p id="su-code-err" role="alert" className="mt-2 text-[13px] font-semibold text-fx-red-second">
                  {errorFor("code")}
                </p>
              )}
            </div>
            {generalError && <p role="alert" className="m-0 text-[14px] font-semibold text-fx-red-second">{generalError}</p>}
            {/* a new code needs a fresh "I am human" check, so the widget appears once one can be asked for */}
            {resendIn === 0 && <Captcha ref={captcha} />}
            {expired ? (
              <button type="button" onClick={() => sendCode()} disabled={loading || resendIn > 0} className={cx(button("red"), "w-full disabled:opacity-60")}>
                {resendIn > 0 ? `Send a new code in ${resendIn}s` : working ? "Sending…" : "Send a new code"}
              </button>
            ) : (
              <button type="submit" disabled={loading || code.length !== 6} className={cx(button("red"), "w-full disabled:opacity-60")}>
                {working ? "Checking…" : "Continue"}
              </button>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
              <button
                type="button"
                onClick={() => {
                  setStep("start");
                  setErr(null);
                }}
                className="min-h-11 cursor-pointer font-semibold text-fx-red-second underline underline-offset-4"
              >
                Use a different {method === "email" ? "email" : "number"}
              </button>
              {!expired && (
                <button type="button" onClick={() => sendCode()} disabled={loading || resendIn > 0} className="min-h-11 cursor-pointer font-semibold text-fx-red underline underline-offset-4 disabled:cursor-default disabled:text-fx-red/55 disabled:no-underline">
                  {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
                </button>
              )}
            </div>
          </form>
        )}

        {step === "profile" && profile && (
          <form onSubmit={submitProfile} className="mt-5 grid gap-4" noValidate>
            <p className="m-0 text-[15px] leading-[1.55] text-fx-red/78">
              {profile.email ? <>You’re signing up as <b className="text-fx-red">{profile.email}</b>.</> : <>Your number is confirmed.</>} Last step: who you are and who’s hosting.
            </p>
            <div className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1">
              <div>
                <label htmlFor="su-first" className={labelCls}>
                  First name
                </label>
                <input id="su-first" autoComplete="given-name" className={cx(input, "mt-2")} value={first} aria-invalid={!!errorFor("first_name")} onChange={(e) => setFirst(e.target.value)} autoFocus />
                <FieldError>{errorFor("first_name")}</FieldError>
              </div>
              <div>
                <label htmlFor="su-last" className={labelCls}>
                  Last name
                </label>
                <input id="su-last" autoComplete="family-name" className={cx(input, "mt-2")} value={last} aria-invalid={!!errorFor("last_name")} onChange={(e) => setLast(e.target.value)} />
                <FieldError>{errorFor("last_name")}</FieldError>
              </div>
            </div>
            {!profile.email && (
              <div>
                <label htmlFor="su-pemail" className={labelCls}>
                  Email
                </label>
                <input id="su-pemail" type="email" inputMode="email" autoComplete="email" className={cx(input, "mt-2")} value={profileEmail} aria-invalid={!!errorFor("email")} onChange={(e) => setProfileEmail(e.target.value)} />
                {errorFor("email") ? <FieldError>{errorFor("email")}</FieldError> : <p className="mt-2 mb-0 text-[13px] text-fx-red/78">For receipts and payout emails. We’ll send a link to confirm it.</p>}
              </div>
            )}
            {organizerField}
            <Terms checked={agree} onChange={setAgree} error={errorFor("terms")} />
            {generalError && <p role="alert" className="m-0 text-[14px] font-semibold text-fx-red-second">{generalError}</p>}
            <button type="submit" disabled={loading} className={cx(button("primary"), "w-full disabled:opacity-60")}>
              {loading ? "Saving…" : "Create account and event"}
            </button>
          </form>
        )}

        {(step === "organizer" || step === "choose") && (
          <form onSubmit={submitOrganizer} className="mt-5 grid gap-4" noValidate>
            {step === "choose" && (
              <div>
                <label htmlFor="su-pick" className={labelCls}>
                  Organization
                </label>
                <select id="su-pick" className={cx(input, "mt-2 cursor-pointer")} value={org} aria-invalid={!!errorFor("org")} onChange={(e) => setOrg(e.target.value)} autoFocus>
                  {organizations.map((o) => (
                    <option key={o.slug} value={o.slug}>
                      {o.name}
                    </option>
                  ))}
                  <option value={NEW_ORG}>A new organizer…</option>
                </select>
                <FieldError>{errorFor("org")}</FieldError>
              </div>
            )}
            {(step === "organizer" || org === NEW_ORG) && (
              <>
                {step === "organizer" && <p className="m-0 text-[15px] leading-[1.55] text-fx-red/78">You’re signed in. Name the organizer buyers will see on your event page.</p>}
                {organizerField}
                <Terms checked={agree} onChange={setAgree} error={errorFor("terms")} />
              </>
            )}
            {generalError && <p role="alert" className="m-0 text-[14px] font-semibold text-fx-red-second">{generalError}</p>}
            <button type="submit" disabled={loading} className={cx(button("primary"), "w-full disabled:opacity-60")}>
              {loading ? "Saving…" : "Create event"}
            </button>
          </form>
        )}
      </div>
    </dialog>
  );
}
