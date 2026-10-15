import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Attendee, EventDetail, PlatformConfig, ScanEvent, SessionInfo } from './types';

/**
 * Data hooks. React Query gives instant back-navigation (cached), background refresh and retries,
 * which is most of what makes the app feel fast. Keys starting with "me:" are dropped on sign-out.
 */
export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api<PlatformConfig>('/config', { anonymous: true }), staleTime: 10 * 60_000 });
}

export function useSessions(enabled: boolean) {
  return useQuery({ queryKey: ['me:sessions'], queryFn: () => api<{ sessions: SessionInfo[] }>('/auth/sessions'), enabled, staleTime: 10_000 });
}

/** Events the signed-in member may check people in for, across every organisation they belong to (server-filtered by role and assignment). */
export function useScanEvents(enabled: boolean, filter: 'upcoming' | 'past' = 'upcoming') {
  return useQuery({ queryKey: ['me:scan-events', filter], queryFn: () => api<{ events: ScanEvent[] }>(`/scan/events?filter=${filter}`), enabled, staleTime: 30_000 });
}

/** One event's live check-in picture. Polled while the screen is open so the counts stay live. */
export function useEventDetail(org: string | undefined, eventId: string | undefined) {
  return useQuery({ queryKey: ['me:event', org, eventId], queryFn: () => api<EventDetail>(`/manage/${org}/events/${eventId}`), enabled: !!org && !!eventId, staleTime: 10_000, refetchInterval: 30_000 });
}

/** The door list: every ticket of the event, filtered by a search string on the server. */
export function useAttendees(org: string | undefined, eventId: string | undefined, q: string) {
  return useQuery({ queryKey: ['me:event', org, eventId, 'attendees', q], queryFn: () => api<{ attendees: Attendee[]; total: number }>(`/manage/${org}/events/${eventId}/attendees?q=${encodeURIComponent(q)}`), enabled: !!org && !!eventId, staleTime: 5_000, placeholderData: (prev) => prev });
}
