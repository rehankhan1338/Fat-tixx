import 'server-only';
import { redirect } from 'next/navigation';
import { getSession, type CurrentSession, type PlatformRole } from './session';

/**
 * Authorization helpers for Server Components and Server Actions.
 * Every protected page AND every action calls one of these: rendering a page behind a check
 * is not a security boundary because actions can be invoked without the UI.
 */

export const ALL_PLATFORM_ROLES: PlatformRole[] = ['super_admin', 'support', 'finance'];

export async function requireSession(): Promise<CurrentSession> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/**
 * Page guard for the admin console (Fattixx-admin/), whose sign-in page is its homepage:
 * signed-out visitors and accounts without any platform role go there; staff lacking the specific role land on
 * the console dashboard with a notice.
 */
export async function requirePlatformStaff(allowed: PlatformRole[] = ALL_PLATFORM_ROLES): Promise<CurrentSession> {
  const session = await getSession();
  if (!session) redirect('/');
  if (!session.user.roles.length) redirect('/?denied=1');
  if (!session.user.roles.some((r) => allowed.includes(r))) redirect('/admin?denied=1');
  return session;
}

export async function requireRole(role: PlatformRole): Promise<CurrentSession> {
  return requirePlatformStaff([role]);
}

export async function requireSuperAdmin(): Promise<CurrentSession> {
  return requirePlatformStaff(['super_admin']);
}

/** Action guard: throws instead of redirecting so the caller gets a clean failure. */
export async function assertPlatformRole(allowed: PlatformRole[]): Promise<CurrentSession> {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');
  if (!session.user.roles.some((r) => allowed.includes(r))) throw new Error('Forbidden');
  return session;
}

export async function assertSuperAdmin(): Promise<CurrentSession> {
  return assertPlatformRole(['super_admin']);
}

export function hasPlatformRole(session: CurrentSession, ...roles: PlatformRole[]): boolean {
  return session.user.roles.some((r) => roles.includes(r));
}
