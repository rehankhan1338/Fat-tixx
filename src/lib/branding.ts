import 'server-only';
import { cache } from 'react';
import { getBranding, type Branding } from './settings';
import { uploadUrl } from './uploads';

/** Per-request cached branding plus derived values for layouts. */
export const brandingForLayout = cache(async () => {
  const b: Branding = await getBranding();
  return { ...b, logoUrl: uploadUrl(b.logoPath), foreground: contrastText(b.color) };
});

/** Black or white text for a given background hex, by relative luminance. */
export function contrastText(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#18181b';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // WCAG: dark text when the background is reasonably light (amber #f59e0b ≈ 0.43 → dark text).
  return lum > 0.3 ? '#18181b' : '#ffffff';
}
