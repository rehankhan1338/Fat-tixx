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

export type FloorPlanKind = 'image' | 'pdf' | 'spreadsheet';
export type SpreadsheetExt = keyof typeof SPREADSHEET_TYPES;

export const SPREADSHEET_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
} as const;

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * What kind of spreadsheet these bytes are, judged by content like every upload, or null. Excel workbooks are told from
 * other Office files by the entry names inside them, and macro-enabled ones are refused because staff open these files.
 * CSV has no signature, so it also needs the .csv file name, no binary content and at least one column separator.
 */
export function spreadsheetExt(input: Buffer, fileName: string): SpreadsheetExt | null {
  if (input.subarray(0, 4).equals(ZIP_MAGIC)) {
    const isWorkbook = input.includes('[Content_Types].xml', 0, 'latin1') && input.includes('xl/workbook.xml', 0, 'latin1');
    return isWorkbook && !input.includes('xl/vbaProject.bin', 0, 'latin1') ? 'xlsx' : null;
  }
  if (input.subarray(0, 8).equals(OLE_MAGIC)) {
    return input.includes('Workbook', 0, 'utf16le') && !input.includes('_VBA_PROJECT', 0, 'utf16le') ? 'xls' : null;
  }
  if (/\.csv$/i.test(fileName) && !input.includes(0) && /[,;\t]/.test(input.toString('latin1'))) return 'csv';
  return null;
}

async function storeFloorPlan(input: Buffer, ext: string, contentType: string): Promise<string> {
  const name = newName().replace(/\.webp$/, `.${ext}`);
  if (blobEnabled()) {
    const blob = await blobPut(`${BLOB_PREFIX}/seatmaps/${name}`, input, { access: 'public', contentType, addRandomSuffix: false, cacheControlMaxAge: BLOB_CACHE_SECONDS });
    return blob.url;
  }
  await mkdir(path.join(UPLOAD_ROOT, 'seatmaps'), { recursive: true });
  await writeFile(path.join(UPLOAD_ROOT, 'seatmaps', name), input);
  return `seatmaps/${name}`;
}

/**
 * A venue floor plan for a seat map request: an image (re-encoded to WebP like every upload, kept large enough to
 * trace seats from), or a PDF or spreadsheet, checked by content and stored as it is.
 */
export async function saveFloorPlanUpload(file: File): Promise<{ path: string; kind: FloorPlanKind }> {
  if (file.size === 0) throw new Error('The floor plan file is empty.');
  if (file.size > FLOOR_PLAN_MAX_BYTES) throw new Error('The floor plan must be 4 MB or smaller. Export a smaller file.');
  const input = Buffer.from(await file.arrayBuffer());
  if (input.subarray(0, 5).toString('latin1') === '%PDF-') return { path: await storeFloorPlan(input, 'pdf', 'application/pdf'), kind: 'pdf' };
  const sheet = spreadsheetExt(input, file.name);
  if (sheet) return { path: await storeFloorPlan(input, sheet, SPREADSHEET_TYPES[sheet]), kind: 'spreadsheet' };
  try {
    return { path: await saveImageUpload(file, 'seatmaps', 3200), kind: 'image' };
  } catch {
    throw new Error('Use a PDF, JPG, PNG, Excel (.xlsx or .xls, without macros) or CSV file.');
  }
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
  return /^(events|orgs|ads|sponsors|site|seatmaps)\/[a-z0-9-]+\.webp$/.test(rel) || /^seatmaps\/[a-z0-9-]+\.(pdf|xlsx|xls|csv)$/.test(rel);
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
