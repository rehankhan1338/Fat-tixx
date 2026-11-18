import 'server-only';
import { listPublicEventsByIds as rows } from '../events/queries';
import { toEventItems } from '../home/data';
import type { EventItem } from '../home/types';

/** Public events by id, mapped for event tiles (attendee profiles, "For you"). */
export async function listPublicEventsByIds(ids: number[]): Promise<EventItem[]> {
  return toEventItems(await rows(ids));
}
