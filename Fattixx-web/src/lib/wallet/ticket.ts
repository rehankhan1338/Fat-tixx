import { formatEventDate, formatTimeOnly } from '../tz';

/**
 * What a wallet pass shows (Apple Wallet and Google Wallet, Phase 3). Built from the ticket page's data
 * (getTicketByCode); the barcode is the same signed QR payload as the ticket page, so scanners need no change.
 * A pass is a snapshot: a refund, transfer or event change after it was added does not update it, but the scanner
 * checks the ticket's live status, so a stale pass is refused at the door like a stale screenshot.
 */
export interface WalletTicket {
  code: string;
  qrPayload: string;
  eventId: number;
  eventTitle: string;
  startsAt: Date;
  endsAt: Date | null;
  doorsAt: Date | null;
  timezone: string;
  venueName: string | null;
  venueAddress: string | null;
  online: boolean;
  ticketType: string;
  seat: string | null;
  attendee: string | null;
  orderCode: string;
  orgName: string;
  ageRestriction: number | null;
  ticketUrl: string;
  /** white-label organizer (lib/pro/white-label.ts): their name instead of Fattixx's, and their logo when they have one */
  whiteLabel?: boolean;
  orgLogoUrl?: string | null;
}

export function whenText(t: WalletTicket): string {
  return formatEventDate(t.startsAt, t.timezone);
}

export function doorsText(t: WalletTicket): string | null {
  return t.doorsAt ? formatTimeOnly(t.doorsAt, t.timezone) : null;
}

export function venueText(t: WalletTicket): string {
  return t.venueName ? [t.venueName, t.venueAddress].filter(Boolean).join(', ') : t.online ? 'Online event' : '';
}

/** PEM from an environment variable: the PEM itself (literal "\n" allowed, as many hosts store it) or base64 of it. */
export function pemFromEnv(v: string | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  if (s.includes('-----BEGIN')) return s.replace(/\\n/g, '\n');
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    return decoded.includes('-----BEGIN') ? decoded : null;
  } catch {
    return null;
  }
}
