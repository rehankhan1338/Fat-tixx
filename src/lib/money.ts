/** Money helpers. All amounts are integer cents; basis points (bps) are 1/100 of a percent. */

export function formatCents(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/** Round-half-up percentage of an amount, in cents. */
export function bpsOf(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10_000);
}

/** Parse a user-entered dollar amount ("12.50", "$1,200") to cents. Returns null if invalid. */
export function parseDollarsToCents(input: string): number | null {
  const clean = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}

export function centsToDollarsInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export interface FeeConfig {
  platformFeeBps: number;
  platformFeeFixedCents: number;
  processingFeeBps: number;
  processingFeeFixedCents: number;
}

export interface PriceLine {
  unitPriceCents: number;
  quantity: number;
  /** Add-ons (parking, merchandise) carry the percentage fee and tax but not the fixed per-ticket fee. */
  fixedFee?: boolean;
}

export interface OrderPricing {
  subtotalCents: number;
  platformFeeCents: number;      // charged to the buyer (0 when absorbed)
  processingFeeCents: number;    // charged to the buyer (0 when absorbed)
  taxCents: number;
  totalCents: number;            // buyer pays
  absorbedFeeCents: number;      // organizer absorbs (platform + processing)
  perUnitPlatformFee: number[];  // per line, per ticket
  perUnitTax: number[];          // per line, per ticket
}

/**
 * Compute what the buyer pays and what the organizer absorbs.
 *  - Platform fee: bps of ticket price + fixed per paid ticket (free tickets carry no fee).
 *  - Processing fee: bps of (subtotal + platform fee + tax) + fixed per order, only when money moves.
 *  - Tax (admissions/sales) applies to ticket price only.
 * Fee mode "buyer_pays" adds fees to the total; "organizer_absorbs" keeps the total at price + tax and
 * records the fees as absorbed, so settlement statements can deduct them from the payout.
 */
export function priceOrder(lines: PriceLine[], fees: FeeConfig, taxBps: number, feeMode: 'buyer_pays' | 'organizer_absorbs'): OrderPricing {
  let subtotal = 0, platformFee = 0, tax = 0;
  const perUnitPlatformFee: number[] = [];
  const perUnitTax: number[] = [];
  for (const line of lines) {
    const unitFee = line.unitPriceCents > 0 ? bpsOf(line.unitPriceCents, fees.platformFeeBps) + (line.fixedFee === false ? 0 : fees.platformFeeFixedCents) : 0;
    const unitTax = bpsOf(line.unitPriceCents, taxBps);
    perUnitPlatformFee.push(unitFee);
    perUnitTax.push(unitTax);
    subtotal += line.unitPriceCents * line.quantity;
    platformFee += unitFee * line.quantity;
    tax += unitTax * line.quantity;
  }
  const moneyMoves = subtotal + tax > 0;
  const buyerPays = feeMode === 'buyer_pays';
  const baseForProcessing = subtotal + tax + (buyerPays ? platformFee : 0);
  const processingFee = moneyMoves ? bpsOf(baseForProcessing, fees.processingFeeBps) + fees.processingFeeFixedCents : 0;

  if (buyerPays) {
    return {
      subtotalCents: subtotal, platformFeeCents: platformFee, processingFeeCents: processingFee, taxCents: tax,
      totalCents: subtotal + platformFee + processingFee + tax, absorbedFeeCents: 0, perUnitPlatformFee, perUnitTax,
    };
  }
  return {
    subtotalCents: subtotal, platformFeeCents: 0, processingFeeCents: 0, taxCents: tax,
    totalCents: subtotal + tax, absorbedFeeCents: platformFee + processingFee, perUnitPlatformFee, perUnitTax,
  };
}
