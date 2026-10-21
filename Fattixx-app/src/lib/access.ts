import type { Account } from '@/api/types';

/**
 * Who may use the app. It is the Scan Manager for organisations' door teams: Organization Admins,
 * Organizers and Staff / Scanners, each through an active organisation membership. Which events a
 * member sees, and whether they may override or undo a check-in, is decided by the server from that
 * membership (plan: admins see every event of the organisation; organizers and staff only the events
 * they are assigned to; override and undo only when the Organization Admin allows).
 *
 * Attendees and platform-only accounts (support, finance, super admin) have no screen here and are
 * refused at sign-in; the server applies the same rule (`appPanelError` in src/lib/mobile/http.ts).
 */
export function hasAppAccess(account: Account | null | undefined): boolean {
  return !!account?.memberships.some((m) => !m.suspended);
}

export const NO_ACCESS_MESSAGE = 'This app is for organization admins, organizers and door staff. Attendees can see their tickets on the Fattixx website.';
