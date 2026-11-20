import 'server-only';
import { copyFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { CopyObjectCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Image uploads are validated by content (not extension), resized and re-encoded to WebP (which strips any
 * embedded payload). Where they live depends on the environment:
 *
 * - With the DO_SPACES_* variables set they go to a DigitalOcean Space (S3-compatible, public-read) and the
 *   database stores the file's public https URL on the Space's CDN (DO_SPACES_PUBLIC_URL).
 * - Otherwise (local dev) they are written under <project>/uploads/<kind>/ and the database stores the
 *   relative "<kind>/<name>.webp" path, served by /api/uploads/[...path].
 *
 * `uploadUrl()` turns either stored form into something an <img> can load.
 */
export const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
const MAX_BYTES = 8 * 1024 * 1024;
const SPACES_PREFIX = 'uploads';
const SPACES_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const SPACES_HOST = /^https:\/\/[a-z0-9-]+\.[a-z0-9]+(\.cdn)?\.digitaloceanspaces\.com\//i;

export type UploadKind = 'events' | 'orgs' | 'ads' | 'sponsors' | 'site' | 'seatmaps' | 'avatars' | 'posts';

type SpacesConfig = { bucket: string; region: string; publicUrl: string; originUrl: string };

function spacesConfig(): SpacesConfig | null {
  const { DO_SPACES_KEY, DO_SPACES_SECRET, DO_SPACES_BUCKET, DO_SPACES_REGION, DO_SPACES_PUBLIC_URL } = process.env;
  if (!DO_SPACES_KEY || !DO_SPACES_SECRET || !DO_SPACES_BUCKET || !DO_SPACES_REGION) return null;
  const originUrl = `https://${DO_SPACES_BUCKET}.${DO_SPACES_REGION}.digitaloceanspaces.com`;
  return { bucket: DO_SPACES_BUCKET, region: DO_SPACES_REGION, originUrl, publicUrl: (DO_SPACES_PUBLIC_URL || originUrl).replace(/\/+$/, '') };
}

let client: S3Client | null = null;
function spaces(cfg: SpacesConfig): S3Client {
  client ??= new S3Client({
    region: cfg.region,
    endpoint: `https://${cfg.region}.digitaloceanspaces.com`,
    forcePathStyle: false,
    credentials: { accessKeyId: process.env.DO_SPACES_KEY!, secretAccessKey: process.env.DO_SPACES_SECRET! },
  });
  return client;
}

async function spacesPut(cfg: SpacesConfig, key: string, body: Buffer, contentType: string): Promise<string> {
  await spaces(cfg).send(new PutObjectCommand({
    Bucket: cfg.bucket, Key: key, Body: body, ACL: 'public-read', ContentType: contentType, CacheControl: SPACES_CACHE_CONTROL,
  }));
  return `${cfg.publicUrl}/${key}`;
}

/** The object key of a URL on this app's own Space (CDN or origin endpoint), or null. */
function spacesKey(cfg: SpacesConfig, url: string): string | null {
  for (const base of [cfg.publicUrl, cfg.originUrl]) {
    if (url.startsWith(`${base}/`)) return decodeURIComponent(url.slice(base.length + 1));
  }
  return null;
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
  const cfg = spacesConfig();
  if (cfg) return spacesPut(cfg, `${SPACES_PREFIX}/${kind}/${name}`, out, 'image/webp');
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
  const cfg = spacesConfig();
  if (cfg) return spacesPut(cfg, `${SPACES_PREFIX}/seatmaps/${name}`, input, contentType);
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
    if (isSpacesUrl(stored)) {
      const cfg = spacesConfig();
      const key = cfg && spacesKey(cfg, stored);
      if (!cfg || !key) return null;
      const kind = spacesKind(stored) ?? 'events';
      const ext = key.match(/\.[a-z0-9]+$/i)?.[0] ?? '.webp';
      const newKey = `${SPACES_PREFIX}/${kind}/${name.replace(/\.webp$/, ext)}`;
      await spaces(cfg).send(new CopyObjectCommand({
        Bucket: cfg.bucket, Key: newKey, CopySource: encodeURI(`${cfg.bucket}/${key}`), ACL: 'public-read', MetadataDirective: 'COPY',
      }));
      return `${cfg.publicUrl}/${newKey}`;
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
    if (isSpacesUrl(stored)) {
      const cfg = spacesConfig();
      const key = cfg && spacesKey(cfg, stored);
      if (cfg && key) await spaces(cfg).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    }
    else if (isSafeUploadPath(stored)) await unlink(path.join(UPLOAD_ROOT, stored));
  } catch { /* already gone */ }
}

/** A relative path of a locally stored upload (the format used in local dev). */
export function isSafeUploadPath(rel: string): boolean {
  return /^(events|orgs|ads|sponsors|site|seatmaps|avatars|posts)\/[a-z0-9-]+\.webp$/.test(rel) || /^seatmaps\/[a-z0-9-]+\.(pdf|xlsx|xls|csv)$/.test(rel);
}

/** A public URL of an upload stored on a DigitalOcean Space (CDN or origin endpoint). */
export function isSpacesUrl(value: string): boolean {
  return SPACES_HOST.test(value);
}

function spacesKind(url: string): UploadKind | null {
  const m = new URL(url).pathname.match(/^\/uploads\/(events|orgs|ads|sponsors|site|seatmaps|avatars|posts)\//);
  return (m?.[1] as UploadKind | undefined) ?? null;
}

export function uploadUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return isSpacesUrl(stored) ? stored : `/api/uploads/${stored}`;
}
