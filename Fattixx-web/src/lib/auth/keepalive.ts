'use server';

import { getSession } from './session';

/**
 * Called by long-lived editing pages (the seat map builder, the event's Seating tab) while the user is working on the
 * page without sending anything to the server. Reading the session slides its idle window, so someone who is actively
 * clicking around a large seat map isn't signed out after SESSION_IDLE_MINUTES. Answers whether the session is still valid.
 */
export async function keepSessionAlive(): Promise<boolean> {
  return !!(await getSession());
}
