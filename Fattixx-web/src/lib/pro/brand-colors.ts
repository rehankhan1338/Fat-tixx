/*
 * Organizer brand colors (Fattixx Pro, plan 5.7.2). The public pages are drawn with the --color-fx-* tokens
 * (src/app/globals.css); a Pro organization's pages override them with its own primary (text, links, dark buttons) and
 * accent (the main call-to-action buttons). Colors are only accepted when they keep the pages readable (WCAG 2.1 AA,
 * plan 11.3), so an organizer cannot make their ticket button or prices illegible.
 */

/** The page background (--color-fx-ivory) and sheet (--color-fx-white) the brand colors sit on. */
const IVORY = '#F5F1EA';
const WHITE = '#FFFDFA';
/** WCAG AA for normal-size text */
export const MIN_CONTRAST = 4.5;

export function normalizeHex(input: string | null | undefined): string | null {
  const s = String(input ?? '').trim().toLowerCase();
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const long = /^#?([0-9a-f]{6})$/.exec(s);
  return long ? `#${long[1]}` : null;
}

function rgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix `hex` toward black (amount 0–1). */
export function shade(hex: string, amount: number): string {
  const k = 1 - Math.min(1, Math.max(0, amount));
  return `#${rgb(hex).map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('')}`;
}

export type BrandColorCheck = { ok: true; primary: string; accent: string } | { ok: false; error: string };

/**
 * Validate a primary / accent pair. The primary is text on the ivory page and white cards, and the background of
 * ivory text; the accent is the background of primary-colored button text.
 */
export function checkBrandColors(primaryRaw: string, accentRaw: string): BrandColorCheck {
  const primary = normalizeHex(primaryRaw);
  const accent = normalizeHex(accentRaw);
  if (!primary) return { ok: false, error: 'Enter the main color as a hex code, e.g. #1D4ED8.' };
  if (!accent) return { ok: false, error: 'Enter the accent color as a hex code, e.g. #FACC15.' };
  const onPage = Math.min(contrastRatio(primary, IVORY), contrastRatio(primary, WHITE));
  if (onPage < MIN_CONTRAST) {
    return { ok: false, error: `The main color is too light to read on the page (contrast ${onPage.toFixed(1)}:1, at least ${MIN_CONTRAST}:1 is needed). Choose a darker shade.` };
  }
  const button = contrastRatio(primary, accent);
  if (button < MIN_CONTRAST) {
    return { ok: false, error: `Button text in your main color is hard to read on the accent color (contrast ${button.toFixed(1)}:1, at least ${MIN_CONTRAST}:1 is needed). Choose a lighter accent or a darker main color.` };
  }
  return { ok: true, primary, accent };
}

/** CSS custom properties that re-skin a public page in the organizer's colors (set on the page wrapper). */
export function brandCssVars(primary: string, accent: string): Record<string, string> {
  return {
    '--color-fx-red': primary,
    '--color-fx-red-second': primary,
    '--color-fx-red-bright': primary,
    '--color-fx-red-dark': shade(primary, 0.15),
    '--color-fx-red-night': shade(primary, 0.4),
    '--color-fx-red-deep': shade(primary, 0.6),
    '--color-fx-yellow': accent,
  };
}
