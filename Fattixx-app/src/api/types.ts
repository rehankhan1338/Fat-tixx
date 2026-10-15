/** Shapes returned by the backend's /api/mobile/v1 routes (see src/lib/mobile/* in the website repo). */

export type PlatformRole = 'super_admin' | 'support' | 'finance';
export type OrgRole = 'org_admin' | 'organizer' | 'staff';

export interface MobileUser { id: string; email: string; name: string; emailVerified: boolean; roles: PlatformRole[] }
export interface MobileMembership { slug: string; name: string; role: OrgRole; logoUrl: string | null; suspended: boolean }
export interface Account { user: MobileUser; memberships: MobileMembership[]; canScan: boolean }

export interface AuthResponse { token: string; expiresAt: string; account: Account; message?: string }

export interface PlatformConfig {
  name: string; color: string; logoUrl: string | null; supportEmail: string; appUrl: string;
  legal: { terms: string; privacy: string; refunds: string; ticketing: string };
}

export interface SessionInfo { id: string; current: boolean; createdAt: string; lastSeenAt: string; kind: 'app' | 'browser'; device: string; ip: string | null }

// ---------------------------------------------------------------------------
// Check-in (the whole app). The server decides which events a member sees and what they may do.
// ---------------------------------------------------------------------------
export interface ScanEvent { orgSlug: string; orgName: string; role: string; eventId: number; title: string; startsAt: string; when: string; timezone: string; venue: string | null; counts: { total: number; used: number } }

export interface ScanResult {
  result: 'valid' | 'already_used' | 'cancelled' | 'refunded' | 'transferred' | 'wrong_event' | 'wrong_day' | 'invalid' | 'manual' | 'override' | 'undo';
  ticket?: { id: number; code: string; attendeeName: string | null; ticketType: string; seatLabel: string | null; dayLabel: string | null; addons: string | null; checkedInAt: string | null; checkedInBy: string | null; orderCode: string; buyerEmail: string };
  ageRestriction?: number | null;
  counts: { total: number; used: number };
  message: string;
}

export interface EventRow {
  id: number; slug: string; title: string; status: string; visibility: string; startsAt: string; when: string; timezone: string; venue: string | null;
  ticketsSold: number; capacity: number; checkedIn: number;
}
export interface EventDetail {
  event: EventRow; role: string;
  /** Override and undo are granted per member by the Organization Admin; admins always have both. */
  perms: { canOverrideCheckin: boolean; canUndoCheckin: boolean };
  counts: { total: number; used: number };
  ticketTypes: { id: number; name: string; kind: string; sold: number; quantity: number; held: number; hidden: boolean }[];
  recentScans: { id: number; result: string; reason: string | null; at: string; staff: string | null; code: string | null; attendee: string | null }[];
}
export interface Attendee {
  ticketId: number; code: string; name: string | null; email: string | null; seatLabel: string | null; status: string; checkedInAt: string | null; checkedInBy: string | null;
  ticketType: string; dayLabel: string | null; orderCode: string; orderStatus: string; buyerEmail: string; buyerName: string | null; addons: string | null; transferred: boolean;
}

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
