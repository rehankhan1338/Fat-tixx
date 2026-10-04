/** Shapes returned by the backend's /api/mobile/v1 routes (see src/lib/mobile/* in the website repo). */

export type PlatformRole = 'super_admin' | 'support' | 'finance';
export type OrgRole = 'org_admin' | 'organizer' | 'staff';

export interface MobileUser { id: string; email: string; name: string; emailVerified: boolean; roles: PlatformRole[] }
export interface MobileMembership { slug: string; name: string; role: OrgRole; logoUrl: string | null; suspended: boolean }
export interface Account { user: MobileUser; memberships: MobileMembership[]; canScan: boolean }

export interface AuthResponse { token: string; expiresAt: string; account: Account; message?: string }
export interface PendingRegistration { pending: true; message: string }

export interface PlatformConfig {
  name: string; color: string; logoUrl: string | null; supportEmail: string; appUrl: string;
  stripe: { publishableKey: string; mode: 'test' | 'live' } | null;
  smsEnabled: boolean;
  legal: { terms: string; privacy: string; refunds: string; ticketing: string };
}

export interface EventCard {
  id: number; slug: string; key: string | null; title: string; category: string; date: string; time: string; venue: string; city: string;
  lat: number | null; lon: number | null; price: number | null; featured: boolean; tag: string | null; imageUrl: string | null; poster: string;
  organizerName: string; organizerInitials: string; organizerId: string;
}
export interface EventList { events: EventCard[] }

export interface TicketOption {
  id: number; name: string; description: string | null; kind: string; priceCents: number; allInCents: number; available: number;
  min: number; max: number; seats: number; onSale: boolean; reason: string | null; salesStart: string | null; presale: boolean; dayLabel: string | null;
}
export interface AddonOption { id: number; name: string; description: string | null; priceCents: number; allInCents: number; available: number | null; max: number }
export interface Question { id: number; label: string; kind: 'text' | 'textarea' | 'select' | 'checkbox'; required: boolean; options: string[] }

export interface EventDetail {
  event: {
    id: number; slug: string; key: string | null; title: string; summary: string | null; description: string | null; imageUrl: string | null;
    startsAt: string; endsAt: string | null; doorsAt: string | null; timezone: string; status: string; visibility: string; currency: string; feeMode: string;
    ageRestriction: number | null; allowTransfers: boolean; refundText: string; category: string | null;
    venue: { name: string | null; address: string | null; city: string | null; region: string | null };
    organizer: { name: string; slug: string; logoUrl: string | null };
    dates: { id: number; label: string; when: string }[];
    siblings: { slug: string; key: string | null; when: string }[];
    sponsors: { id: number; name: string; logoUrl: string | null; url: string | null; tier: string | null }[];
  };
  isLive: boolean; preview: boolean;
  tickets: TicketOption[]; addons: AddonOption[]; questions: Question[];
  soldOut: boolean; soldOutTypes: { id: number; name: string }[]; showWaitlist: boolean; hasPresale: boolean;
  accessCode: string; codeRejected: boolean; unlockedNames: string[]; hasPromo: boolean; smsEnabled: boolean; inQueue: boolean; feeNote: string;
}

export interface QueueStatus { admitted: boolean; position: number; ahead: number; etaMinutes: number; expiresAt: string | null; token?: string }

export interface CheckoutRequest {
  eventSlug: string; lines: { ticketTypeId: number; quantity: number }[]; addons: { addonId: number; quantity: number }[];
  answers: { questionId: number; answer: string }[]; email: string; name: string; phone?: string; accessCode?: string; promoCode?: string;
  marketing: boolean; sms: boolean; startedAt: number;
}
export interface CheckoutResponse { code: string; accessToken: string; totalCents: number; currency: string; free: boolean }

export interface Ticket {
  id: number; code: string; type: string; status: string; seatLabel: string | null; dayLabel: string | null; attendeeName: string | null;
  qr: string | null; webUrl: string | null; transferredTo: string | null;
}
export interface OrderDetail {
  code: string; status: string; currency: string; buyerEmail: string; buyerName: string | null;
  totals: { subtotalCents: number; discountCents: number; platformFeeCents: number; processingFeeCents: number; taxCents: number; totalCents: number; refundedCents: number };
  items: { id: number; name: string; quantity: number; unitCents: number; lineCents: number }[];
  addons: { id: number; name: string; quantity: number; unitCents: number; lineCents: number }[];
  tickets: Ticket[];
  event: { slug: string; key: string | null; title: string; startsAt: string; when: string; timezone: string; venue: string | null; ageRestriction: number | null; organizer: string; refundPolicy: string };
  holdExpiresAt: string | null; expired: boolean; mayRefund: boolean; mayTransfer: boolean;
}
export interface OrderSummary { code: string; status: string; eventTitle: string; eventId: number; ticketCount: number; totalCents: number; currency: string; paidAt: string | null; createdAt: string; organizer: string }

export interface PaymentIntentResponse { clientSecret: string; publishableKey: string; mode: 'test' | 'live'; amountCents: number; currency: string }

export interface ScanEvent { orgSlug: string; orgName: string; role: string; eventId: number; title: string; startsAt: string; when: string; timezone: string; venue: string | null; counts: { total: number; used: number } }
export interface ScanResult {
  result: 'valid' | 'already_used' | 'cancelled' | 'refunded' | 'transferred' | 'wrong_event' | 'wrong_day' | 'invalid' | 'manual' | 'override' | 'undo';
  ticket?: { id: number; code: string; attendeeName: string | null; ticketType: string; seatLabel: string | null; dayLabel: string | null; addons: string | null; checkedInAt: string | null; checkedInBy: string | null; orderCode: string; buyerEmail: string };
  ageRestriction?: number | null;
  counts: { total: number; used: number };
  message: string;
}

export interface SessionInfo { id: string; current: boolean; createdAt: string; lastSeenAt: string; kind: 'app' | 'browser'; device: string; ip: string | null }

// ---------------------------------------------------------------------------
// Management (organisers, staff, platform admins)
// ---------------------------------------------------------------------------
export interface OrgPerms { canRefund: boolean; canOverrideCheckin: boolean; canUndoCheckin: boolean; allEvents: boolean }
export interface ManageOrg {
  slug: string; name: string; role: OrgRole | 'super_admin'; status: string; logoUrl: string | null; perms: OrgPerms;
  overview: { events: number; upcoming: number; paidOrders: number; grossCents: number; ticketsSold: number; checkedIn: number } | null;
}
export interface ManageEventRow {
  id: number; slug: string; title: string; status: string; visibility: string; startsAt: string; when: string; timezone: string; venue: string | null;
  ticketsSold: number; capacity: number; checkedIn: number; grossCents: number | null; currency: string; imageUrl: string | null;
}
export interface ManageEventDetail {
  event: ManageEventRow; role: string;
  perms: OrgPerms & { canEdit: boolean; canChangeStatus: boolean };
  counts: { total: number; used: number };
  sales: { paidOrders: number; ticketsSold: number; grossCents: number; refundedCents: number; netCents: number; buyerFeesCents: number; absorbedFeesCents: number; taxCents: number; payoutCents: number; refundsCount: number; compTickets: number } | null;
  ticketTypes: { id: number; name: string; kind: string; priceCents: number | null; sold: number; quantity: number; held: number; hidden: boolean }[];
  recentScans: { id: number; result: string; reason: string | null; at: string; staff: string | null; code: string | null; attendee: string | null }[];
}
export interface ManageAttendee {
  ticketId: number; code: string; name: string | null; email: string | null; seatLabel: string | null; status: string; checkedInAt: string | null; checkedInBy: string | null;
  ticketType: string; dayLabel: string | null; orderCode: string; orderStatus: string; buyerEmail: string; buyerName: string | null; addons: string | null; transferred: boolean;
}
export interface ManageOrderRow { code: string; status: string; source: string; buyerEmail: string; buyerName: string | null; totalCents: number; refundedCents: number; currency: string; createdAt: string; eventTitle: string; eventId: number; ticketCount: number }
export interface ManageOrderDetail extends OrderDetail {
  buyerPhone: string | null; source: string; createdAt: string; paidAt: string | null;
  refunds: { id: number; amountCents: number; reason: string; kind: string; status: string; at: string; by: string | null }[];
  perms: { canRefund: boolean; canResend: boolean };
}
export interface AdminOverview {
  roles: PlatformRole[];
  overview: { orgs: number; upcomingEvents: number; orders30d: number; ticketsIssued: number; checkedIn: number; gross30d: number; fees30d: number; users: number; refunds30d: number };
  payments: { paid: number; gross: number; refunded: number; fees: number; disputesOpen: number; disputedCents: number };
  health: { dbOk: boolean; failedLogins24h: number; lockedUsers: number; queuedEmails: number; failedEmails: number; pendingHolds: number; disputesOpen: number; lastWebhookAt: string | null; webhooks24h: number };
  recentOrders: { code: string; buyerEmail: string; status: string; totalCents: number; currency: string; createdAt: string; eventTitle: string; orgName: string; orgSlug: string }[];
  activity: { id: number; action: string; actor: string | null; at: string; target: string | null }[];
}
export interface AdminUser { email: string; name: string; status: string; hasPassword: boolean; roles: string[]; orgCount: number; orderCount: number; lastLoginAt: string | null; createdAt: string }
export interface AdminOrg { slug: string; name: string; contactEmail: string; status: string; createdAt: string; members: number; events: number; orders: number; grossCents: number }

// ---------------------------------------------------------------------------
// Offline scanning (plan 8.2). Mirrors ScannerSnapshot / OfflineScan / SyncResult in src/lib/checkin/actions.ts.
// ---------------------------------------------------------------------------
export interface OfflineTicket {
  id: number; code: string;
  /** sha256 of the full signed QR payload (first 32 hex chars). The device never holds the secret or signature. */
  h: string;
  attendeeName: string | null; seatLabel: string | null; dayLabel: string | null; dateId: number | null; lastDateId: number | null;
  status: string; ticketType: string; orderCode: string; buyerEmail: string; buyerName: string | null; addons: string | null;
}
export interface ScannerSnapshot { eventId: number; generatedAt: string; expiresAt: string; activeDateId: number | null; ageRestriction: number | null; tickets: OfflineTicket[] }
export interface OfflineScan { ref: string; ticketId: number; kind: 'valid' | 'manual'; at: string }
export interface SyncResult { synced: number; conflicts: { ref: string; code: string; name: string | null; reason: string }[]; counts: { total: number; used: number } }
