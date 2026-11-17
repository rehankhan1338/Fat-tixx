import 'server-only';
import { query, type Row } from '../db';
import type { EventItem } from '../home/types';
import { getSocialUser } from './core';
import { friendsGoingCounts } from './queries';

/**
 * "For you" on the events page (11.10): upcoming public events from organizers the person follows, events their friends
 * are going to, their favorite categories (picked on the profile) and events in their city. Best matches first.
 */
export async function forYou(userId: number, events: EventItem[], limit = 8): Promise<{ items: EventItem[]; friends: Record<number, number>; reasons: Record<number, string> }> {
  if (!events.length) return { items: [], friends: {}, reasons: {} };
  const [me, followed, friends] = await Promise.all([
    getSocialUser(userId),
    query<Row & { slug: string }>(`SELECT o.slug FROM org_follows f JOIN organizations o ON o.id = f.organization_id WHERE f.user_id = ?`, [userId]),
    friendsGoingCounts(userId, events.map((e) => e.id)),
  ]);
  const orgs = new Set(followed.map((f) => f.slug));
  const cats = new Set((me?.favorite_categories ?? '').split(',').filter(Boolean));
  const city = (me?.city ?? '').trim().toLowerCase().split(',')[0];
  const reasons: Record<number, string> = {};
  const scored = events.map((e) => {
    let score = 0;
    const why: string[] = [];
    const n = friends[e.id] ?? 0;
    if (n) { score += 3 + Math.min(n, 5); why.push(`${n} ${n === 1 ? 'friend' : 'friends'} going`); }
    if (orgs.has(e.organizerId)) { score += 4; why.push(`You follow ${e.organizerName}`); }
    if (cats.has(e.category)) { score += 1; if (!why.length) why.push(e.category); }
    if (city && e.city.toLowerCase().startsWith(city)) { score += 1; if (!why.length) why.push(`In ${e.city.split(',')[0]}`); }
    if (why.length) reasons[e.id] = why[0];
    return { e, score };
  });
  const items = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.e.date.localeCompare(b.e.date)).slice(0, limit).map((s) => s.e);
  return { items, friends, reasons };
}
