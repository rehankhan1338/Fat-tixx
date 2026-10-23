import 'server-only';
import { createHash, createSign } from 'node:crypto';
import { env } from '../env';
import { isoWithOffset } from '../tz';
import { venueText, type WalletTicket } from './ticket';

/**
 * Google Wallet event tickets through a signed "Save to Google Wallet" link: the event's ticket class and the ticket
 * object travel inside the JWT, so nothing has to be created in Google's API first. Needs, from the Google Pay &
 * Wallet Console and Google Cloud:
 *   GOOGLE_WALLET_ISSUER_ID        the issuer ID (Google Pay & Wallet Console → Google Wallet API)
 *   GOOGLE_WALLET_SERVICE_ACCOUNT  the service account's JSON key (raw JSON, or base64 of it); the account must be
 *                                  added as a user of the issuer, and the Google Wallet API enabled in its project
 * Until Google approves the issuer for publishing, only the issuer's test accounts can save passes.
 */
export interface GoogleWalletConfig { issuerId: string; clientEmail: string; privateKey: string }

export function googleWalletConfig(): GoogleWalletConfig | null {
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID?.trim();
  const raw = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT?.trim();
  if (!issuerId || !/^\d+$/.test(issuerId) || !raw) return null;
  try {
    const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) as { client_email?: string; private_key?: string };
    if (!json.client_email || !json.private_key) return null;
    return { issuerId, clientEmail: json.client_email, privateKey: json.private_key.replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

const text = (value: string) => ({ defaultValue: { language: 'en-US', value } });

/**
 * The JWT payload. Google never updates an existing class from a save link, so the class id carries a hash of the
 * event details shown on it: when the organizer changes the time or venue, passes saved later get a new class.
 */
export function googleWalletPayload(t: WalletTicket, cfg: Pick<GoogleWalletConfig, 'issuerId' | 'clientEmail'>, origin = env.APP_URL): Record<string, unknown> {
  const venue = venueText(t);
  const classBody = {
    issuerName: t.whiteLabel ? t.orgName : 'Fattixx',
    eventName: text(t.eventTitle),
    reviewStatus: 'UNDER_REVIEW',
    hexBackgroundColor: '#A8121A',
    logo: t.whiteLabel && t.orgLogoUrl
      ? { sourceUri: { uri: t.orgLogoUrl }, contentDescription: text(t.orgName) }
      : { sourceUri: { uri: `${origin}/images/brand/wallet-logo.png` }, contentDescription: text('Fattixx') },
    ...(t.venueName ? { venue: { name: text(t.venueName), address: text(t.venueAddress || t.venueName) } } : {}),
    dateTime: {
      start: isoWithOffset(t.startsAt, t.timezone),
      ...(t.endsAt ? { end: isoWithOffset(t.endsAt, t.timezone) } : {}),
      ...(t.doorsAt ? { doorsOpen: isoWithOffset(t.doorsAt, t.timezone) } : {}),
    },
  };
  const version = createHash('sha256').update(JSON.stringify(classBody)).digest('hex').slice(0, 10);
  const classId = `${cfg.issuerId}.fx_event_${t.eventId}_${version}`;
  return {
    iss: cfg.clientEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [origin],
    payload: {
      eventTicketClasses: [{ id: classId, ...classBody }],
      eventTicketObjects: [{
        id: `${cfg.issuerId}.fx_ticket_${t.code}`,
        classId,
        state: 'ACTIVE',
        barcode: { type: 'QR_CODE', value: t.qrPayload, alternateText: t.code },
        ticketNumber: t.code,
        ticketType: text(t.ticketType),
        ...(t.attendee ? { ticketHolderName: t.attendee } : {}),
        ...(t.seat ? { seatInfo: { seat: text(t.seat) } } : {}),
        reservationInfo: { confirmationCode: t.orderCode },
        textModulesData: [
          ...(venue && !t.venueName ? [{ id: 'venue', header: 'Where', body: venue }] : []),
          ...(t.ageRestriction ? [{ id: 'age', header: 'Age', body: `${t.ageRestriction}+ event. Bring a valid photo ID.` }] : []),
          { id: 'organizer', header: 'Organizer', body: t.orgName },
        ],
        linksModuleData: { uris: [{ id: 'ticket', uri: t.ticketUrl, description: 'Your ticket online' }] },
      }],
    },
  };
}

/** https://pay.google.com/gp/v/save/<RS256 JWT> */
export function googleWalletSaveUrl(t: WalletTicket, cfg: GoogleWalletConfig): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(googleWalletPayload(t, cfg))}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(cfg.privateKey).toString('base64url');
  return `https://pay.google.com/gp/v/save/${unsigned}.${sig}`;
}
