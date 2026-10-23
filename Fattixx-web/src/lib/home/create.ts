/* Event draft types, validation, local persistence and browser image processing. */

import type { FeePayer } from "./pricing";
import { dateTimeInZone } from "./date-time";
import { youtubeId } from "../video";

export type EventMode = "tickets" | "rsvp";
/** "all", or a minimum age; the page offers 18+ and 21+, and keeps any other age an event was given before */
export type AgeRule = string;
/**
 * Matches events.refund_policy: no_refunds / until_event_start / days_before (with refundDays) / contact_organizer.
 * The page offers the plan's four choices (none, 7 days, 24 hours, contact); "until_start" and other day counts are
 * kept for events made before, so editing them doesn't change their policy.
 */
export type RefundRule = "none" | "until_start" | "days_before" | "contact";
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
  /** editing a saved event: the ticket type's id, and how many are sold (the quantity can't go below it) */
  serverId?: number;
  sold?: number;
};

export type LocationDraft =
  | { kind: "saved"; venueId: string; venueName: string }
  | {
      kind: "venue";
      venueName: string;
      address: string;
      city: string;
      region: string;
      postalCode: string;
      /** ISO 3166 alpha-2, "US" by default */
      country: string;
      /** map position from the address suggestion ("Events near you"); null when typed by hand */
      lat: number | null;
      lon: number | null;
    }
  | { kind: "online"; link: string };

/** A gallery photo: a new picture (data URL) or one already saved with the event (its URL and id). */
export type GalleryItem = { id: string; src: string; serverId?: number };

/** Every field is one the event record stores (see src/lib/home/create-actions.ts). */
export type EventDraft = {
  mode: EventMode;
  /** cover image as a portrait 4:5 picture (cropped from the centre when it's added); a URL when editing a saved event */
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
  /** with light formatting: **bold**, *italics*, [links](https://…), "- " bullet lists (src/lib/rich-text.ts) */
  description: string;
  /** up to MAX_PHOTOS */
  gallery: GalleryItem[];
  /** a YouTube link */
  videoUrl: string;
  /** visitors type this before they see the event; "" = none */
  password: string;
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
  /** editing a saved event: its web address (/events/<slug>) */
  slug: string;
};

export const NAME_MAX = 80;
export const SUMMARY_MAX = 140;
/** what the database keeps (events.title / summary): longer titles made in the dashboard before still load whole */
const NAME_STORED_MAX = 200;
const SUMMARY_STORED_MAX = 300;
/** matches saveImageUpload() in src/lib/uploads.ts */
export const UPLOAD_MAX_MB = 8;
export const COVER_W = 1080;
export const COVER_H = 1350;
/** gallery photos are scaled to fit this box (small enough that five still fit in the browser's draft storage) */
export const PHOTO_MAX = 1280;
export const MAX_PHOTOS = 5;
export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 64;

/** The plan's refund choices, as select values: "none", "days:7", "days:1", "contact". */
export const REFUND_OPTIONS: { v: string; label: string }[] = [
  { v: "none", label: "No refunds (except cancellation)" },
  { v: "days:7", label: "Refunds up to 7 days before" },
  { v: "days:1", label: "Refunds up to 24 hours before" },
  { v: "contact", label: "Contact the organizer for refunds" },
];

/** The draft's refund rule as a select value; events made before keep their own choice in the list. */
export function refundChoice(d: Pick<EventDraft, "refund" | "refundDays">): string {
  if (d.refund === "days_before") return `days:${Number(d.refundDays) || 7}`;
  return d.refund;
}

export function fromRefundChoice(v: string): Pick<EventDraft, "refund" | "refundDays"> {
  const m = v.match(/^days:(\d{1,3})$/);
  if (m) return { refund: "days_before", refundDays: m[1] };
  return { refund: v === "contact" ? "contact" : v === "until_start" ? "until_start" : "none", refundDays: "7" };
}

/** Label for a refund choice that isn't one of the plan's four (events made before). */
export function legacyRefundLabel(v: string): string {
  if (v === "until_start") return "Refunds until the event starts";
  const m = v.match(/^days:(\d+)$/);
  return m ? `Refunds up to ${m[1]} days before` : v;
}

/** Drafts saved by older versions of the page: 7days / 24hours / contact, and the dashboard's names. */
export function migrateRefund(raw: unknown, days: unknown): { refund: RefundRule; refundDays: string } {
  const d = typeof days === "string" && /^\d+$/.test(days) ? days : "7";
  if (raw === "7days") return { refund: "days_before", refundDays: "7" };
  if (raw === "24hours") return { refund: "days_before", refundDays: "1" };
  if (raw === "contact" || raw === "contact_organizer") return { refund: "contact", refundDays: d };
  if (raw === "until_start" || raw === "until_event_start") return { refund: "until_start", refundDays: d };
  if (raw === "days_before") return { refund: "days_before", refundDays: d };
  return { refund: "none", refundDays: d };
}

/** events.refund_policy for a draft rule */
export function refundPolicyOf(rule: RefundRule): "no_refunds" | "until_event_start" | "days_before" | "contact_organizer" {
  return rule === "days_before" ? "days_before" : rule === "until_start" ? "until_event_start" : rule === "contact" ? "contact_organizer" : "no_refunds";
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

export function emptyVenue(): Extract<LocationDraft, { kind: "venue" }> {
  return { kind: "venue", venueName: "", address: "", city: "", region: "", postalCode: "", country: "US", lat: null, lon: null };
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
    location: emptyVenue(),
    tickets: [newTicket("General Admission", "t-first")], // a fixed id: the empty draft renders on the server too
    feePayer: "buyer",
    capacity: "",
    waitlist: false,
    description: "",
    gallery: [],
    videoUrl: "",
    password: "",
    age: "all",
    refund: "none",
    refundDays: "7",
    allowTransfers: false,
    visibility: "public",
    taxPct: "",
    taxLabel: "",
    featured: false,
    slug: "",
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

/**
 * `editing`: the start date and time the saved event had (an event already under way can still be edited as long as
 * its start isn't moved, but a new start must be in the future), and how many ticket types the dashboard manages
 * (VIP, tables, presale…), which count towards "at least one ticket".
 */
export function checkDraft(d: EventDraft, now = new Date(), editing?: { startDate: string; startTime: string; otherTickets?: number }): Problem[] {
  const p: Problem[] = [];
  if (!d.name.trim()) p.push({ field: "name", message: "Add an event name" });
  if (!d.category) p.push({ field: "category", message: "Pick a category" });

  const start = dateTimeInZone(d.startDate, d.startTime, d.timeZone);
  const end = dateTimeInZone(d.endDate, d.endTime, d.timeZone);
  const startUnchanged = !!editing && editing.startDate === d.startDate && editing.startTime === d.startTime;
  if (!start) p.push({ field: "start", message: "Add a start date and time" });
  else if (start <= now && !startUnchanged) p.push({ field: "start", message: "Start time must be in the future" });
  if (start && end && end <= start) p.push({ field: "end", message: "End time must be after the start time" });
  if (start && !end) p.push({ field: "end", message: "Add an end date and time" });

  if (d.location.kind === "saved") {
    if (!d.location.venueId) p.push({ field: "location", message: "Choose a venue" });
  } else if (d.location.kind === "venue") {
    if (!d.location.venueName.trim() && !d.location.address.trim()) p.push({ field: "location", message: "Add a venue name or address" });
    else if (!d.location.city.trim()) p.push({ field: "location", message: "Add the city" });
    // "Events near you", the city list and the distance filter need a map position (plan 5.6.5, 5.6.7)
    else if (d.location.lat == null || d.location.lon == null) p.push({ field: "location", message: "Pick the address from the suggestions so the event shows on the map" });
  } else if (!/^https?:\/\/\S+\.\S+/.test(d.location.link.trim())) {
    p.push({ field: "location", message: "Add the online event link (starting with https://)" });
  }

  if (d.mode === "tickets") {
    if (!d.tickets.length && !editing?.otherTickets) p.push({ field: "tickets", message: "Add at least one ticket" });
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
      if (t.sold && t.quantity !== "" && Number(t.quantity) < t.sold) p.push({ field: "tickets", message: `${t.sold} are already sold, so the quantity can't be lower${label}` });
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

  if (d.gallery.length > MAX_PHOTOS) p.push({ field: "photos", message: `Add up to ${MAX_PHOTOS} photos` });
  if (d.videoUrl.trim() && !youtubeId(d.videoUrl)) p.push({ field: "video", message: "Paste a YouTube link (youtube.com or youtu.be), or leave the video empty" });
  if (d.password && (d.password.trim().length < PASSWORD_MIN || d.password.length > PASSWORD_MAX)) p.push({ field: "settings", message: `Make the event password ${PASSWORD_MIN} to ${PASSWORD_MAX} characters, or switch it off` });
  if (d.slug && !/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(d.slug)) p.push({ field: "settings", message: "Use lower-case letters, numbers and dashes in the web address" });
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

/** How the gallery travels to the server: keep a saved photo, or the form field holding a new one. */
export type GalleryPost = { keep: number } | { file: string };

/** The draft as posted to the server: every field present and the right type, images left out. */
export function parseDraftForServer(json: string): EventDraft & { galleryPost: GalleryPost[] } {
  const raw = JSON.parse(json);
  if (!raw || typeof raw !== "object") throw new Error("bad draft");
  const base = emptyDraft();
  const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const loc = raw.location && typeof raw.location === "object" ? raw.location : base.location;
  const lat = num(loc.lat), lon = num(loc.lon);
  const position = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : { lat: null, lon: null };
  const location: LocationDraft =
    loc.kind === "online"
      ? { kind: "online", link: str(loc.link).trim().slice(0, 500) }
      : loc.kind === "saved"
        ? { kind: "saved", venueId: str(loc.venueId).replace(/\D/g, ""), venueName: str(loc.venueName) }
        : {
            kind: "venue", venueName: str(loc.venueName), address: str(loc.address), city: str(loc.city), region: str(loc.region),
            postalCode: str(loc.postalCode).slice(0, 20), country: /^[A-Za-z]{2}$/.test(str(loc.country)) ? str(loc.country).toUpperCase() : "US", ...position,
          };
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
        ...(Number.isInteger(t.serverId) && Number(t.serverId) > 0 ? { serverId: Number(t.serverId) } : {}),
      }))
    : [];
  const galleryPost: GalleryPost[] = Array.isArray(raw.gallery)
    ? raw.gallery.slice(0, MAX_PHOTOS).flatMap((g: Record<string, unknown>): GalleryPost[] => {
        if (g && Number.isInteger(g.keep) && Number(g.keep) > 0) return [{ keep: Number(g.keep) }];
        if (g && typeof g.file === "string" && /^photo_[0-4]$/.test(g.file)) return [{ file: g.file }];
        return [];
      })
    : [];
  return {
    ...base,
    mode: raw.mode === "rsvp" ? "rsvp" : "tickets",
    cover: null,
    name: str(raw.name).slice(0, NAME_STORED_MAX),
    summary: str(raw.summary).slice(0, SUMMARY_STORED_MAX),
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
    description: str(raw.description).slice(0, 20000),
    gallery: [],
    galleryPost,
    videoUrl: str(raw.videoUrl).trim().slice(0, 255),
    password: str(raw.password).slice(0, PASSWORD_MAX),
    age: /^\d{1,2}$/.test(str(raw.age)) && Number(raw.age) > 0 ? String(Number(raw.age)) : "all",
    ...migrateRefund(raw.refund, raw.refundDays),
    allowTransfers: !!raw.allowTransfers,
    visibility: raw.visibility === "unlisted" || raw.visibility === "private" ? raw.visibility : "public",
    taxPct: str(raw.taxPct).replace(/[^\d.]/g, "").slice(0, 6),
    taxLabel: str(raw.taxLabel).slice(0, 80),
    featured: !!raw.featured,
    slug: str(raw.slug).toLowerCase().slice(0, 100),
  };
}

/* draft kept in this browser until sign-up */

export const DRAFT_KEY = "fx_create_draft";

export function loadDraft(): { draft: EventDraft; savedAt: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (!raw || typeof raw !== "object" || !raw.draft) return null;
    const draft: EventDraft = { ...emptyDraft(), ...raw.draft, ...migrateRefund(raw.draft.refund, raw.draft.refundDays) };
    // drafts saved before the venue carried a postcode, country and map position
    if (draft.location.kind === "venue") draft.location = { ...emptyVenue(), ...draft.location };
    if (!Array.isArray(draft.gallery)) draft.gallery = [];
    return { draft, savedAt: raw.savedAt || Date.now() };
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
  return !d.cover && !d.name && !d.summary && !d.category && !d.startDate && !d.description && !d.gallery.length && !d.videoUrl &&
    (d.location.kind === "venue" ? !d.location.address && !d.location.venueName : d.location.kind === "saved" ? !d.location.venueId : !d.location.link) &&
    d.tickets.length === 1 && !d.tickets[0].price && d.tickets[0].name === e.tickets[0].name;
}

/**
 * Pictures are kept as data URLs for the preview; the server gets them as files. Decoded here rather than with
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

export const isDataUrl = (s: string | null | undefined): s is string => !!s && s.startsWith("data:");

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
  return c.toDataURL("image/jpeg", crop ? 0.85 : 0.8);
}
