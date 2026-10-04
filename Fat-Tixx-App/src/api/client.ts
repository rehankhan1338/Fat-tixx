import * as Device from 'expo-device';
import { API_BASE, APP_VERSION } from '@/lib/config';

/**
 * Thin fetch wrapper for the backend. Adds the Bearer token (when signed in), a request timeout, JSON
 * encoding and consistent error objects. Never logs request bodies or tokens.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public field?: string) {
    super(message);
    this.name = 'ApiError';
  }
  get isAuth() { return this.status === 401; }
  get isNetwork() { return this.status === 0; }
}

type TokenSource = () => string | null;
type UnauthorizedHandler = () => void;

let tokenSource: TokenSource = () => null;
let onUnauthorized: UnauthorizedHandler = () => {};

/** The auth provider registers how to read the current token and what to do when the server rejects it. */
export function configureAuth(src: TokenSource, handler: UnauthorizedHandler) {
  tokenSource = src;
  onUnauthorized = handler;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Default 15 s; the scanner uses a shorter one so a dead connection fails fast. */
  timeoutMs?: number;
  /** Send the request without the session token (e.g. a public event page). */
  anonymous?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Fat-Tixx-App': APP_VERSION, ...opts.headers };
  const token = opts.anonymous ? null : tokenSource();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    const aborted = (e as Error)?.name === 'AbortError';
    throw new ApiError(0, aborted ? 'The request timed out. Check your connection and try again.' : 'Could not reach Fat Tixx. Check your connection and try again.');
  }
  clearTimeout(timer);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; field?: string };
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, err.error ?? (res.status >= 500 ? 'Something went wrong. Please try again.' : 'Request failed.'), err.field);
  }
  return data as T;
}

/** Short device label stored with the session so the account page can tell devices apart. */
export function describeDevice(): string {
  const parts = [Device.modelName ?? Device.deviceName ?? 'Phone', `${Device.osName ?? ''} ${Device.osVersion ?? ''}`.trim(), `app ${APP_VERSION}`];
  return parts.filter(Boolean).join(' / ');
}
