import { randomBytes } from 'node:crypto';

export function slugify(input: string, maxLen = 60): string {
  const s = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/g, '');
  return s || 'item';
}

/** Short random suffix used to de-duplicate slugs. */
export function shortSuffix(): string {
  return randomBytes(3).toString('hex');
}

/** Human-friendly codes (no 0/O/1/I): e.g. "FTX-7K2M9Q". */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function humanCode(length: number, prefix = ''): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return prefix + out;
}
