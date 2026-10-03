import 'server-only';
import { copyFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

/**
 * Image uploads are validated by content (not extension), resized, re-encoded to WebP and
 * stored under <project>/uploads/<kind>/. They are served by /api/uploads/[...path] so the
 * directory never needs to be web-root and re-encoding strips any embedded payload.
 */
export const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
const MAX_BYTES = 8 * 1024 * 1024;

export type UploadKind = 'events' | 'orgs' | 'ads' | 'sponsors';

export async function saveImageUpload(file: File, kind: UploadKind, maxWidth = 1600): Promise<string> {
  if (file.size === 0) throw new Error('Empty file');
  if (file.size > MAX_BYTES) throw new Error('Image must be 8 MB or smaller');
  const input = Buffer.from(await file.arrayBuffer());
  const meta = await sharp(input).metadata();
  if (!meta.format || !['jpeg', 'png', 'webp', 'gif', 'avif'].includes(meta.format)) throw new Error('Use a JPG, PNG or WebP image');

  const out = await sharp(input, { animated: false }).rotate().resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.webp`;
  await mkdir(path.join(UPLOAD_ROOT, kind), { recursive: true });
  await writeFile(path.join(UPLOAD_ROOT, kind, name), out);
  return `${kind}/${name}`;
}

/** Duplicate a stored image so two records never share one file (deleting one must not break the other). */
export async function copyUpload(relPath: string | null | undefined): Promise<string | null> {
  if (!relPath || !isSafeUploadPath(relPath)) return null;
  const kind = relPath.split('/')[0];
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.webp`;
  try {
    await copyFile(path.join(UPLOAD_ROOT, relPath), path.join(UPLOAD_ROOT, kind, name));
    return `${kind}/${name}`;
  } catch { return null; }
}

export async function deleteUpload(relPath: string | null | undefined): Promise<void> {
  if (!relPath || !isSafeUploadPath(relPath)) return;
  try { await unlink(path.join(UPLOAD_ROOT, relPath)); } catch { /* already gone */ }
}

export function isSafeUploadPath(rel: string): boolean {
  return /^(events|orgs|ads|sponsors)\/[a-z0-9-]+\.webp$/.test(rel);
}

export function uploadUrl(relPath: string | null | undefined): string | null {
  return relPath ? `/api/uploads/${relPath}` : null;
}
