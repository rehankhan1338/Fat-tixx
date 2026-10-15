import 'server-only';
import { NextResponse } from 'next/server';
import { getSession, type CurrentSession, type PlatformRole } from '../auth/session';
import { CheckoutError } from '../orders/checkout';
import { TransferError } from '../orders/transfer';

/**
 * Helpers for the mobile JSON API under /api/mobile/v1.
 *
 * Conventions
 *  - Success: 200 with the data object. Failure: { error, field? } with a 4xx/5xx status.
 *  - Authentication is `Authorization: Bearer <token>` only (see auth/session.ts). Cookie sessions are
 *    refused here on purpose: a cookie would make these endpoints reachable from a web page (CSRF),
 *    which the app never needs.
 *  - Bodies are JSON, capped in size, and every field is validated before use.
 *  - Unexpected errors never leak internals: the client gets a generic message and the server logs it.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public field?: string) { super(message); }
}

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function fail(status: number, error: string, field?: string): NextResponse {
  return NextResponse.json(field ? { error, field } : { error }, { status, headers: NO_STORE });
}

type Handler<Ctx> = (req: Request, ctx: Ctx) => Promise<NextResponse>;

/** Wrap a route handler so thrown errors become clean JSON responses. */
export function handle<Ctx = unknown>(fn: Handler<Ctx>): Handler<Ctx> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return fail(e.status, e.message, e.field);
      if (e instanceof CheckoutError || e instanceof TransferError) return fail(400, e.message);
      const msg = (e as Error)?.message ?? '';
      if (msg === 'Unauthorized') return fail(401, 'Please sign in.');
      if (msg === 'Forbidden' || msg === 'Organization not found' || msg === 'Event not found') return fail(403, 'You do not have access to that.');
      console.error('[mobile-api]', e);
      return fail(500, 'Something went wrong. Please try again.');
    }
  };
}

/** Parse a JSON body with a size cap. Returns an empty object for an empty body. */
export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new ApiError(413, 'Request too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, 'Request too large.');
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'Malformed request.');
  }
}

/**
 * Platform roles that may not use the mobile app for now (decision 2026-10-04: the Super Admin works from
 * the website only). Checked at sign-in and on every authenticated request, so a role granted after
 * sign-in takes effect immediately and an old app session cannot be reused.
 */
export const APP_BLOCKED_ROLES: PlatformRole[] = ['super_admin'];
export const APP_BLOCKED_MESSAGE = 'Super Admin accounts cannot sign in to the app yet. Please use the website.';

export function appAccessError(roles: PlatformRole[]): string | null {
  return roles.some((r) => APP_BLOCKED_ROLES.includes(r)) ? APP_BLOCKED_MESSAGE : null;
}

/**
 * The app is the Scan Manager (plan: download tickets, scan, manual check-in, override, undo, live counts)
 * for Organization Admins, Organizers and Staff / Scanners, each through an active organisation membership.
 * It has no attendee side (decision 2026-10-14) and nothing for platform-only accounts, so an account
 * without an active membership is refused at sign-in with a pointer to the website.
 */
export const APP_NO_PANEL_MESSAGE = 'This app is for organization admins, organizers and door staff. Attendees can see their tickets on the website.';

export function appPanelError(account: { memberships: { suspended: boolean }[] }): string | null {
  return account.memberships.some((m) => !m.suspended) ? null : APP_NO_PANEL_MESSAGE;
}

/** The signed-in app user, or 401. Blocked roles get 401 too, so the app drops the stored session. */
export async function requireUser(): Promise<CurrentSession> {
  const session = await getSession();
  if (!session || session.via !== 'bearer') throw new ApiError(401, 'Please sign in.');
  const blocked = appAccessError(session.user.roles);
  if (blocked) throw new ApiError(401, blocked);
  return session;
}

/** The signed-in app user if any (cookie sessions and blocked roles are ignored, see above). */
export async function optionalUser(): Promise<CurrentSession | null> {
  const session = await getSession();
  if (!session || session.via !== 'bearer' || appAccessError(session.user.roles)) return null;
  return session;
}

// ---------------------------------------------------------------------------
// Field validators: every value coming from the app goes through one of these.
// ---------------------------------------------------------------------------
export const v = {
  str(value: unknown, max: number, field?: string, { required = false, min = 0 } = {}): string {
    const s = typeof value === 'string' ? value.trim() : '';
    if (required && s.length < Math.max(1, min)) throw new ApiError(400, `${field ? label(field) : 'A required field'} is required.`, field);
    if (s.length > max) throw new ApiError(400, `${field ? label(field) : 'A field'} is too long.`, field);
    return s;
  },
  /** Raw string (not trimmed), for passwords. */
  raw(value: unknown, max: number, field: string): string {
    const s = typeof value === 'string' ? value : '';
    if (s.length > max) throw new ApiError(400, `${label(field)} is too long.`, field);
    return s;
  },
  int(value: unknown, field: string, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number {
    const n = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(400, `${label(field)} is invalid.`, field);
    return n;
  },
  bool(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
  },
  array<T>(value: unknown, field: string, max: number, item: (x: unknown, i: number) => T): T[] {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new ApiError(400, `${label(field)} is invalid.`, field);
    if (value.length > max) throw new ApiError(400, `${label(field)} has too many entries.`, field);
    return value.map(item);
  },
  obj(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, `${label(field)} is invalid.`, field);
    return value as Record<string, unknown>;
  },
  slug(value: unknown, field = 'slug'): string {
    const s = typeof value === 'string' ? value : '';
    if (!/^[a-z0-9-]{1,120}$/.test(s)) throw new ApiError(400, `${label(field)} is invalid.`, field);
    return s;
  },
  orderCode(value: unknown): string {
    const s = typeof value === 'string' ? value.toUpperCase() : '';
    if (!/^[A-Z0-9-]{6,12}$/.test(s)) throw new ApiError(404, 'Order not found.');
    return s;
  },
  /** Per-order access token (24 random bytes, base64url). */
  orderToken(value: unknown): string | null {
    const s = typeof value === 'string' ? value : '';
    return /^[A-Za-z0-9_-]{20,64}$/.test(s) ? s : null;
  },
};

function label(field: string): string {
  const s = field.replace(/[_-]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "iPhone 15 / iOS 18.1 / 1.0.0" from the app, sanitised. */
export function deviceLabel(body: Record<string, unknown>): string | null {
  const d = typeof body.device === 'string' ? body.device.replace(/[^\w .,/()+:-]/g, '').trim().slice(0, 120) : '';
  return d || null;
}
