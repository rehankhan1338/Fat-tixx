/** Formatting helpers ported from the website (src/lib/money.ts). */
const SYMBOL: Record<string, string> = { USD: '$', CAD: 'CA$', EUR: '€', GBP: '£', SEK: 'kr', AUD: 'A$' };

/** Integer cents → "$12.50". Intl currency formatting is not reliable on every Android locale, so this is explicit. */
export function formatCents(cents: number, currency = 'USD'): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  const sym = SYMBOL[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  return `${sign}${sym}${whole}.${frac}`;
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}
