import { router } from 'expo-router';

/**
 * Open a page of the Fat Tixx website inside the app (organiser dashboard, admin panel, settings forms).
 * The web screen signs the user in automatically through /app-login, so every tool the website has is
 * available to every role without typing a password again.
 */
export function openWeb(path: string, title?: string) {
  router.push({ pathname: '/web', params: title ? { path, title } : { path } });
}

/** Website paths of the organiser dashboard sections, mirrored from src/app/org/[slug]/layout.tsx. */
export function orgWebPaths(slug: string) {
  const base = `/org/${slug}`;
  return {
    overview: base, events: `${base}/events`, newEvent: `${base}/events/new`, venues: `${base}/venues`, orders: `${base}/orders`, analytics: `${base}/analytics`,
    marketing: `${base}/marketing`, team: `${base}/team`, settings: `${base}/settings`, scan: `${base}/scan`,
    event: (id: number) => `${base}/events/${id}`, doorList: (id: number) => `${base}/events/${id}/door-list`, settlement: (id: number) => `${base}/events/${id}/settlement`,
    order: (code: string) => `${base}/orders/${code}`,
  };
}

/** Admin panel sections, mirrored from src/components/admin-shell.tsx. */
export const ADMIN_WEB_SECTIONS: { label: string; path: string; roles?: ('super_admin' | 'support' | 'finance')[] }[] = [
  { label: 'Organizations', path: '/admin/organizations' },
  { label: 'Events', path: '/admin/events' },
  { label: 'Orders & tickets', path: '/admin/orders' },
  { label: 'Users', path: '/admin/users', roles: ['super_admin', 'support'] },
  { label: 'Organizer applications', path: '/admin/applications', roles: ['super_admin', 'support'] },
  { label: 'Payments & Stripe', path: '/admin/payments' },
  { label: 'Payouts', path: '/admin/payouts' },
  { label: 'Disputes', path: '/admin/disputes' },
  { label: 'Ads & sponsors', path: '/admin/ads', roles: ['super_admin'] },
  { label: 'Fees & settings', path: '/admin/settings', roles: ['super_admin', 'finance'] },
  { label: 'Emails', path: '/admin/emails', roles: ['super_admin', 'support'] },
  { label: 'Monitoring', path: '/admin/monitoring', roles: ['super_admin'] },
  { label: 'Audit log', path: '/admin/audit', roles: ['super_admin'] },
  { label: 'Security', path: '/admin/security' },
];
