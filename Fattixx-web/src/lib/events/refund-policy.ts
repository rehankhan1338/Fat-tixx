/*
 * Refund policies (events.refund_policy). The /create page offers the plan's four choices: no refunds, up to 7 days
 * before, up to 24 hours before (days_before with 7 / 1 days) and "Contact the organizer". Events made before then
 * may still carry "until the event starts" or another number of days; they keep working and keep their wording.
 */

export type RefundPolicy = 'no_refunds' | 'until_event_start' | 'days_before' | 'contact_organizer';

export const REFUND_POLICIES: RefundPolicy[] = ['no_refunds', 'until_event_start', 'days_before', 'contact_organizer'];

export function isRefundPolicy(v: unknown): v is RefundPolicy {
  return typeof v === 'string' && (REFUND_POLICIES as string[]).includes(v);
}

/** "24 hours" for one day, "7 days" otherwise. */
function span(days: number): string {
  return days === 1 ? '24 hours' : `${days} days`;
}

/** The sentence shown on the event page, at checkout and in the ticket pop-up. */
export function refundPolicyText(e: { refund_policy: string; refund_days_before: number | null }): string {
  switch (e.refund_policy) {
    case 'until_event_start':
      return 'Refunds on request until the event starts.';
    case 'days_before':
      return `Refunds on request up to ${span(Number(e.refund_days_before ?? 0))} before the event.`;
    case 'contact_organizer':
      return 'Contact the organizer about refunds. They decide case by case.';
    default:
      return "No refunds. Tickets can't be refunded unless the event is cancelled.";
  }
}

/** Short label for menus: "Up to 7 days before", "Contact the organizer". */
export function refundPolicyLabel(policy: string, days: number | null): string {
  switch (policy) {
    case 'until_event_start':
      return 'Until the event starts';
    case 'days_before':
      return `Up to ${span(Number(days ?? 0))} before`;
    case 'contact_organizer':
      return 'Contact the organizer';
    default:
      return 'No refunds';
  }
}
