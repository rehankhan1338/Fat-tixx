"use client";

/*
 * The /create form (plan 5.6): one long page, saved in this browser as the organizer types. Anyone can fill it in;
 * "Create event" checks the draft, opens the sign-up window (email or text code, or Google; names, organizer name and
 * the terms for someone new) and saves the event through publishDraft(). Organizers use the same page from their
 * dashboard, for new events and to edit saved ones and drafts (plan 5.6.12, saveEventEdits()).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/home/Logo";
import { button, cx } from "@/components/ui/styles";
import { categoryIconPath, type Category } from "@/lib/event-categories";
import { COMMON_TIMEZONES } from "@/lib/tz";
import type { FeePayer } from "@/lib/home/pricing";
import {
  AGE_OPTIONS,
  checkDraft,
  clearDraft,
  COVER_H,
  COVER_W,
  dataUrlToFile,
  defaultEnd,
  deviceTimeZone,
  emptyDraft,
  isBlank,
  isDataUrl,
  loadDraft,
  NAME_MAX,
  PASSWORD_MAX,
  readImage,
  saveDraft,
  SUMMARY_MAX,
  toLocal,
  US_TIME_ZONES,
} from "@/lib/home/create";
import type { EventDraft, Problem, VenueOption } from "@/lib/home/create";
import type { EditorData, OwnDraft } from "@/lib/home/create-context";
import { publishDraft, saveEventEdits, type CreateState } from "@/lib/home/create-actions";
import Confirmation, { type Created } from "./Confirmation";
import DescriptionEditor from "./DescriptionEditor";
import LocationField from "./LocationField";
import { GalleryField, VideoField } from "./MediaFields";
import SignUpDialog, { type FinishChoice, type Organization, type PendingSignup } from "./SignUpDialog";
import TicketsEditor from "./TicketsEditor";
import { FieldError, Fold, Icons, input, labelCls, Section, Segmented, Switch } from "./ui";

/** where each problem is shown (section id), and the fold to open for it */
const FIELD_SECTION: Record<string, string> = { name: "c-name", category: "c-category", start: "c-dates", end: "c-dates", location: "c-location", tickets: "c-tickets", photos: "c-media", video: "c-media", settings: "c-settings" };
const FIELD_FOLD: Record<string, string> = { photos: "media", video: "media", settings: "settings" };

export type AuthInfo = {
  googleEnabled: boolean;
  /** a verified email / phone / Google account waiting for the last sign-up step */
  pending: PendingSignup | null;
  /** back from Google: open the sign-up window where it left off */
  resume: "signup" | "signedin" | null;
  notice: string | null;
};

/**
 * `preselect`: the organization when the page runs inside its dashboard (/org/<slug>/events/new or …/edit); the event
 * is saved under it without asking, and the main button reads "Publish event" when Fattixx has verified it.
 * `editor`: the saved event being edited. `drafts`: the signed-in organizer's drafts, to reopen.
 * The lists come from the server: `categories` (Super Admin → Fees & Settings), `venuesByOrg` (Dashboard → Venues),
 * `defaultFeePayer` (Admin → Settings) and `canFeature` (Super Admin only).
 */
export default function CreateEvent({ signedIn, organizations, preselect, embedded = false, categories, venuesByOrg, defaultFeePayer, canFeature = false, auth, drafts = [], editor }: {
  signedIn: boolean;
  organizations: Organization[];
  preselect?: string;
  embedded?: boolean;
  categories: Category[];
  venuesByOrg: Record<string, VenueOption[]>;
  defaultFeePayer: FeePayer;
  canFeature?: boolean;
  auth?: AuthInfo;
  drafts?: OwnDraft[];
  editor?: EditorData;
}) {
  const editing = !!editor;
  const router = useRouter();
  // who is here: updated when the sign-up window signs someone in
  const [me, setMe] = useState({ signedIn, organizations });
  const chosen = (preselect && me.organizations.find((o) => o.slug === preselect)) || (me.organizations.length === 1 ? me.organizations[0] : null);
  const exitHref = editor && preselect ? `/org/${preselect}/events/${editor.eventId}` : chosen ? `/org/${chosen.slug}/events` : "/";
  const createLabel = editing ? "Save changes" : me.signedIn && chosen ? "Publish event" : "Create event";
  // saved venues are offered once the organization is known (one membership, or the dashboard's own)
  const venues = useMemo(() => (chosen ? (venuesByOrg[chosen.slug] ?? []) : []), [chosen, venuesByOrg]);
  const venuesRef = useRef(venues);
  venuesRef.current = venues;
  const [d, setD] = useState<EventDraft>(() => {
    if (!editor) return emptyDraft();
    const loc = editor.draft.location;
    const v = loc.kind === "saved" ? venues.find((x) => String(x.id) === loc.venueId) : null;
    return v && loc.kind === "saved" ? { ...editor.draft, location: { ...loc, venueName: v.name } } : editor.draft;
  });
  const [ready, setReady] = useState(editing);
  const [restored, setRestored] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">("idle");
  const [tried, setTried] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [done, setDone] = useState<{ created: Created; draft: EventDraft } | null>(null);
  const [folds, setFolds] = useState<Record<string, boolean>>((): Record<string, boolean> =>
    editor ? { desc: !!editor.draft.description, media: !!(editor.draft.gallery.length || editor.draft.videoUrl), settings: !!editor.draft.password } : {},
  );
  const [summaryOpen, setSummaryOpen] = useState(!!editor?.draft.summary);
  const [passwordOn, setPasswordOn] = useState(!!editor?.draft.password);
  const [showPassword, setShowPassword] = useState(false);
  const [imgErr, setImgErr] = useState("");
  const coverInput = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLTextAreaElement>(null);
  const endTouched = useRef(editing); // once the organizer sets the end themselves, stop moving it with the start

  const patch = useCallback((p: Partial<EventDraft>) => setD((prev) => ({ ...prev, ...p })), []);
  const editCheck = editor ? { startDate: editor.draft.startDate, startTime: editor.draft.startTime, otherTickets: editor.lockedTickets.length } : undefined;
  const problems = useMemo(() => checkDraft(d, new Date(), editCheck), [d, editCheck?.startDate, editCheck?.startTime, editCheck?.otherTickets]); // eslint-disable-line react-hooks/exhaustive-deps

  // restore a saved draft, or start fresh in the device's time zone (new events only)
  useEffect(() => {
    if (editing) return;
    // after hydration: the draft and the time zone live in the browser
    const id = requestAnimationFrame(() => {
      const saved = loadDraft();
      if (saved && !isBlank(saved.draft)) {
        // a saved venue from another organization (or one since deleted) is no longer on the list
        const loc = saved.draft.location;
        if (loc.kind === "saved" && !venuesRef.current.some((v) => String(v.id) === loc.venueId)) saved.draft.location = emptyDraft().location;
        setD(saved.draft);
        setRestored(saved.savedAt);
        endTouched.current = !!saved.draft.endDate;
        if (saved.draft.summary) setSummaryOpen(true);
        setPasswordOn(!!saved.draft.password);
        setFolds({ desc: !!saved.draft.description, media: !!(saved.draft.gallery.length || saved.draft.videoUrl), settings: !!saved.draft.password });
        // back from Google: carry on where the sign-up window left off
        if (auth?.resume && !checkDraft(saved.draft).length) setDialog(true);
      } else {
        setD((p) => ({ ...p, timeZone: deviceTimeZone(), feePayer: defaultFeePayer }));
        if (auth?.resume) setDialog(true);
      }
      if (auth?.resume || auth?.notice) {
        const url = new URL(window.location.href);
        ["signup", "signedin", "google", "google_error"].forEach((k) => url.searchParams.delete(k));
        window.history.replaceState(null, "", url.pathname + url.search);
      }
      setReady(true);
    });
    return () => cancelAnimationFrame(id);
  }, [defaultFeePayer, editing, auth?.resume, auth?.notice]);

  // save as they type (new events; edits are saved with the button)
  useEffect(() => {
    if (!ready || done || editing) return;
    const t = setTimeout(() => {
      if (isBlank(d)) return;
      setSaveState(saveDraft(d) ? "saved" : "failed");
    }, 400);
    return () => clearTimeout(t);
  }, [d, ready, done, editing]);

  // grow the name box with its text
  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [d.name]);

  const savedVenueId = d.location.kind === "saved" ? d.location.venueId : null;
  const savedVenue = savedVenueId ? (venues.find((v) => String(v.id) === savedVenueId) ?? null) : null;
  // US zones first (as on the design), then the venues' zones and the rest of the dashboard's list
  const moreTimeZones = useMemo(() => [...new Set([...venues.map((v) => v.timezone), ...COMMON_TIMEZONES])].filter((z) => !US_TIME_ZONES.some((u) => u.v === z)), [venues]);
  const knownTimeZone = US_TIME_ZONES.some((z) => z.v === d.timeZone) || moreTimeZones.includes(d.timeZone);
  const ageOptions = AGE_OPTIONS.some((o) => o.v === d.age) ? AGE_OPTIONS : [...AGE_OPTIONS, { v: d.age, label: `${d.age}+` }];
  const errorFor = (field: string) => (tried ? problems.find((p) => p.field === field)?.message : undefined);
  const sectionError = (fields: string[]) => (tried ? problems.find((p) => fields.includes(p.field))?.message : undefined);

  function goTo(p: Problem) {
    const fold = FIELD_FOLD[p.field];
    if (fold) setFolds((f) => ({ ...f, [fold]: true }));
    setTimeout(() => document.getElementById(FIELD_SECTION[p.field] || "c-name")?.scrollIntoView({ behavior: "smooth", block: "start" }), fold ? 50 : 0);
    if (p.field === "name") setTimeout(() => nameRef.current?.focus(), 300);
  }

  function onCreate() {
    setTried(true);
    if (problems.length) return goTo(problems[0]);
    setServerError("");
    if (editing) return void finish({});
    // the organization is known (one membership, or the dashboard's own): nothing to ask
    if (me.signedIn && chosen) return void finish({ org: chosen.slug });
    setDialog(true);
  }

  function onSaveDraft() {
    setTried(true);
    if (problems.length) return goTo(problems[0]);
    if (me.signedIn && chosen) void finish({ org: chosen.slug, draft: true });
  }

  function onPublishEdit() {
    setTried(true);
    if (problems.length) return goTo(problems[0]);
    void finish({ publish: true });
  }

  async function finish(choice: FinishChoice & { publish?: boolean }) {
    setBusy(true);
    setServerError("");
    try {
      const fd = new FormData();
      // saved photos are kept by id; new ones travel as files named photo_<position>
      const gallery = d.gallery.map((g, i) => (g.serverId ? { keep: g.serverId } : { file: `photo_${i}` }));
      fd.set("draft", JSON.stringify({ ...d, cover: null, gallery }));
      d.gallery.forEach((g, i) => {
        if (!g.serverId && isDataUrl(g.src)) fd.set(`photo_${i}`, dataUrlToFile(g.src, `photo-${i + 1}.jpg`));
      });
      if (isDataUrl(d.cover)) fd.set("cover", dataUrlToFile(d.cover));
      fd.set("cover_state", isDataUrl(d.cover) ? "new" : d.cover ? "keep" : "none");
      if (choice.org) fd.set("org", choice.org);
      if (choice.newOrg) {
        fd.set("new_org", "1");
        fd.set("organizer_name", choice.organizerName ?? "");
        if (choice.agree) fd.set("agree", "1");
      }
      if (choice.draft) fd.set("save_as", "draft");
      let res: CreateState;
      if (editor) {
        fd.set("org", preselect ?? "");
        fd.set("event_id", String(editor.eventId));
        fd.set("original_start", editor.originalStart);
        if (editor.hasPassword && d.password === editor.draft.password) fd.set("password_unchanged", "1");
        if (choice.publish) fd.set("save_as", "publish");
        res = await saveEventEdits(undefined, fd);
      } else {
        res = await publishDraft(undefined, fd);
      }
      if (!res || !("ok" in res)) {
        const msg = res?.error ?? "Something went wrong. Please try again.";
        setServerError(msg);
        if (res && "needsAuth" in res && res.needsAuth) {
          setMe({ signedIn: false, organizations: [] });
          setDialog(true);
        }
        return;
      }
      if (editor) {
        router.push(`${res.manageUrl}?saved=1${res.notified ? `&notified=${res.notified}` : ""}`);
        return;
      }
      setDone({ created: res, draft: d });
      setDialog(false);
      clearDraft();
      window.scrollTo({ top: 0 });
    } catch {
      setServerError("We couldn’t save the event. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    clearDraft();
    setD({ ...emptyDraft(), timeZone: deviceTimeZone(), feePayer: defaultFeePayer });
    setRestored(null);
    setTried(false);
    setSaveState("idle");
    setSummaryOpen(false);
    setPasswordOn(false);
    setServerError("");
    endTouched.current = false;
  }

  async function addCover(file?: File) {
    if (!file) return;
    setImgErr("");
    try {
      patch({ cover: await readImage(file, COVER_W, COVER_H, true) });
    } catch (e) {
      setImgErr((e as Error).message);
    }
  }

  function setStart(date: string, time: string) {
    const next: Partial<EventDraft> = { startDate: date, startTime: time };
    const s = toLocal(date, time);
    const e = toLocal(d.endDate, d.endTime);
    if (s && (!endTouched.current || !e || e <= s)) Object.assign(next, defaultEnd(date, time));
    patch(next);
  }

  const toggle = (k: string) => setFolds((f) => ({ ...f, [k]: !f[k] }));
  const left = problems.length;
  const status = editing ? "" : saveState === "saved" ? "Draft saved" : saveState === "failed" ? "Couldn’t save the draft in this browser" : "";
  const draftButton = !editing && me.signedIn && chosen ? onSaveDraft : undefined;
  const publishButton = editing && editor?.status === "draft" && chosen ? onPublishEdit : undefined;
  const datesLocked = !!editor?.multiDay;

  if (done) {
    return (
      <div className={cx("bg-fx-ivory text-fx-red", !embedded && "min-h-dvh")}>
        {!embedded && <TopBar status="" exitHref={exitHref} />}
        <Confirmation
          d={done.draft}
          created={done.created}
          onAnother={() => {
            setDone(null);
            startOver();
          }}
        />
      </div>
    );
  }

  return (
    <div className={cx("bg-fx-ivory pb-28 text-fx-red min-[901px]:pb-16", !embedded && "min-h-dvh")}>
      {!embedded && <TopBar status={status} exitHref={exitHref} />}

      {editor && (
        <div className="mx-auto mt-4 flex max-w-[1240px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-(--pad) text-[14px] text-fx-red/78">
          <span>
            Editing{editor.status === "draft" ? " a draft" : ""}.{" "}
            {editor.hasSales ? "Ticket holders get an email if you change the date, time or location." : "Nothing has been sold yet."}
          </span>
          <Link href={exitHref} className="min-h-11 content-center font-semibold text-fx-red-second underline underline-offset-4">
            Back to the event
          </Link>
        </div>
      )}

      {!editor && auth?.notice && (
        <p className="mx-auto mt-4 max-w-[1240px] px-(--pad) text-[14px] font-semibold text-fx-red-second" role="status">
          {auth.notice}
        </p>
      )}

      {!editor && drafts.length > 0 && (
        <div className="mx-auto mt-4 flex max-w-[1240px] flex-wrap items-center gap-2 px-(--pad) text-[14px]">
          <span className="text-fx-red/78">Continue a draft:</span>
          {drafts.map((x) => (
            <a key={x.id} href={`/org/${x.orgSlug}/events/${x.id}/edit`} className="inline-flex min-h-10 items-center rounded-full border border-fx-red/20 bg-white px-4 font-semibold hover:border-fx-red/50">
              {x.title}
            </a>
          ))}
        </div>
      )}

      {restored && (
        <div className="mx-auto mt-4 flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-2 px-(--pad) text-[14px] text-fx-red/78" role="status">
          <span>We restored the draft you started earlier.</span>
          <button type="button" onClick={startOver} className="min-h-11 cursor-pointer font-semibold text-fx-red-second underline underline-offset-4">
            Start over
          </button>
        </div>
      )}

      <main className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,400px)_minmax(0,1fr)] items-start gap-14 px-(--pad) pt-8 max-[1101px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)] max-[1101px]:gap-10 max-[901px]:grid-cols-1 max-[901px]:gap-8">
        {/* left: stays in place on desktop */}
        <aside className="min-[901px]:sticky min-[901px]:top-[88px] min-[901px]:self-start" aria-label="Cover image">
          <div>
            <div className="mx-auto w-full max-[901px]:max-w-[360px] max-[641px]:max-w-[250px] min-[901px]:max-w-[min(100%,calc((100dvh_-_300px)_*_0.8))]">
              <div className={cx("group relative aspect-[4/5] overflow-hidden rounded-[22px] bg-white", d.cover && "shadow-[0_30px_60px_-38px_rgba(78,7,11,.55)]")}>
                {d.cover ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- in-browser preview of the uploaded cover */}
                    <img src={d.cover} alt="Cover image preview" className="h-full w-full object-cover" />
                    <div className="absolute inset-x-3 bottom-3 flex gap-2">
                      <button type="button" onClick={() => coverInput.current?.click()} className="min-h-10 flex-1 cursor-pointer rounded-full bg-white/90 px-3 text-[14px] font-semibold text-fx-red backdrop-blur">
                        Replace
                      </button>
                      <button type="button" onClick={() => patch({ cover: null })} className="min-h-10 cursor-pointer rounded-full bg-white/90 px-4 text-[14px] font-semibold text-fx-red backdrop-blur">
                        Remove
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => coverInput.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      addCover(e.dataTransfer.files?.[0]);
                    }}
                    className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-[22px] border-2 border-dashed border-fx-red/25 bg-[repeating-linear-gradient(135deg,rgba(168,18,26,.04)_0_2px,transparent_2px_14px)] p-6 text-center transition-colors hover:border-fx-red/50"
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-fx-yellow text-fx-red">{Icons.image}</span>
                    <span className="text-[16px] font-semibold">Add a cover image</span>
                    <span className="text-[13px] leading-[1.45] text-fx-red/78">
                      Portrait, 1080 × 1350 works best.
                      <br />
                      Other shapes are cropped to fit.
                    </span>
                  </button>
                )}
              </div>
              <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Upload cover image" onChange={(e) => addCover(e.target.files?.[0] ?? undefined)} />
              {imgErr && <p className="mt-2 text-[13px] font-semibold text-fx-red-second">{imgErr}</p>}
            </div>

            <div className="mx-auto mt-4 max-[901px]:hidden">
              <CreateButton label={createLabel} onClick={onCreate} busy={busy} onDraft={draftButton} onPublish={publishButton} />
              <Remaining problems={problems} tried={tried} left={left} onPick={goTo} />
              {embedded && status && (
                <p className="mt-2 text-center text-[12px] text-fx-red/78" aria-live="polite">
                  {status}
                </p>
              )}
              {serverError && !dialog && <p role="alert" className="mt-3 rounded-[14px] bg-fx-red/[.06] px-3 py-2 text-center text-[13px] font-semibold text-fx-red-second">{serverError}</p>}
            </div>
          </div>
        </aside>

        {/* right: scrolls */}
        <div className="min-w-0">
          <div id="c-name" className="mb-8 scroll-mt-28">
            <label htmlFor="c-name-input" className="sr-only">
              Event name
            </label>
            <textarea
              id="c-name-input"
              ref={nameRef}
              rows={1}
              maxLength={Math.max(NAME_MAX, d.name.length)}
              placeholder="Event name"
              aria-invalid={!!errorFor("name")}
              value={d.name}
              onChange={(e) => patch({ name: e.target.value.replace(/\n/g, " ") })}
              className="block w-full resize-none overflow-hidden border-0 border-b-2 border-transparent bg-transparent p-0 pb-1 font-display text-[clamp(32px,3.4vw,48px)] leading-[1.05] font-semibold tracking-[-0.035em] text-fx-red outline-none placeholder:text-fx-red/55 focus:border-fx-red/20 aria-invalid:border-fx-red-second"
            />
            <FieldError>{errorFor("name")}</FieldError>
            {d.name.length > NAME_MAX - 20 && d.name.length <= NAME_MAX && <p className="mt-1 text-[12px] text-fx-red/78">{NAME_MAX - d.name.length} characters left</p>}

            {summaryOpen ? (
              <div className="mt-3">
                <label htmlFor="c-summary" className={labelCls}>
                  Short summary
                </label>
                <input id="c-summary" className={cx(input, "mt-2")} maxLength={Math.max(SUMMARY_MAX, d.summary.length)} placeholder="One line about the event" value={d.summary} onChange={(e) => patch({ summary: e.target.value })} autoFocus={!d.summary} />
                <p className="mt-1 text-right text-[12px] text-fx-red/78">{Math.max(0, SUMMARY_MAX - d.summary.length)}</p>
              </div>
            ) : (
              <button type="button" onClick={() => setSummaryOpen(true)} className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-fx-red/20 bg-white px-4 text-[14px] font-semibold hover:border-fx-red/40">
                <span aria-hidden="true">+</span> Short summary
              </button>
            )}
          </div>
          {!editing && (
            <div className="mb-8">
              <Segmented
                size="lg"
                label="Event type"
                value={d.mode}
                onChange={(v) => patch({ mode: v })}
                options={[
                  { v: "tickets", label: "Sell tickets" },
                  { v: "rsvp", label: "RSVP (free)" },
                ]}
              />
            </div>
          )}

          <Section id="c-category" title="Category" icon={Icons.grid} error={errorFor("category")} hint="Helps people find your event when they browse.">
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  aria-pressed={d.category === c.name}
                  onClick={() => patch({ category: d.category === c.name ? "" : c.name })}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-fx-red/20 bg-white px-4 text-[14px] font-semibold transition-colors hover:border-fx-red/50 aria-pressed:border-fx-red aria-pressed:bg-fx-red aria-pressed:text-fx-ivory"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={categoryIconPath(c.icon)} />
                  </svg>
                  {c.name}
                </button>
              ))}
            </div>
          </Section>

          <Section id="c-dates" title="Date and time" icon={Icons.calendar} error={sectionError(["start", "end"])} hint={datesLocked ? "This event runs on several days: change its dates on the Schedule tab." : undefined}>
            <div className="grid gap-4">
              <fieldset disabled={datesLocked} className="m-0 grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3 border-0 p-0 disabled:opacity-60 max-[641px]:grid-cols-1">
                <legend className="mb-2 text-[15px] font-semibold">Starts</legend>
                <div>
                  <label htmlFor="c-sd" className="sr-only">
                    Start date
                  </label>
                  <input id="c-sd" type="date" className={input} value={d.startDate} aria-invalid={!!errorFor("start")} onChange={(e) => setStart(e.target.value, d.startTime || "19:00")} />
                </div>
                <div>
                  <label htmlFor="c-st" className="sr-only">
                    Start time
                  </label>
                  <input id="c-st" type="time" step={900} className={input} value={d.startTime} aria-invalid={!!errorFor("start")} onChange={(e) => setStart(d.startDate, e.target.value)} />
                </div>
              </fieldset>
              <fieldset disabled={datesLocked} className="m-0 grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3 border-0 p-0 disabled:opacity-60 max-[641px]:grid-cols-1">
                <legend className="mb-2 text-[15px] font-semibold">Ends</legend>
                <div>
                  <label htmlFor="c-ed" className="sr-only">
                    End date
                  </label>
                  <input
                    id="c-ed"
                    type="date"
                    className={input}
                    value={d.endDate}
                    aria-invalid={!!errorFor("end")}
                    onChange={(e) => {
                      endTouched.current = true;
                      patch({ endDate: e.target.value });
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="c-et" className="sr-only">
                    End time
                  </label>
                  <input
                    id="c-et"
                    type="time"
                    step={900}
                    className={input}
                    value={d.endTime}
                    aria-invalid={!!errorFor("end")}
                    onChange={(e) => {
                      endTouched.current = true;
                      patch({ endTime: e.target.value });
                    }}
                  />
                </div>
              </fieldset>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-[641px]:grid-cols-1">
                <div>
                  <label htmlFor="c-tz" className={labelCls}>
                    Time zone
                  </label>
                  <select id="c-tz" className={cx(input, "mt-2 cursor-pointer")} value={d.timeZone} onChange={(e) => patch({ timeZone: e.target.value })}>
                    {!knownTimeZone && <option value={d.timeZone}>{d.timeZone.replace(/_/g, " ")}</option>}
                    <optgroup label="United States">
                      {US_TIME_ZONES.map((z) => (
                        <option key={z.v} value={z.v}>
                          {z.label} time
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="More time zones">
                      {moreTimeZones.map((z) => (
                        <option key={z} value={z}>
                          {z.replace(/_/g, " ")}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <div className="min-w-[220px]">
                  <Switch checked={d.showEnd} onChange={(v) => patch({ showEnd: v })} label="Show end time" hint={d.showEnd ? undefined : "Buyers see the start time only."} />
                </div>
              </div>
            </div>
          </Section>

          <Section id="c-location" title="Location" icon={Icons.pin}>
            <LocationField
              value={d.location}
              venues={venues}
              onChange={(v) => patch({ location: v })}
              onPickVenue={(v) => patch({ timeZone: v.timezone })}
              onTimeZone={(tz) => patch({ timeZone: tz })}
              error={errorFor("location")}
            />
          </Section>

          <Section id="c-tickets" title={d.mode === "rsvp" ? "RSVP" : "Tickets"} icon={Icons.ticket} error={sectionError(["tickets"])}>
            <TicketsEditor d={d} patch={patch} venue={savedVenue} locked={editor?.lockedTickets} manageHref={editor && preselect ? `/org/${preselect}/events/${editor.eventId}?tab=tickets` : undefined} />
          </Section>

          <div className="mt-2 grid gap-3">
            <p className="m-0 text-[13px] font-semibold tracking-[.12em] text-fx-red/78 uppercase">Optional</p>

            <Fold id="c-desc" title="Description" hint="Tell people what to expect" icon={Icons.text} open={!!folds.desc} onToggle={() => toggle("desc")}>
              <DescriptionEditor id="c-desc-input" value={d.description} onChange={(v) => patch({ description: v })} />
            </Fold>

            <Fold id="c-media" title="Photos and video" hint="Up to 5 photos and a YouTube video" icon={Icons.video} open={!!folds.media} onToggle={() => toggle("media")}>
              <div className="grid gap-6">
                <GalleryField items={d.gallery} onChange={(gallery) => patch({ gallery })} error={errorFor("photos")} />
                <VideoField id="c-video" value={d.videoUrl} onChange={(videoUrl) => patch({ videoUrl })} error={errorFor("video")} />
              </div>
            </Fold>

            <Fold id="c-settings" title="Settings" hint="Doors, age requirement, transfers, visibility and password" icon={Icons.settings} open={!!folds.settings} onToggle={() => toggle("settings")}>
              <div className="grid gap-5">
                <div>
                  <label htmlFor="c-doors" className={labelCls}>
                    Doors open <span className="font-normal text-fx-red/78">(optional)</span>
                  </label>
                  <input id="c-doors" type="time" step={900} disabled={datesLocked} className={cx(input, "mt-2 max-w-[220px] disabled:opacity-60")} value={d.doorsTime} onChange={(e) => patch({ doorsTime: e.target.value })} />
                  <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Shown on the event page and tickets when it differs from the start time.</p>
                </div>
                <div>
                  <span className={labelCls}>Age requirement</span>
                  <div className="mt-2">
                    <Segmented label="Age requirement" value={d.age} onChange={(v) => patch({ age: v })} options={ageOptions} />
                  </div>
                </div>
                <Switch checked={d.allowTransfers} onChange={(v) => patch({ allowTransfers: v })} label="Allow ticket transfers" hint="Buyers can pass a ticket on to someone else from their order page." />
                <div>
                  <span className={labelCls}>Who can find it</span>
                  <div className="mt-2">
                    <Segmented
                      label="Visibility"
                      value={d.visibility}
                      onChange={(v) => patch({ visibility: v })}
                      options={[
                        { v: "public", label: "Public" },
                        { v: "unlisted", label: "Link only" },
                        { v: "private", label: "Private link" },
                      ]}
                    />
                  </div>
                  <p className="mt-2 mb-0 text-[13px] text-fx-red/78">
                    {d.visibility === "public"
                      ? "Listed on the Fattixx events page and in search."
                      : d.visibility === "unlisted"
                        ? "Hidden from browsing and search. Only people with the link can find it."
                        : "Hidden everywhere. Only people with the secret link can open it; you get the link once the event is created and can change it from the dashboard."}
                  </p>
                </div>
                <div>
                  <Switch
                    checked={passwordOn}
                    onChange={(v) => {
                      setPasswordOn(v);
                      if (!v) patch({ password: "" });
                    }}
                    label="Password protect the event"
                    hint="Visitors type a password before they see the event page or buy tickets."
                  />
                  {passwordOn && (
                    <div className="mt-3">
                      <label htmlFor="c-password" className={labelCls}>
                        Event password
                      </label>
                      <div className="mt-2 flex gap-2">
                        <input
                          id="c-password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="off"
                          maxLength={PASSWORD_MAX}
                          className={cx(input, "max-w-[320px]")}
                          value={d.password}
                          aria-invalid={!!errorFor("settings") && /password/.test(errorFor("settings") ?? "")}
                          onChange={(e) => patch({ password: e.target.value })}
                        />
                        <button type="button" onClick={() => setShowPassword((s) => !s)} className="min-h-12 shrink-0 cursor-pointer rounded-full border border-fx-red/20 bg-white px-4 text-[14px] font-semibold hover:border-fx-red/40">
                          {showPassword ? "Hide" : "Show"}
                        </button>
                      </div>
                      <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Share it with your guests. You can see and change it here at any time.</p>
                    </div>
                  )}
                </div>
                {editing && (
                  <div>
                    <label htmlFor="c-slug" className={labelCls}>
                      Web address
                    </label>
                    <div className="mt-2 flex items-center gap-1 text-[15px]">
                      <span className="shrink-0 text-fx-red/78">fattixx.com/events/</span>
                      <input id="c-slug" className={input} value={d.slug} onChange={(e) => patch({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 100) })} />
                    </div>
                    <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Changing it breaks links you already shared.</p>
                  </div>
                )}
                <FieldError>{errorFor("settings")}</FieldError>
                {canFeature && <Switch checked={d.featured} onChange={(v) => patch({ featured: v })} label="Feature on the homepage" hint="Super Admin: shows this event in the homepage featured strip." />}
              </div>
            </Fold>
          </div>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-fx-red/12 bg-fx-ivory/95 px-(--pad) pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur min-[901px]:hidden">
        <CreateButton label={createLabel} onClick={onCreate} busy={busy} onDraft={draftButton} onPublish={publishButton} compact />
        {left > 0 && <p className="mt-1 mb-0 text-center text-[12px] text-fx-red/78">{left === 1 ? "1 thing left to add" : `${left} things left to add`}</p>}
        {serverError && !dialog && <p role="alert" className="mt-1 mb-0 text-center text-[12px] font-semibold text-fx-red-second">{serverError}</p>}
      </div>

      {!editing && (
        <SignUpDialog
          open={dialog}
          onClose={() => setDialog(false)}
          onDone={finish}
          onSignedIn={(orgs) => setMe({ signedIn: true, organizations: orgs })}
          signedIn={me.signedIn}
          organizations={me.organizations}
          busy={busy}
          error={serverError}
          googleEnabled={auth?.googleEnabled}
          pending={auth?.pending}
        />
      )}
    </div>
  );
}

function TopBar({ status, exitHref }: { status: string; exitHref: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-fx-red/10 bg-fx-ivory/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-(--pad)">
        <Link href="/" className="flex items-center" aria-label="Fattixx home">
          <Logo height={34} />
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-[13px] text-fx-red/78 max-[641px]:hidden" aria-live="polite">
            {status}
          </span>
          <Link href={exitHref} className="inline-flex min-h-10 items-center rounded-full border border-fx-red/20 px-4 text-[14px] font-semibold hover:border-fx-red/50">
            Exit
          </Link>
        </div>
      </div>
    </header>
  );
}

function CreateButton({ label, onClick, busy, onDraft, onPublish, compact }: { label: string; onClick: () => void; busy: boolean; onDraft?: () => void; onPublish?: () => void; compact?: boolean }) {
  const second = onDraft ? { label: "Save as draft", run: onDraft } : onPublish ? { label: "Publish now", run: onPublish } : null;
  return (
    <div className={cx("flex gap-2", !compact && "flex-col")}>
      <button type="button" onClick={onClick} disabled={busy} className={cx(button("primary"), "w-full min-h-[52px] text-[16px] disabled:opacity-60")}>
        {busy ? "Saving…" : label}
      </button>
      {second && (
        <button type="button" onClick={second.run} disabled={busy} className={cx(button("outline"), "bg-white disabled:opacity-60", compact ? "shrink-0" : "w-full")}>
          {second.label}
        </button>
      )}
    </div>
  );
}

function Remaining({ problems, tried, left, onPick }: { problems: Problem[]; tried: boolean; left: number; onPick: (p: Problem) => void }) {
  if (!left) return <p className="mt-3 mb-0 text-center text-[13px] text-fx-red/78">Everything’s ready.</p>;
  return (
    <button
      type="button"
      onClick={() => onPick(problems[0])}
      className={cx("mt-3 block w-full cursor-pointer rounded-[14px] px-3 py-2 text-center text-[13px] leading-[1.4]", tried ? "bg-fx-red/[.06] text-fx-red-second" : "text-fx-red/78 hover:text-fx-red")}
    >
      <b className="font-semibold">{left === 1 ? "1 thing left to add" : `${left} things left to add`}</b>
      <span className="block underline decoration-fx-red/25 underline-offset-2">Next: {problems[0].message.charAt(0).toLowerCase() + problems[0].message.slice(1)}</span>
    </button>
  );
}
