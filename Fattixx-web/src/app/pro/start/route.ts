import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { listMemberships } from '@/lib/authz';

/**
 * "Get Fattixx Pro" on /pro. An Organization Admin goes to their organization's Pro page to subscribe (the first one
 * they administer; with several, the dashboard lists them). Someone without an organization applies to sell first,
 * with Pro noted on the application; someone signed out signs in and comes back here.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  const session = await getSession();
  if (!session) return to(`/login?next=${encodeURIComponent('/pro/start')}`);
  const admin = (await listMemberships(session.user.id)).filter((m) => m.role === 'org_admin');
  if (admin.length === 1) return to(`/org/${admin[0].slug}/pro`);
  if (admin.length > 1) return to('/dashboard?pro=1');
  return to('/sell?plan=pro');
}
