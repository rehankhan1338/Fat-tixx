/*
 * Email marketing audiences (Fattixx Pro, plan 5.7.2). A segment narrows the organization's subscribed contacts by what
 * they bought. Rules are stored as JSON on marketing_segments and turned into a parameterised SQL condition on
 * `marketing_contacts c`; every value goes through a placeholder.
 */

export type SegmentRules = {
  /** bought tickets to at least one of these events */
  eventIds?: number[];
  /** and none to these (e.g. leave out people who already have tickets to the event being promoted) */
  excludeEventIds?: number[];
  /** at least this many orders with the organization */
  minOrders?: number;
  /** last order within the last N days (recent buyers) */
  boughtWithinDays?: number;
  /** last order more than N days ago (lapsed buyers) */
  notBoughtWithinDays?: number;
  /** spent at least this much in total (cents, after refunds) */
  minSpentCents?: number;
  /** went to an event in one of these cities (venue city) */
  cities?: string[];
};

const posInt = (v: unknown, max: number): number | undefined => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= max ? n : undefined;
};
const ids = (v: unknown): number[] | undefined => {
  const list = (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
  return list.length ? [...new Set(list)] : undefined;
};

/** Accept rules from a form or the database, dropping anything malformed. */
export function cleanRules(raw: unknown): SegmentRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cities = (Array.isArray(r.cities) ? r.cities : []).map((c) => String(c).trim().slice(0, 120)).filter(Boolean).slice(0, 30);
  const out: SegmentRules = {
    eventIds: ids(r.eventIds), excludeEventIds: ids(r.excludeEventIds), minOrders: posInt(r.minOrders, 10_000),
    boughtWithinDays: posInt(r.boughtWithinDays, 3650), notBoughtWithinDays: posInt(r.notBoughtWithinDays, 3650),
    minSpentCents: posInt(r.minSpentCents, 100_000_000), cities: cities.length ? [...new Set(cities)] : undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as SegmentRules;
}

export function parseRules(json: string | object | null | undefined): SegmentRules {
  if (!json) return {};
  if (typeof json === 'object') return cleanRules(json);
  try { return cleanRules(JSON.parse(json)); } catch { return {}; }
}

const PAID = `o.status IN ('paid','partially_refunded')`;
const marks = (n: number) => Array(n).fill('?').join(',');

/**
 * SQL condition (to AND onto `c.organization_id = ? AND <subscribed>`) and its parameters. Order lookups match the
 * contact by email within the same organization.
 */
export function segmentWhere(rules: SegmentRules): { sql: string; params: (string | number)[] } {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  const bought = (extra: string) => `EXISTS (SELECT 1 FROM orders o WHERE o.organization_id = c.organization_id AND o.buyer_email = c.email AND ${PAID} AND ${extra})`;
  if (rules.eventIds?.length) { parts.push(bought(`o.event_id IN (${marks(rules.eventIds.length)})`)); params.push(...rules.eventIds); }
  if (rules.excludeEventIds?.length) { parts.push(`NOT ${bought(`o.event_id IN (${marks(rules.excludeEventIds.length)})`)}`); params.push(...rules.excludeEventIds); }
  if (rules.minOrders) { parts.push('c.orders_count >= ?'); params.push(rules.minOrders); }
  if (rules.boughtWithinDays) { parts.push('c.last_order_at >= NOW() - INTERVAL ? DAY'); params.push(rules.boughtWithinDays); }
  if (rules.notBoughtWithinDays) { parts.push('c.last_order_at < NOW() - INTERVAL ? DAY'); params.push(rules.notBoughtWithinDays); }
  if (rules.minSpentCents) { parts.push('c.spent_cents >= ?'); params.push(rules.minSpentCents); }
  if (rules.cities?.length) {
    parts.push(`EXISTS (SELECT 1 FROM orders o JOIN events e ON e.id = o.event_id JOIN venues v ON v.id = e.venue_id
      WHERE o.organization_id = c.organization_id AND o.buyer_email = c.email AND ${PAID} AND v.city IN (${marks(rules.cities.length)}))`);
    params.push(...rules.cities);
  }
  return { sql: parts.length ? parts.map((p) => `(${p})`).join(' AND ') : '1=1', params };
}

/** Plain-language summary, e.g. "Bought tickets to 2 events · 2+ orders · bought in the last 90 days". */
export function describeRules(rules: SegmentRules, eventTitle: (id: number) => string | undefined = () => undefined): string {
  const list = (a: number[]) => (a.length === 1 && eventTitle(a[0]) ? `“${eventTitle(a[0])}”` : `${a.length} events`);
  const out: string[] = [];
  if (rules.eventIds?.length) out.push(`Bought tickets to ${list(rules.eventIds)}`);
  if (rules.excludeEventIds?.length) out.push(`No tickets to ${list(rules.excludeEventIds)}`);
  if (rules.minOrders) out.push(`${rules.minOrders}+ orders`);
  if (rules.boughtWithinDays) out.push(`Bought in the last ${rules.boughtWithinDays} days`);
  if (rules.notBoughtWithinDays) out.push(`No order in the last ${rules.notBoughtWithinDays} days`);
  if (rules.minSpentCents) out.push(`Spent $${(rules.minSpentCents / 100).toFixed(0)}+`);
  if (rules.cities?.length) out.push(`Went to events in ${rules.cities.join(', ')}`);
  return out.length ? out.join(' · ') : 'Everyone subscribed';
}
