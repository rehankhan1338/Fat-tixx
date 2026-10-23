import 'server-only';
import { copyFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { copy as blobCopy, del as blobDel, put as blobPut } from '@vercel/blob';

/**
 * Image uploads are validated by content (not extension), resized and re-encoded to WebP (which strips any
 * embedded payload). Where they live depends on the environment:
 *
 * - With BLOB_READ_WRITE_TOKEN set (Vercel, or a store token pulled into .env.local) they go to Vercel Blob
 *   and the database stores the blob's public https URL. Vercel's function filesystem is read-only, so this
 *   is the only option in production.
 * - Otherwise (local dev) they are written under <project>/uploads/<kind>/ and the database stores the
 *   relative "<kind>/<name>.webp" path, served by /api/uploads/[...path].
 *
 * `uploadUrl()` turns either stored form into something an <img> can load.
 */
export const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
const MAX_BYTES = 8 * 1024 * 1024;
const BLOB_PREFIX = 'uploads';
const BLOB_HOST = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;
const BLOB_CACHE_SECONDS = 365 * 24 * 60 * 60;

export type UploadKind = 'events' | 'orgs' | 'ads' | 'sponsors' | 'site' | 'seatmaps';

function blobEnabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function newName(): string {
  return `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.webp`;
}

export async function saveImageUpload(file: File, kind: UploadKind, maxWidth = 1600): Promise<string> {
  if (file.size === 0) throw new Error('Empty file');
  if (file.size > MAX_BYTES) throw new Error('Image must be 8 MB or smaller');
  const input = Buffer.from(await file.arrayBuffer());
  const meta = await sharp(input).metadata();
  if (!meta.format || !['jpeg', 'png', 'webp', 'gif', 'avif'].includes(meta.format)) throw new Error('Use a JPG, PNG or WebP image');

  const out = await sharp(input, { animated: false }).rotate().resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const name = newName();
  if (blobEnabled()) {
    const blob = await blobPut(`${BLOB_PREFIX}/${kind}/${name}`, out, {
      access: 'public',
      contentType: 'image/webp',
      addRandomSuffix: false,
      cacheControlMaxAge: BLOB_CACHE_SECONDS,
    });
    return blob.url;
  }
  await mkdir(path.join(UPLOAD_ROOT, kind), { recursive: true });
  await writeFile(path.join(UPLOAD_ROOT, kind, name), out);
  return `${kind}/${name}`;
}

/** Largest floor plan an organizer can upload (the request is sent to a Route Handler; Vercel functions take 4.5 MB). */
export const FLOOR_PLAN_MAX_BYTES = 4 * 1024 * 1024;

/**
 * A venue floor plan for a seat map request: an image (re-encoded to WebP like every upload, kept large enough to
 * trace seats from) or a PDF, checked by its first bytes and stored as it is.
 */
export async function saveFloorPlanUpload(file: File): Promise<{ path: string; kind: 'image' | 'pdf' }> {
  if (file.size === 0) throw new Error('The floor plan file is empty.');
  if (file.size > FLOOR_PLAN_MAX_BYTES) throw new Error('The floor plan must be 4 MB or smaller. Export a smaller PDF or image.');
  const input = Buffer.from(await file.arrayBuffer());
  if (input.subarray(0, 5).toString('latin1') !== '%PDF-') return { path: await saveImageUpload(file, 'seatmaps', 3200), kind: 'image' };
  const name = newName().replace(/\.webp$/, '.pdf');
  if (blobEnabled()) {
    const blob = await blobPut(`${BLOB_PREFIX}/seatmaps/${name}`, input, { access: 'public', contentType: 'application/pdf', addRandomSuffix: false, cacheControlMaxAge: BLOB_CACHE_SECONDS });
    return { path: blob.url, kind: 'pdf' };
  }
  await mkdir(path.join(UPLOAD_ROOT, 'seatmaps'), { recursive: true });
  await writeFile(path.join(UPLOAD_ROOT, 'seatmaps', name), input);
  return { path: `seatmaps/${name}`, kind: 'pdf' };
}

/** Duplicate a stored image so two records never share one file (deleting one must not break the other). */
export async function copyUpload(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  const name = newName();
  try {
    if (isBlobUrl(stored)) {
      const kind = blobKind(stored) ?? 'events';
      const blob = await blobCopy(stored, `${BLOB_PREFIX}/${kind}/${name}`, { access: 'public', contentType: 'image/webp', cacheControlMaxAge: BLOB_CACHE_SECONDS });
      return blob.url;
    }
    if (!isSafeUploadPath(stored)) return null;
    const kind = stored.split('/')[0];
    await copyFile(path.join(UPLOAD_ROOT, stored), path.join(UPLOAD_ROOT, kind, name));
    return `${kind}/${name}`;
  } catch { return null; }
}

export async function deleteUpload(stored: string | null | undefined): Promise<void> {
  if (!stored) return;
  try {
    if (isBlobUrl(stored)) await blobDel(stored);
    else if (isSafeUploadPath(stored)) await unlink(path.join(UPLOAD_ROOT, stored));
  } catch { /* already gone */ }
}

/** A relative path of a locally stored upload (the pre-Blob format, still used in local dev). */
export function isSafeUploadPath(rel: string): boolean {
  return /^(events|orgs|ads|sponsors|site|seatmaps)\/[a-z0-9-]+\.webp$/.test(rel) || /^seatmaps\/[a-z0-9-]+\.pdf$/.test(rel);
}

/** A public URL on a Vercel Blob store. */
export function isBlobUrl(value: string): boolean {
  return BLOB_HOST.test(value);
}

function blobKind(url: string): UploadKind | null {
  const m = new URL(url).pathname.match(/^\/uploads\/(events|orgs|ads|sponsors|site|seatmaps)\//);
  return (m?.[1] as UploadKind | undefined) ?? null;
}

export function uploadUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return isBlobUrl(stored) ? stored : `/api/uploads/${stored}`;
}
