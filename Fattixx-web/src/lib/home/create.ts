/* Event draft types, validation, local persistence and browser image processing. */

import type { FeePayer } from "./pricing";
import { dateTimeInZone } from "./date-time";

export type EventMode = "tickets" | "rsvp";
export type AgeRule = "all" | "18" | "21";
/** matches events.refund_policy: no_refunds / until_event_start / days_before (with refundDays) */
export type RefundRule = "none" | "until_start" | "days_before";
export type Visibility = "public" | "unlisted" | "private";

/** A venue saved under the organization (Dashboard → Venues); the /create page lists them. */
export type VenueOption = { id: number; name: string; city: string | null; region: string | null; timezone: string; taxBps: number; taxLabel: string | null };

export type TicketDraft = {
  id: string;
  name: string;
  /** dollars as typed; "" or 0 = free */
  price: string;
  /** "" = unlimited (up to event capacity) */
  quantity: string;
  minPerOrder: string;
  maxPerOrder: string;
  /** YYYY-MM-DDTHH:MM local to the event; "" = now */
  salesStart: string;
  /** "" = until the event starts */
  salesEnd: string;
  description: string;
  hidden: boolean;
};

export type LocationDraft =
  | { kind: "saved"; venueId: string; venueName: string }
  | { kind: "venue"; venueName: string; address: string; city: string; region: string }
  | { kind: "online"; link: string };

/** Every field is one the event record stores (see publishDraft in create-actions.ts); the dashboard's event form edits the same ones afterwards. */
export type EventDraft = {
  mode: EventMode;
  /** cover image as a portrait 4:5 picture (cropped from the centre when it's added) */
  cover: string | null;
  name: string;
  summary: string;
  category: string;
  startDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endDate: string;
  endTime: string;
  showEnd: boolean;
  timeZone: string; // IANA name, e.g. America/New_York
  /** HH:MM on the start date, local to the event; "" = same as the start */
  doorsTime: string;
  location: LocationDraft;
  tickets: TicketDraft[];
  feePayer: FeePayer;
  capacity: string;
  waitlist: boolean;
  description: string;
  age: AgeRule;
  refund: RefundRule;
  /** days before the start, when refund = "days_before" */
  refundDays: string;
  allowTransfers: boolean;
  visibility: Visibility;
  /** sales tax as a percentage, e.g. "7.5"; "" = the venue's rate */
  taxPct: string;
  taxLabel: string;
  /** Super Admin only: show in the homepage featured strip */
  featured: boolean;
};

export const NAME_MAX = 80;
export const SUMMARY_MAX = 140;
/** matches saveImageUpload() in src/lib/uploads.ts */
export const UPLOAD_MAX_MB = 8;
export const COVER_W = 1080;
export const COVER_H = 1350;

export const REFUND_OPTIONS: { v: RefundRule; label: string }[] = [
  { v: "none", label: "No refunds (except cancellation)" },
  { v: "until_start", label: "Refunds until the event starts" },
  { v: "days_before", label: "Refunds up to N days before" },
];

/** Drafts saved before the refund rules matched the dashboard's: 7days / 24hours → days before, contact → none. */
export function migrateRefund(raw: unknown, days: unknown): { refund: RefundRule; refundDays: string } {
  const d = typeof days === "string" && /^\d+$/.test(days) ? days : "7";
  if (raw === "7days") return { refund: "days_before", refundDays: "7" };
  if (raw === "24hours") return { refund: "days_before", refundDays: "1" };
  if (raw === "until_start" || raw === "days_before") return { refund: raw, refundDays: d };
  return { refund: "none", refundDays: d };
}

export const AGE_OPTIONS: { v: AgeRule; label: string }[] = [
  { v: "all", label: "All ages" },
  { v: "18", label: "18+" },
  { v: "21", label: "21+" },
];

export const US_TIME_ZONES: { v: string; label: string }[] = [
  { v: "America/New_York", label: "Eastern" },
  { v: "America/Chicago", label: "Central" },
  { v: "America/Denver", label: "Mountain" },
  { v: "America/Phoenix", label: "Arizona" },
  { v: "America/Los_Angeles", label: "Pacific" },
  { v: "America/Anchorage", label: "Alaska" },
  { v: "Pacific/Honolulu", label: "Hawaii" },
];

let n = 0;
export function uid(prefix = "id"): string {
  n += 1;
  return `${prefix}-${Date.now().toString(36)}-${n}`;
}

export function newTicket(name = "General Admission", id = uid("t")): TicketDraft {
  return { id, name, price: "", quantity: "", minPerOrder: "1", maxPerOrder: "10", salesStart: "", salesEnd: "", description: "", hidden: false };
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export function emptyDraft(): EventDraft {
  return {
    mode: "tickets",
    cover: null,
    name: "",
    summary: "",
    category: "",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    showEnd: true,
    timeZone: "America/New_York",
    doorsTime: "",
    location: { kind: "venue", venueName: "", address: "", city: "", region: "" },
    tickets: [newTicket("General Admission", "t-first")], // a fixed id: the empty draft renders on the server too
    feePayer: "buyer",
    capacity: "",
    waitlist: false,
    description: "",
    age: "all",
    refund: "none",
    refundDays: "7",
    allowTransfers: false,
    visibility: "public",
    taxPct: "",
    taxLabel: "",
    featured: false,
  };
}

/* dates */

export function toLocal(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const dt = new Date(y, m - 1, d, h, mi);
  return isNaN(dt.getTime()) ? null : dt;
}

/** end = start + 3 hours, as date + time strings */
export function defaultEnd(date: string, time: string): { endDate: string; endTime: string } | null {
  const s = toLocal(date, time);
  if (!s) return null;
  const e = new Date(s.getTime() + 3 * 3600e3);
  const pad = (x: number) => String(x).padStart(2, "0");
  return { endDate: `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`, endTime: `${pad(e.getHours())}:${pad(e.getMinutes())}` };
}

/* checks run when "Create event" is clicked, before sign-up */

export type Problem = { field: string; message: string };

export function checkDraft(d: EventDraft, now = new Date()): Problem[] {
  const p: Problem[] = [];
  if (!d.name.trim()) p.push({ field: "name", message: "Add an event name" });
  if (!d.category) p.push({ field: "category", message: "Pick a category" });

  const start = dateTimeInZone(d.startDate, d.startTime, d.timeZone);
  const end = dateTimeInZone(d.endDate, d.endTime, d.timeZone);
  if (!start) p.push({ field: "start", message: "Add a start date and time" });
  else if (start <= now) p.push({ field: "start", message: "Start time must be in the future" });
  if (start && end && end <= start) p.push({ field: "end", message: "End time must be after the start time" });
  if (start && !end) p.push({ field: "end", message: "Add an end date and time" });

  if (d.location.kind === "saved") {
    if (!d.location.venueId) p.push({ field: "location", message: "Choose a venue" });
  } else if (d.location.kind === "venue") {
    if (!d.location.venueName.trim() && !d.location.address.trim()) p.push({ field: "location", message: "Add a venue name or address" });
    else if (!d.location.city.trim()) p.push({ field: "location", message: "Add the city" });
  } else if (!/^https?:\/\/\S+\.\S+/.test(d.location.link.trim())) {
    p.push({ field: "location", message: "Add the online event link (starting with https://)" });
  }

  if (d.mode === "tickets") {
    if (!d.tickets.length) p.push({ field: "tickets", message: "Add at least one ticket" });
    d.tickets.forEach((t, i) => {
      const label = d.tickets.length > 1 ? ` (ticket ${i + 1})` : "";
      if (!t.name.trim()) p.push({ field: "tickets", message: `Give the ticket a name${label}` });
      const price = t.price.trim() === "" ? 0 : Number(t.price.replace(/[$,]/g, ""));
      if (!Number.isFinite(price) || price < 0) p.push({ field: "tickets", message: `Enter a price of $0 or more${label}` });
      const [salesDate, salesTime] = t.salesEnd.split("T");
      const se = t.salesEnd ? dateTimeInZone(salesDate, salesTime, d.timeZone) : null;
      if (t.salesEnd && !se) p.push({ field: "tickets", message: `Enter a valid sales end date and time${label}` });
      if (se && end && se > end) p.push({ field: "tickets", message: `Ticket sales must end by the time the event ends${label}` });
      const min = Number(t.minPerOrder || 1);
      const max = Number(t.maxPerOrder || 10);
      if (min > max) p.push({ field: "tickets", message: `Order minimum can't be more than the maximum${label}` });
    });
    if (d.refund === "days_before") {
      const days = Number(d.refundDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) p.push({ field: "tickets", message: "Enter how many days before the event refunds are allowed (1 to 365)" });
    }
    if (d.taxPct.trim() !== "") {
      const tax = Number(d.taxPct);
      if (!Number.isFinite(tax) || tax < 0 || tax > 30) p.push({ field: "tickets", message: "Tax must be between 0 and 30 percent, or blank to use the venue rate" });
    }
  }
  return p;
}

export function hasPaidTickets(d: EventDraft): boolean {
  return d.mode === "tickets" && d.tickets.some((t) => Number((t.price || "0").replace(/[$,]/g, "")) > 0);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "event"
  );
}

/** The draft as posted to the server: every field present and the right type, images left out. */
export function parseDraftForServer(json: string): EventDraft {
  const raw = JSON.parse(json);
  if (!raw || typeof raw !== "object") throw new Error("bad draft");
  const base = emptyDraft();
  const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
  const loc = raw.location && typeof raw.location === "object" ? raw.location : base.location;
  const location: LocationDraft =
    loc.kind === "online"
      ? { kind: "online", link: str(loc.link) }
      : loc.kind === "saved"
        ? { kind: "saved", venueId: str(loc.venueId).replace(/\D/g, ""), venueName: str(loc.venueName) }
        : { kind: "venue", venueName: str(loc.venueName), address: str(loc.address), city: str(loc.city), region: str(loc.region) };
  const tickets: TicketDraft[] = Array.isArray(raw.tickets)
    ? raw.tickets.slice(0, 20).map((t: Record<string, unknown>, i: number) => ({
        ...newTicket(),
        id: `t-${i}`,
        name: str(t.name),
        price: str(t.price),
        quantity: str(t.quantity),
        minPerOrder: str(t.minPerOrder, "1"),
        maxPerOrder: str(t.maxPerOrder, "10"),
        salesStart: str(t.salesStart),
        salesEnd: str(t.salesEnd),
        description: str(t.description),
        hidden: !!t.hidden,
      }))
    : [];
  return {
    ...base,
    mode: raw.mode === "rsvp" ? "rsvp" : "tickets",
    cover: null,
    name: str(raw.name).slice(0, NAME_MAX),
    summary: str(raw.summary).slice(0, SUMMARY_MAX),
    category: str(raw.category),
    startDate: str(raw.startDate),
    startTime: str(raw.startTime),
    endDate: str(raw.endDate),
    endTime: str(raw.endTime),
    showEnd: raw.showEnd !== false,
    timeZone: str(raw.timeZone, base.timeZone),
    doorsTime: /^\d{2}:\d{2}$/.test(str(raw.doorsTime)) ? str(raw.doorsTime) : "",
    location,
    tickets,
    feePayer: raw.feePayer === "organizer" ? "organizer" : "buyer",
    capacity: str(raw.capacity).replace(/\D/g, ""),
    waitlist: !!raw.waitlist,
    description: str(raw.description),
    age: raw.age === "18" || raw.age === "21" ? raw.age : "all",
    ...migrateRefund(raw.refund, raw.refundDays),
    allowTransfers: !!raw.allowTransfers,
    visibility: raw.visibility === "unlisted" || raw.visibility === "private" ? raw.visibility : "public",
    taxPct: str(raw.taxPct).replace(/[^\d.]/g, "").slice(0, 6),
    taxLabel: str(raw.taxLabel).slice(0, 80),
    featured: !!raw.featured,
  };
}

/* draft kept in this browser until sign-up */

export const DRAFT_KEY = "fx_create_draft";

export function loadDraft(): { draft: EventDraft; savedAt: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (!raw || typeof raw !== "object" || !raw.draft) return null;
    return { draft: { ...emptyDraft(), ...raw.draft, ...migrateRefund(raw.draft.refund, raw.draft.refundDays) }, savedAt: raw.savedAt || Date.now() };
  } catch {
    return null;
  }
}

/** returns false when the browser refused (storage full or blocked) */
export function saveDraft(draft: EventDraft): boolean {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** true when nothing meaningful has been entered yet */
export function isBlank(d: EventDraft): boolean {
  const e = emptyDraft();
  return !d.cover && !d.name && !d.summary && !d.category && !d.startDate && !d.description &&
    (d.location.kind === "venue" ? !d.location.address && !d.location.venueName : d.location.kind === "saved" ? !d.location.venueId : !d.location.link) &&
    d.tickets.length === 1 && !d.tickets[0].price && d.tickets[0].name === e.tickets[0].name;
}

/**
 * The cover is kept as a data URL for the preview; the server gets it as a file. Decoded here rather than with
 * fetch(dataUrl): the Content-Security-Policy's connect-src (src/proxy.ts) does not allow data: URLs.
 */
export function dataUrlToFile(dataUrl: string, name = "cover.jpg"): File {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma);
  const type = meta.slice(5, meta.indexOf(";") > 0 ? meta.indexOf(";") : undefined) || "image/jpeg";
  const data = dataUrl.slice(comma + 1);
  const bytes = meta.endsWith(";base64") ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(data));
  return new File([bytes], name, { type });
}

/* pictures: read a file, crop/resize it in the browser */

/**
 * Reads an image file and returns it as a JPEG data URL.
 *  - crop: true  -> cropped from the centre to exactly w x h (the 4:5 cover)
 *  - crop: false -> scaled down to fit inside w x h (gallery photos)
 */
export async function readImage(file: File, w: number, h: number, crop: boolean): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
  if (file.size > UPLOAD_MAX_MB * 1024 * 1024) throw new Error(`Images can be up to ${UPLOAD_MAX_MB} MB.`);
  const bmp = await createImageBitmap(file);
  let sx = 0,
    sy = 0,
    sw = bmp.width,
    sh = bmp.height,
    dw = w,
    dh = h;
  if (crop) {
    const target = w / h;
    if (sw / sh > target) {
      sw = Math.round(sh * target);
      sx = Math.round((bmp.width - sw) / 2);
    } else {
      sh = Math.round(sw / target);
      sy = Math.round((bmp.height - sh) / 2);
    }
  } else {
    const k = Math.min(1, w / sw, h / sh);
    dw = Math.round(sw * k);
    dh = Math.round(sh * k);
  }
  const c = document.createElement("canvas");
  c.width = dw;
  c.height = dh;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("This browser couldn't read the image.");
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);
  bmp.close?.();
  return c.toDataURL("image/jpeg", 0.85);
}
