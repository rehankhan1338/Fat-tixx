import { mobileEventList } from '@/lib/mobile/events';
import { handle, json } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET → published, public, upcoming events (the same list the homepage shows). */
export const GET = handle(async () => json(await mobileEventList()));
