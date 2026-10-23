import 'server-only';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { approvedAdvertiser, type AdvertiserRow } from '@/lib/ads/advertisers';
import type { CurrentSession } from '@/lib/auth/session';

/** Advertiser portal pages: signed in, with an approved advertiser account; everyone else goes to /advertise. */
export async function requireAdvertiser(): Promise<{ session: CurrentSession; advertiser: AdvertiserRow }> {
  const session = await getSession();
  if (!session) redirect('/login?next=/advertiser');
  const advertiser = await approvedAdvertiser(session.user.id);
  if (!advertiser) redirect('/advertise');
  return { session, advertiser };
}
