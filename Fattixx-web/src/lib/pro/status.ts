/*
 * Fattixx Pro status (plan 5.7.11): what a subscription means for the organization's Pro features. Pure functions, so
 * the rules are the same in the webhook, the daily job, the dashboard and the tests.
 *
 * The rules:
 *  1. Active (or trialing): Pro is on. The stored `pro_until` runs to the end of the paid period plus the grace period,
 *     so a renewal that Stripe reports a little late never switches Pro off.
 *  2. Cancelled by the organizer: Pro stays on until the end of the period they paid for, and they can resume it until then.
 *  3. A renewal payment fails (past_due): Pro stays on for the grace period (Admin → Fees & Settings, 7 days by default)
 *     counted from the first failure. Org admins are emailed when it fails and 2 days before the grace period ends.
 *     A payment that succeeds later switches Pro back on at once.
 *  4. Grace over, or Stripe gives up (unpaid / canceled / paused): Pro ends. Branding, the custom domain claim, email
 *     contacts, campaigns and report data are kept, not deleted; see `PRO_END_RULES`.
 *  5. A Super Admin can grant complimentary Pro until a date, regardless of billing.
 */

export type SubscriptionStatus = 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'paused';
export type BillingInterval = 'month' | 'year';

export type SubscriptionSnapshot = {
  status: SubscriptionStatus;
  billing_interval: BillingInterval;
  cancel_at_period_end: boolean | number;
  current_period_end: Date | string | null;
  past_due_since: Date | string | null;
  ended_at: Date | string | null;
};

export type ProState =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'active'; renews: Date | null; interval: BillingInterval }
  | { kind: 'canceling'; until: Date; interval: BillingInterval }
  | { kind: 'grace'; until: Date; since: Date }
  | { kind: 'lapsed'; since: Date | null }
  | { kind: 'ended'; at: Date | null }
  | { kind: 'comp'; until: Date };

export const DEFAULT_GRACE_DAYS = 7;
const DAY = 86_400_000;

const date = (d: Date | string | null | undefined): Date | null => (d ? new Date(d) : null);
const later = (a: Date | null, b: Date | null): Date | null => (!a ? b : !b ? a : a > b ? a : b);

/** Until when the subscription alone keeps Pro on (null = it does not). */
export function subscriptionProUntil(sub: SubscriptionSnapshot | null, graceDays = DEFAULT_GRACE_DAYS, now = new Date()): Date | null {
  if (!sub) return null;
  const periodEnd = date(sub.current_period_end);
  const grace = Math.max(0, graceDays) * DAY;
  switch (sub.status) {
    case 'active':
    case 'trialing':
      if (sub.cancel_at_period_end) return periodEnd;
      return new Date((periodEnd ?? now).getTime() + grace);
    case 'past_due':
      return new Date((date(sub.past_due_since) ?? now).getTime() + grace);
    default:
      return null;
  }
}

/** The organization's `pro_until`: the later of the subscription's and a complimentary grant. */
export function proUntil(sub: SubscriptionSnapshot | null, compUntil: Date | string | null, graceDays = DEFAULT_GRACE_DAYS, now = new Date()): Date | null {
  return later(subscriptionProUntil(sub, graceDays, now), date(compUntil));
}

export function isProActive(until: Date | string | null | undefined, now = new Date()): boolean {
  const d = date(until);
  return !!d && d.getTime() > now.getTime();
}

/** What the dashboard says about the plan. */
export function proState(sub: SubscriptionSnapshot | null, compUntil: Date | string | null, graceDays = DEFAULT_GRACE_DAYS, now = new Date()): ProState {
  const comp = date(compUntil);
  const subUntil = subscriptionProUntil(sub, graceDays, now);
  const subOn = isProActive(subUntil, now);
  // A paid subscription is shown even when a complimentary grant runs longer: it is what the organizer manages.
  if (sub && subOn) {
    if (sub.status === 'past_due') return { kind: 'grace', until: subUntil!, since: date(sub.past_due_since) ?? now };
    if (sub.cancel_at_period_end) return { kind: 'canceling', until: subUntil!, interval: sub.billing_interval };
    return { kind: 'active', renews: date(sub.current_period_end), interval: sub.billing_interval };
  }
  if (comp && comp > now) return { kind: 'comp', until: comp };
  if (!sub) return { kind: 'none' };
  if (sub.status === 'incomplete') return { kind: 'pending' };
  if (sub.status === 'past_due' || sub.status === 'unpaid') return { kind: 'lapsed', since: subUntil ?? date(sub.past_due_since) };
  if (sub.status === 'active' || sub.status === 'trialing') return { kind: 'ended', at: date(sub.current_period_end) }; // cancelled at period end, period over
  return { kind: 'ended', at: date(sub.ended_at) };
}

/** Pro on for this state? (Same answer as isProActive(proUntil(...)).) */
export function stateIsPro(s: ProState): boolean {
  return s.kind === 'active' || s.kind === 'canceling' || s.kind === 'grace' || s.kind === 'comp';
}

/** Can the organizer start a new subscription (rather than manage the current one)? */
export function canSubscribe(s: ProState): boolean {
  return s.kind === 'none' || s.kind === 'pending' || s.kind === 'ended' || s.kind === 'comp';
}

/** What happens to each Pro feature when Pro ends (shown on the Pro page and the cancel dialog). */
export const PRO_END_RULES: { feature: string; rule: string }[] = [
  { feature: 'Branding and your own header', rule: 'Your event pages go back to the standard Fattixx look. Your colors, cover image and header setting are kept and come back if you resubscribe.' },
  { feature: 'Custom domain', rule: 'Visitors are sent to your normal Fattixx address. The domain stays reserved for you for 30 days, then it is released.' },
  { feature: 'No ads', rule: 'Fattixx and partner ads may appear on your event pages again. Your own sponsors stay.' },
  { feature: 'Email marketing', rule: 'Scheduled campaigns are paused, not sent. Contacts, segments, templates and campaign stats are kept; unsubscribes are always honoured.' },
  { feature: 'Reserved seating', rule: 'Events already selling reserved seats keep selling, and every sold seat is honoured. You can’t add a seat map to another event or request a new map until you resubscribe. Your maps are kept.' },
  { feature: 'Advanced reports', rule: 'The reports are hidden until you resubscribe. The data behind them is not deleted.' },
  { feature: 'Priority support', rule: 'New support requests join the normal queue. Open requests keep their place.' },
  { feature: 'Pro check mark', rule: 'Removed from your name on listings and event pages.' },
];
