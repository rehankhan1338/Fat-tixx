"use client";

/*
 * The dashboard's "New event" form: the same fields the event form stores (createEvent in src/lib/events/actions.ts,
 * the dashboard's edit form in ../event-form.tsx), laid out like the /create page: the cover on the left, the fields
 * in sections on the right. The event is created as a draft; ticket types, the schedule, checkout questions and
 * add-ons are added on the event's page afterwards.
 */

import { startTransition, useActionState, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createEvent } from "@/lib/events/actions";
import { COMMON_TIMEZONES } from "@/lib/tz";
import { categoryIconPath, type Category } from "@/lib/event-categories";
import { COVER_H, COVER_W, dataUrlToFile, readImage } from "@/lib/home/create";
import { button, cx } from "@/components/ui/styles";
import { FieldError, Fold, Icons, input, labelCls, Section, Segmented, Switch } from "@/components/create/ui";
import { VenueDialog } from "./venue-dialog";

export interface VenueOption { id: number; name: string; city: string | null; region: string | null; timezone: string; taxBps: number; taxLabel: string | null }

type Visibility = "public" | "unlisted" | "private";
type FeeMode = "buyer_pays" | "organizer_absorbs";
type RefundPolicy = "no_refunds" | "until_event_start" | "days_before";
type Problem = { field: string; message: string };

const TITLE_MAX = 200;
const SUMMARY_MAX = 300;

/** where each problem is shown (section id) */
const FIELD_SECTION: Record<string, string> = {
  title: "n-title", starts_at: "n-dates", ends_at: "n-dates", doors_at: "n-dates", refund_days_before: "n-rules", tax_pct: "n-fees",
};

const VISIBILITY_HINT: Record<Visibility, string> = {
  public: "Listed on Fat Tixx: the homepage, the events page and search.",
  unlisted: "Not listed. Anyone with the link can find it.",
  private: "Only via a secret link (a key in the URL). You get the link once the event is created and can change it from the event page.",
};

const FEE_HINT: Record<FeeMode, string> = {
  buyer_pays: "Platform and processing fees are added to the all-in price shown up front.",
  organizer_absorbs: "Platform and processing fees are deducted from your payout.",
};

/**
 * `venues`: the organization's venues (Dashboard → Venues); `categories`: Super Admin → Fees & Settings → Event categories;
 * `defaultFeeMode`: Admin → Settings; `canFeature`: Super Admin only.
 */
export function NewEventForm({ orgSlug, venues, categories, defaultFeeMode, canFeature = false }: {
  orgSlug: string;
  venues: VenueOption[];
  categories: Category[];
  defaultFeeMode: string;
  canFeature?: boolean;
}) {
  const [state, action, pending] = useActionState(createEvent, undefined);
  const [title, setTitle] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [venueList, setVenueList] = useState(venues); // grows when a venue is added from the popup
  const [venueOpen, setVenueOpen] = useState(false);
  const [venueId, setVenueId] = useState("");
  const [tz, setTz] = useState(venues[0]?.timezone ?? "America/New_York");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [doorsAt, setDoorsAt] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [featured, setFeatured] = useState(false);
  const [refundPolicy, setRefundPolicy] = useState<RefundPolicy>("no_refunds");
  const [refundDays, setRefundDays] = useState("7");
  const [allowTransfers, setAllowTransfers] = useState(false);
  const [waitlist, setWaitlist] = useState(true);
  const [feeMode, setFeeMode] = useState<FeeMode>(defaultFeeMode === "organizer_absorbs" ? "organizer_absorbs" : "buyer_pays");
  const [taxPct, setTaxPct] = useState("");
  const [cover, setCover] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState("");
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const venue = venueList.find((v) => String(v.id) === venueId);
  // the chosen zone, the venues' zones, then the dashboard's common list
  const tzOptions = useMemo(() => [...new Set([tz, ...venueList.map((v) => v.timezone), ...COMMON_TIMEZONES])], [tz, venueList]);

  // grow the title box with its text
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [title]);

  // the same checks the server runs, shown before the form is sent (datetime-local values compare as text)
  const problems = useMemo<Problem[]>(() => {
    const p: Problem[] = [];
    if (title.trim().length < 3) p.push({ field: "title", message: "Add an event title (at least 3 characters)" });
    if (!startsAt) p.push({ field: "starts_at", message: "Add the start date and time" });
    if (startsAt && endsAt && endsAt <= startsAt) p.push({ field: "ends_at", message: "End time must be after the start time" });
    if (startsAt && doorsAt && doorsAt > startsAt) p.push({ field: "doors_at", message: "Doors must open before the event starts" });
    if (refundPolicy === "days_before") {
      const n = Number(refundDays);
      if (!Number.isInteger(n) || n < 1 || n > 365) p.push({ field: "refund_days_before", message: "Enter how many days before the event refunds are allowed (1 to 365)" });
    }
    if (taxPct.trim() !== "") {
      const t = Number(taxPct);
      if (!Number.isFinite(t) || t < 0 || t > 30) p.push({ field: "tax_pct", message: "Tax must be between 0 and 30 percent, or blank to use the venue rate" });
    }
    return p;
  }, [title, startsAt, endsAt, doorsAt, refundPolicy, refundDays, taxPct]);
  const errorFor = (field: string) => (tried ? problems.find((p) => p.field === field)?.message : undefined);
  const sectionError = (fields: string[]) => (tried ? problems.find((p) => fields.includes(p.field))?.message : undefined);

  function goTo(p: Problem) {
    document.getElementById(FIELD_SECTION[p.field] || "n-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (p.field === "title") setTimeout(() => titleRef.current?.focus(), 300);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    if (problems.length) return goTo(problems[0]);
    const fd = new FormData(e.currentTarget);
    fd.set("title", title.replace(/\n/g, " ").trim());
    if (cover) fd.set("image", dataUrlToFile(cover));
    startTransition(() => action(fd));
  }

  async function addCover(file?: File) {
    if (!file) return;
    setImgErr("");
    try {
      setCover(await readImage(file, COVER_W, COVER_H, true));
    } catch (err) {
      setImgErr((err as Error).message);
    }
  }

  const toggle = (k: string) => setFolds((f) => ({ ...f, [k]: !f[k] }));
  const left = problems.length;
  const serverError = state?.error;

  return (
    <>
    <form onSubmit={onSubmit} className="bg-fx-ivory pb-28 text-fx-red min-[901px]:pb-16">
      <input type="hidden" name="org" value={orgSlug} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="visibility" value={visibility} />
      <input type="hidden" name="fee_mode" value={feeMode} />
      {allowTransfers && <input type="hidden" name="allow_transfers" value="1" />}
      {waitlist && <input type="hidden" name="waitlist_enabled" value="1" />}
      {canFeature && <input type="hidden" name="featured_present" value="1" />}
      {canFeature && featured && <input type="hidden" name="featured" value="1" />}

      <main className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,400px)_minmax(0,1fr)] items-start gap-14 px-(--pad) pt-8 max-[1101px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)] max-[1101px]:gap-10 max-[901px]:grid-cols-1 max-[901px]:gap-8">
        {/* left: stays in place on desktop */}
        <aside className="min-[901px]:sticky min-[901px]:top-[88px] min-[901px]:self-start" aria-label="Event image">
          <div className="mx-auto w-full max-[901px]:max-w-[360px] max-[641px]:max-w-[250px] min-[901px]:max-w-[min(100%,calc((100dvh_-_300px)_*_0.8))]">
            <div className={cx("group relative aspect-[4/5] overflow-hidden rounded-[22px] bg-white", cover && "shadow-[0_30px_60px_-38px_rgba(78,7,11,.55)]")}>
              {cover ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- in-browser preview of the uploaded cover */}
                  <img src={cover} alt="Event image preview" className="h-full w-full object-cover" />
                  <div className="absolute inset-x-3 bottom-3 flex gap-2">
                    <button type="button" onClick={() => coverInput.current?.click()} className="min-h-10 flex-1 cursor-pointer rounded-full bg-white/90 px-3 text-[14px] font-semibold text-fx-red backdrop-blur">
                      Replace
                    </button>
                    <button type="button" onClick={() => setCover(null)} className="min-h-10 cursor-pointer rounded-full bg-white/90 px-4 text-[14px] font-semibold text-fx-red backdrop-blur">
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
                  <span className="text-[16px] font-semibold">Add an event image</span>
                  <span className="text-[13px] leading-[1.45] text-fx-red/78">
                    Portrait, 1080 × 1350 works best.
                    <br />
                    JPG, PNG or WebP up to 8 MB; other shapes are cropped to fit.
                  </span>
                </button>
              )}
            </div>
            {/* not named: the cropped picture is sent as "image" when the form is submitted */}
            <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Upload event image" onChange={(e) => addCover(e.target.files?.[0] ?? undefined)} />
            {imgErr && <p className="mt-2 text-[13px] font-semibold text-fx-red-second">{imgErr}</p>}

            <div className="mt-4 max-[901px]:hidden">
              <SaveButton pending={pending} />
              <Remaining problems={problems} tried={tried} left={left} onPick={goTo} />
              {serverError && <p className="mt-3 rounded-[14px] bg-fx-red/[.06] px-3 py-2 text-center text-[13px] font-semibold text-fx-red-second" role="alert">{serverError}</p>}
              <p className="mt-3 mb-0 text-center text-[12px] leading-[1.5] text-fx-red/78">Events start as drafts. Add ticket types on the event page, then publish when you are ready to sell.</p>
            </div>
          </div>
        </aside>

        {/* right: scrolls */}
        <div className="min-w-0">
          <div id="n-title" className="mb-8 scroll-mt-28">
            <label htmlFor="n-title-input" className="sr-only">
              Event title
            </label>
            <textarea
              id="n-title-input"
              ref={titleRef}
              name="title"
              rows={1}
              maxLength={TITLE_MAX}
              placeholder="Event title"
              aria-invalid={!!errorFor("title")}
              value={title}
              onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
              className="block w-full resize-none overflow-hidden border-0 border-b-2 border-transparent bg-transparent p-0 pb-1 font-display text-[clamp(32px,3.4vw,48px)] leading-[1.05] font-semibold tracking-[-0.035em] text-fx-red outline-none placeholder:text-fx-red/55 focus:border-fx-red/20 aria-invalid:border-fx-red-second"
            />
            <FieldError>{errorFor("title")}</FieldError>
            {title.length > TITLE_MAX - 20 && <p className="mt-1 text-[12px] text-fx-red/78">{TITLE_MAX - title.length} characters left</p>}

            {summaryOpen ? (
              <div className="mt-3">
                <label htmlFor="n-summary" className={labelCls}>
                  Short summary
                </label>
                <input id="n-summary" name="summary" className={cx(input, "mt-2")} maxLength={SUMMARY_MAX} placeholder="One sentence shown in listings and link previews" autoFocus />
              </div>
            ) : (
              <button type="button" onClick={() => setSummaryOpen(true)} className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-fx-red/20 bg-white px-4 text-[14px] font-semibold hover:border-fx-red/40">
                <span aria-hidden="true">+</span> Short summary
              </button>
            )}
          </div>

          <Section id="n-category" title="Category" icon={Icons.grid} hint="Used by the category filters on the homepage. Leave it unselected for no category.">
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  aria-pressed={category === c.name}
                  onClick={() => setCategory(category === c.name ? "" : c.name)}
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

          <Section id="n-dates" title="Date and time" icon={Icons.calendar} error={sectionError(["starts_at", "ends_at", "doors_at"])}>
            <div className="grid grid-cols-2 gap-4 max-[641px]:grid-cols-1">
              <div>
                <label htmlFor="n-starts" className={labelCls}>
                  Starts
                </label>
                <input id="n-starts" name="starts_at" type="datetime-local" className={cx(input, "mt-2")} value={startsAt} aria-invalid={!!errorFor("starts_at")} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div>
                <label htmlFor="n-ends" className={labelCls}>
                  Ends <span className="font-normal text-fx-red/78">(optional)</span>
                </label>
                <input id="n-ends" name="ends_at" type="datetime-local" className={cx(input, "mt-2")} value={endsAt} aria-invalid={!!errorFor("ends_at")} onChange={(e) => setEndsAt(e.target.value)} />
              </div>
              <div>
                <label htmlFor="n-doors" className={labelCls}>
                  Doors open <span className="font-normal text-fx-red/78">(optional)</span>
                </label>
                <input id="n-doors" name="doors_at" type="datetime-local" className={cx(input, "mt-2")} value={doorsAt} aria-invalid={!!errorFor("doors_at")} onChange={(e) => setDoorsAt(e.target.value)} />
                <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Shown on the event page and tickets when it differs from the start time.</p>
              </div>
              <div>
                <label htmlFor="n-tz" className={labelCls}>
                  Time zone
                </label>
                <select id="n-tz" name="timezone" className={cx(input, "mt-2 cursor-pointer")} value={tz} onChange={(e) => setTz(e.target.value)}>
                  {tzOptions.map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Section>

          <Section id="n-location" title="Location" icon={Icons.pin}>
            <div className="grid grid-cols-2 gap-4 max-[641px]:grid-cols-1">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="n-venue" className={labelCls}>
                    Venue
                  </label>
                  <button type="button" onClick={() => setVenueOpen(true)} className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-fx-red/20 bg-white px-3 text-[13px] font-semibold hover:border-fx-red/40">
                    <span aria-hidden="true">+</span> Add venue
                  </button>
                </div>
                <select
                  id="n-venue"
                  name="venue_id"
                  className={cx(input, "mt-2 cursor-pointer")}
                  value={venueId}
                  onChange={(e) => {
                    setVenueId(e.target.value);
                    const v = venueList.find((x) => String(x.id) === e.target.value);
                    if (v) setTz(v.timezone);
                  }}
                >
                  <option value="">— No venue / online —</option>
                  {venueList.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {[v.city, v.region].filter(Boolean).length ? ` — ${[v.city, v.region].filter(Boolean).join(", ")}` : ""}
                    </option>
                  ))}
                </select>
                <p className="mt-2 mb-0 text-[13px] text-fx-red/78">
                  {venue ? `Venue tax: ${(venue.taxBps / 100).toFixed(2)}%${venue.taxLabel ? ` (${venue.taxLabel})` : ""}. Choosing a venue sets the time zone.` : "Pick a saved venue, or add a new one with Add venue."}
                </p>
              </div>
              <div>
                <label htmlFor="n-capacity" className={labelCls}>
                  Overall capacity <span className="font-normal text-fx-red/78">(optional)</span>
                </label>
                <input id="n-capacity" name="capacity" type="number" min={1} inputMode="numeric" className={cx(input, "mt-2")} placeholder="Unlimited" />
                <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Ticket quantities also limit sales.</p>
              </div>
            </div>
          </Section>

          <Section id="n-rules" title="Visibility & rules" icon={Icons.shield} error={sectionError(["refund_days_before"])}>
            <div className="grid gap-5">
              <div>
                <span className={labelCls}>Who can find it</span>
                <div className="mt-2">
                  <Segmented
                    label="Visibility"
                    value={visibility}
                    onChange={setVisibility}
                    options={[
                      { v: "public", label: "Public" },
                      { v: "unlisted", label: "Unlisted" },
                      { v: "private", label: "Private link" },
                    ]}
                  />
                </div>
                <p className="mt-2 mb-0 text-[13px] text-fx-red/78">{VISIBILITY_HINT[visibility]} Presale / access codes for individual ticket types are set on each ticket type.</p>
              </div>
              {canFeature && <Switch checked={featured} onChange={setFeatured} label="Feature on the homepage" hint="Super Admin: shows this event in the homepage featured strip." />}
              <div>
                <label htmlFor="n-age" className={labelCls}>
                  Age restriction <span className="font-normal text-fx-red/78">(optional)</span>
                </label>
                <input id="n-age" name="age_restriction" type="number" min={0} max={99} inputMode="numeric" className={cx(input, "mt-2 max-w-[220px]")} placeholder="e.g. 21" />
                <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Shown at purchase and prompts an ID check at the door.</p>
              </div>
              <div>
                <label htmlFor="n-refund" className={labelCls}>
                  Refund policy
                </label>
                <select id="n-refund" name="refund_policy" className={cx(input, "mt-2 cursor-pointer")} value={refundPolicy} onChange={(e) => setRefundPolicy(e.target.value as RefundPolicy)}>
                  <option value="no_refunds">No refunds (except cancellation)</option>
                  <option value="until_event_start">Attendees may request a refund until the event starts</option>
                  <option value="days_before">Attendees may request a refund up to N days before</option>
                </select>
                {refundPolicy === "days_before" && (
                  <div className="mt-3 flex items-center gap-3">
                    <label htmlFor="n-refund-days" className={cx(labelCls, "shrink-0")}>
                      Days before the event
                    </label>
                    <input id="n-refund-days" name="refund_days_before" type="number" min={1} max={365} inputMode="numeric" className={cx(input, "max-w-24")} value={refundDays} aria-invalid={!!errorFor("refund_days_before")} onChange={(e) => setRefundDays(e.target.value)} />
                  </div>
                )}
              </div>
              <Switch checked={allowTransfers} onChange={setAllowTransfers} label="Allow attendees to transfer tickets" hint="Buyers can pass a ticket on to someone else from their order page." />
              <Switch checked={waitlist} onChange={setWaitlist} label="Waitlist when sold out" hint="Buyers can leave their email when a ticket type sells out; you release tickets to them from the Waitlist tab." />
            </div>
          </Section>

          <Section id="n-fees" title="Fees & tax" icon={Icons.ticket} error={sectionError(["tax_pct"])}>
            <div className="grid gap-5">
              <div>
                <span className={labelCls}>Who pays platform &amp; processing fees</span>
                <div className="mt-2">
                  <Segmented
                    label="Who pays the fees"
                    value={feeMode}
                    onChange={setFeeMode}
                    options={[
                      { v: "buyer_pays", label: "Buyer pays" },
                      { v: "organizer_absorbs", label: "Organizer absorbs" },
                    ]}
                  />
                </div>
                <p className="mt-2 mb-0 text-[13px] text-fx-red/78">{FEE_HINT[feeMode]}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 max-[641px]:grid-cols-1">
                <div>
                  <label htmlFor="n-tax" className={labelCls}>
                    Tax override <span className="font-normal text-fx-red/78">(%)</span>
                  </label>
                  <input id="n-tax" name="tax_pct" type="number" step="0.01" min={0} max={30} inputMode="decimal" className={cx(input, "mt-2")} placeholder={venue ? `Venue rate ${(venue.taxBps / 100).toFixed(2)}%` : "0.00"} value={taxPct} aria-invalid={!!errorFor("tax_pct")} onChange={(e) => setTaxPct(e.target.value)} />
                  <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Leave blank to use the venue’s rate.</p>
                </div>
                <div>
                  <label htmlFor="n-tax-label" className={labelCls}>
                    Tax label <span className="font-normal text-fx-red/78">(optional)</span>
                  </label>
                  <input id="n-tax-label" name="tax_label" maxLength={80} className={cx(input, "mt-2")} placeholder={venue?.taxLabel || "e.g. SC Admissions Tax"} />
                </div>
              </div>
            </div>
          </Section>

          <div className="mt-2 grid gap-3">
            <p className="m-0 text-[13px] font-semibold tracking-[.12em] text-fx-red/78 uppercase">Optional</p>
            <Fold id="n-desc" title="Description" hint="Tell people what to expect" icon={Icons.text} open={!!folds.desc} onToggle={() => toggle("desc")}>
              <label htmlFor="n-desc-input" className="sr-only">
                Description
              </label>
              <textarea id="n-desc-input" name="description" rows={8} className={cx(input, "min-h-40 py-3 leading-[1.55]")} placeholder="Lineup, dress code, parking, what’s included…" />
              <p className="mt-2 mb-0 text-[13px] text-fx-red/78">Leave a blank line between paragraphs. Photos, add-ons, promo codes and checkout questions are added on the event page afterwards.</p>
            </Fold>
          </div>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-fx-red/12 bg-fx-ivory/95 px-(--pad) pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur min-[901px]:hidden">
        <SaveButton pending={pending} />
        {left > 0 && <p className="mt-1 mb-0 text-center text-[12px] text-fx-red/78">{left === 1 ? "1 thing left to add" : `${left} things left to add`}</p>}
        {serverError && <p className="mt-1 mb-0 text-center text-[12px] font-semibold text-fx-red-second">{serverError}</p>}
      </div>
    </form>

    {/* outside the event form: a form can't contain another form */}
    <VenueDialog
      open={venueOpen}
      onClose={() => setVenueOpen(false)}
      orgSlug={orgSlug}
      defaultTimezone={tz}
      onCreated={(v) => {
        setVenueList((list) => [...list, v].sort((a, b) => a.name.localeCompare(b.name)));
        setVenueId(String(v.id));
        setTz(v.timezone);
        setVenueOpen(false);
      }}
    />
    </>
  );
}

function SaveButton({ pending }: { pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className={cx(button("primary"), "w-full min-h-[52px] text-[16px] disabled:opacity-60")}>
      {pending ? "Saving…" : "Create event as draft"}
    </button>
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
