import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { AdminOrg, AdminOverview, AdminUser, EventDetail, EventList, ManageAttendee, ManageEventDetail, ManageEventRow, ManageOrderDetail, ManageOrderRow, ManageOrg, OrderDetail, OrderSummary, PlatformConfig, ScanEvent, SessionInfo } from './types';

/**
 * Data hooks. React Query gives instant back-navigation (cached), background refresh and retries,
 * which is most of what makes the app feel fast. Keys starting with "me:" are dropped on sign-out.
 */
export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api<PlatformConfig>('/config', { anonymous: true }), staleTime: 10 * 60_000 });
}

export function useEvents() {
  return useQuery({ queryKey: ['events'], queryFn: () => api<EventList>('/events', { anonymous: true }), staleTime: 60_000 });
}

/** Event page. `queueToken` is the caller's waiting-room place, sent as a header so the server knows they were admitted. */
export function useEvent(slug: string | undefined, accessCode = '', key: string | null = null, queueToken: string | null = null) {
  const qs = new URLSearchParams();
  if (accessCode) qs.set('code', accessCode);
  if (key) qs.set('key', key);
  const suffix = qs.toString() ? `?${qs}` : '';
  return useQuery({
    queryKey: ['event', slug, accessCode, key, queueToken ?? ''],
    queryFn: () => api<EventDetail>(`/events/${encodeURIComponent(slug!)}${suffix}`, { headers: queueToken ? { 'X-Fx-Queue-Token': queueToken } : undefined }),
    enabled: !!slug,
    staleTime: 20_000,
  });
}

export function useOrder(code: string | undefined, t: string | null | undefined, opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: ['order', code, t ?? ''],
    queryFn: () => api<OrderDetail>(`/orders/${encodeURIComponent(code!)}${t ? `?t=${encodeURIComponent(t)}` : ''}`),
    enabled: !!code,
    staleTime: 15_000,
    refetchInterval: opts.poll ? 5_000 : false,
  });
}

export function useMyOrders(enabled: boolean) {
  return useQuery({ queryKey: ['me:orders'], queryFn: () => api<{ orders: OrderSummary[]; emailVerified: boolean }>('/account/orders'), enabled, staleTime: 30_000 });
}

export function useScanEvents(enabled: boolean) {
  return useQuery({ queryKey: ['me:scan-events'], queryFn: () => api<{ events: ScanEvent[] }>('/scan/events'), enabled, staleTime: 30_000 });
}

export function useSessions(enabled: boolean) {
  return useQuery({ queryKey: ['me:sessions'], queryFn: () => api<{ sessions: SessionInfo[] }>('/auth/sessions'), enabled, staleTime: 10_000 });
}

// ---------------------------------------------------------------------------
// Management (organisers, staff, platform admins). All keys start with "me:" so they clear on sign-out.
// ---------------------------------------------------------------------------
export function useManageOverview(enabled: boolean) {
  return useQuery({ queryKey: ['me:manage'], queryFn: () => api<{ orgs: ManageOrg[] }>('/manage/overview'), enabled, staleTime: 30_000 });
}
export function useManageEvents(org: string | undefined, filter: 'upcoming' | 'past' | 'all') {
  return useQuery({ queryKey: ['me:manage', org, 'events', filter], queryFn: () => api<{ org: { slug: string; name: string; role: string }; events: ManageEventRow[] }>(`/manage/${org}/events?filter=${filter}`), enabled: !!org, staleTime: 20_000 });
}
export function useManageEvent(org: string | undefined, eventId: string | undefined) {
  return useQuery({ queryKey: ['me:manage', org, 'event', eventId], queryFn: () => api<ManageEventDetail>(`/manage/${org}/events/${eventId}`), enabled: !!org && !!eventId, staleTime: 10_000 });
}
export function useManageAttendees(org: string | undefined, eventId: string | undefined, q: string) {
  return useQuery({ queryKey: ['me:manage', org, 'attendees', eventId, q], queryFn: () => api<{ attendees: ManageAttendee[]; total: number }>(`/manage/${org}/events/${eventId}/attendees?q=${encodeURIComponent(q)}`), enabled: !!org && !!eventId, staleTime: 5_000, placeholderData: (prev) => prev });
}
export function useManageOrders(org: string | undefined, q: string, eventId?: string) {
  return useQuery({ queryKey: ['me:manage', org, 'orders', q, eventId ?? ''], queryFn: () => api<{ orders: ManageOrderRow[] }>(`/manage/${org}/orders?q=${encodeURIComponent(q)}${eventId ? `&eventId=${eventId}` : ''}`), enabled: !!org, staleTime: 10_000, placeholderData: (prev) => prev });
}
export function useManageOrder(org: string | undefined, code: string | undefined) {
  return useQuery({ queryKey: ['me:manage', org, 'order', code], queryFn: () => api<ManageOrderDetail>(`/manage/${org}/orders/${code}`), enabled: !!org && !!code, staleTime: 10_000 });
}
export function useAdminOverview(enabled: boolean) {
  return useQuery({ queryKey: ['me:admin'], queryFn: () => api<AdminOverview>('/admin/overview'), enabled, staleTime: 30_000 });
}
export function useAdminUsers(enabled: boolean, q: string) {
  return useQuery({ queryKey: ['me:admin', 'users', q], queryFn: () => api<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`), enabled, staleTime: 15_000, placeholderData: (prev) => prev });
}
export function useAdminOrgs(enabled: boolean, q: string) {
  return useQuery({ queryKey: ['me:admin', 'orgs', q], queryFn: () => api<{ organizations: AdminOrg[] }>(`/admin/organizations?q=${encodeURIComponent(q)}`), enabled, staleTime: 15_000, placeholderData: (prev) => prev });
}
