import 'server-only';
import { getTicketByCode, ticketDayLabel } from '../orders/queries';
import { signTicket, ticketUrl } from '../tickets';
import { appleWalletConfig } from './apple';
import { googleWalletConfig } from './google';
import type { WalletTicket } from './ticket';
import { env } from '../env';
import { queryOne, type Row } from '../db';
import { uploadUrl } from '../uploads';
import { whiteLabelActive } from '../pro/white-label';

/** Which wallet buttons the ticket page shows. */
export function walletsEnabled(): { apple: boolean; google: boolean } {
  return { apple: !!appleWalletConfig(), google: !!googleWalletConfig() };
}

/**
 * The ticket for a wallet pass, with the ticket page's access rule (the first 12 characters of the ticket secret,
 * from the emailed link). 'gone' for refunded / cancelled / transferred-away tickets, null when not found.
 */
export async function walletTicket(rawCode: string, k: string): Promise<WalletTicket | 'gone' | null> {
  const t = await getTicketByCode(rawCode.toUpperCase());
  if (!t || k.length < 12 || !t.secret.startsWith(k)) return null;
  if (!['valid', 'used'].includes(t.ticket_status)) return 'gone';
  const day = ticketDayLabel(t, t.event_timezone);
  const whiteLabel = whiteLabelActive({ white_label: t.org_white_label, pro_until: t.org_pro_until });
  const logo = whiteLabel ? uploadUrl((await queryOne<Row & { logo_path: string | null }>(`SELECT logo_path FROM organizations WHERE id = ?`, [t.organization_id]))?.logo_path) : null;
  return {
    code: t.ticket_code,
    qrPayload: signTicket(t.ticket_code, t.secret),
    eventId: Number(t.event_id),
    eventTitle: t.event_title,
    startsAt: new Date(t.event_starts_at),
    endsAt: t.event_ends_at ? new Date(t.event_ends_at) : null,
    doorsAt: t.doors_at ? new Date(t.doors_at) : null,
    timezone: t.event_timezone,
    venueName: t.venue_name,
    venueAddress: [t.venue_address, t.venue_city, t.venue_region].filter(Boolean).join(', ') || null,
    online: !t.venue_name && !!t.event_online_url,
    ticketType: `${t.ticket_type_name}${day ? ` · ${day}` : ''}`,
    seat: t.seat_label,
    attendee: t.attendee_name ?? t.buyer_name ?? null,
    orderCode: t.order_code,
    orgName: t.org_name,
    ageRestriction: t.age_restriction,
    ticketUrl: ticketUrl(t.ticket_code, t.secret),
    whiteLabel,
    orgLogoUrl: logo ? (/^https?:/.test(logo) ? logo : `${env.APP_URL}${logo}`) : null,
  };
}
