import 'server-only';
import type { OrgContext } from '../authz';
import { isProActive } from './status';

/**
 * Pro feature gate. `organizations.pro_until` is kept current by lib/pro/subscription.ts, so the organization row the
 * page or action already loaded answers the question. Platform staff see Pro pages of any organization (read-only
 * help), but actions that send or publish still need the organization itself to be on Pro.
 */
export function orgIsPro(org: { pro_until?: Date | string | null }): boolean {
  return isProActive(org.pro_until);
}

/** For Server Actions: throws a readable message when the organization is not on Pro. */
export function assertPro(ctx: OrgContext): void {
  if (!orgIsPro(ctx.org)) throw new Error('This is a Fattixx Pro feature. Upgrade on the Pro page to use it.');
}
