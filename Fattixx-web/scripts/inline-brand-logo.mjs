// Regenerates src/lib/brand-logo-inline.ts: a small data-URI copy of public/images/brand/fattixx-logo.png used by the
// Super Admin email preview (see that file for why). Run after changing the logo:  node scripts/inline-brand-logo.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'public/images/brand/fattixx-logo.png');
const target = join(root, 'src/lib/brand-logo-inline.ts');

const png = await sharp(source).resize({ height: 96 }).png({ palette: true, quality: 90 }).toBuffer();
const { width, height } = await sharp(png).metadata();

writeFileSync(target, `/**
 * Small copy of public/images/brand/fattixx-logo.png (${width}x${height}, PNG) as a data URI. Used only where a remote image cannot be
 * relied on: the Super Admin email preview, which is rendered inside a sandboxed iframe on the admin origin and must not depend on
 * the public site being reachable or on the admin's CSP allowing it. Real emails keep the absolute URL, because Gmail and
 * Outlook do not render data: images. Generated file, do not edit; regenerate after changing the logo:
 *   node scripts/inline-brand-logo.mjs
 */
export const BRAND_LOGO_INLINE = { src: "data:image/png;base64,${png.toString('base64')}", width: ${width}, height: ${height} } as const;
`);
console.log(`Wrote ${target} (${png.length} bytes of PNG, ${width}x${height})`);
