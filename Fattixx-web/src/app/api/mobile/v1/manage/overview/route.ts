import { manageOverview } from '@/lib/mobile/manage';
import { handle, json, requireUser } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET (Bearer) → the organisations the user manages or works for, with sales and check-in totals. */
export const GET = handle(async () => json(await manageOverview(await requireUser())));
