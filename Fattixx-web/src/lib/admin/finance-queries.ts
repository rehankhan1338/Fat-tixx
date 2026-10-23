import 'server-only';
import { query, queryOne, type Row } from '../db';

/**
 * Finance views for the platform panel: what is owed to organizers, payouts made, disputes,
 * payments, and operational health. Payout due per event = gross − refunds − absorbed fees − already paid, counting only
 * orders Fattixx settles by hand: orders paid through Stripe Connect were already split with the payment.
 */
export type OwedRow = Row & {
  event_id: number; event_title: string; event_slug: string; starts_at: Date; status: string; currency: string;
  org_id: number; org_name: string; org_slug: string; legal_name: string | null;
  gross_cents: number; refunded_cents: number; absorbed_cents: number; paid_orders: number; tickets: number;
  paid_out_cents: number; approved_cents: number; last_payout_status: string | null; connect_cents: number;
};

export async function listSettlements(): Promise<OwedRow[]> {
  return query<OwedRow>(
    `SELECT e.id AS event_id, e.title AS event_title, e.slug AS event_slug, e.starts_at, e.status, e.currency,
            g.id AS org_id, g.name AS org_name, g.slug AS org_slug, g.legal_name,
            COALESCE(SUM(CASE WHEN o.status IN ('paid','partially_refunded','refunded') AND o.connect_account_id IS NULL THEN o.subtotal_cents END),0) AS gross_cents,
            COALESCE(SUM(CASE WHEN o.status IN ('paid','partially_refunded','refunded') AND o.connect_account_id IS NULL THEN o.refunded_cents END),0) AS refunded_cents,
            COALESCE(SUM(CASE WHEN o.status IN ('paid','partially_refunded','refunded') AND o.connect_account_id IS NULL THEN o.absorbed_fee_cents END),0) AS absorbed_cents,
            COALESCE(SUM(CASE WHEN o.status IN ('paid','partially_refunded','refunded') AND o.connect_account_id IS NOT NULL THEN o.connect_transfer_cents END),0) AS connect_cents,
            COUNT(DISTINCT CASE WHEN o.status IN ('paid','partially_refunded') THEN o.id END) AS paid_orders,
            (SELECT COUNT(*) FROM tickets k WHERE k.event_id = e.id AND k.status IN ('valid','used')) AS tickets,
            (SELECT COALESCE(SUM(p.amount_cents),0) FROM payouts p WHERE p.event_id = e.id AND p.status = 'paid') AS paid_out_cents,
            (SELECT COALESCE(SUM(p.amount_cents),0) FROM payouts p WHERE p.event_id = e.id AND p.status = 'approved') AS approved_cents,
            (SELECT p.status FROM payouts p WHERE p.event_id = e.id AND p.status <> 'void' ORDER BY p.id DESC LIMIT 1) AS last_payout_status
       FROM events e JOIN organizations g ON g.id = e.organization_id LEFT JOIN orders o ON o.event_id = e.id
      WHERE e.status <> 'draft'
      GROUP BY e.id HAVING gross_cents > 0 OR paid_out_cents > 0 OR approved_cents > 0
      ORDER BY e.starts_at DESC`,
  );
}

export function dueCents(r: OwedRow): number {
  return Math.max(0, Number(r.gross_cents) - Number(r.refunded_cents) - Number(r.absorbed_cents) - Number(r.paid_out_cents) - Number(r.approved_cents));
}

export type PayoutRow = Row & { id: number; organization_id: number; org_name: string; org_slug: string; event_id: number | null; event_title: string | null; amount_cents: number; currency: string; status: string; method: string | null; reference: string | null; notes: string | null; approved_by_name: string | null; approved_at: Date; paid_by_name: string | null; paid_at: Date | null };

export async function listPayouts(limit = 50, offset = 0): Promise<PayoutRow[]> {
  return query<PayoutRow>(
    `SELECT p.*, g.name AS org_name, g.slug AS org_slug, e.title AS event_title, a.name AS approved_by_name, b.name AS paid_by_name
       FROM payouts p JOIN organizations g ON g.id = p.organization_id LEFT JOIN events e ON e.id = p.event_id
       LEFT JOIN users a ON a.id = p.approved_by LEFT JOIN users b ON b.id = p.paid_by
      ORDER BY p.id DESC LIMIT ? OFFSET ?`, [limit, offset],
  );
}

export async function countPayouts(): Promise<number> {
  const r = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM payouts`);
  return Number(r?.n ?? 0);
}

/** Totals across every payout, independent of the paginated history list. */
export async function payoutTotals(): Promise<{ approvedCents: number; approvedCount: number; paidCents: number; paidCount: number }> {
  const r = await queryOne<Row & { approved_cents: number; approved_count: number; paid_cents: number; paid_count: number }>(
    `SELECT COALESCE(SUM(CASE WHEN status = 'approved' THEN amount_cents END),0) AS approved_cents,
            COUNT(CASE WHEN status = 'approved' THEN 1 END) AS approved_count,
            COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_cents END),0) AS paid_cents,
            COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid_count
       FROM payouts`,
  );
  return { approvedCents: Number(r?.approved_cents ?? 0), approvedCount: Number(r?.approved_count ?? 0), paidCents: Number(r?.paid_cents ?? 0), paidCount: Number(r?.paid_count ?? 0) };
}

export type DisputeRow = Row & { id: number; order_id: number; order_code: string; buyer_email: string; event_title: string; org_name: string; org_slug: string; stripe_dispute_id: string; amount_cents: number; fee_cents: number; reason: string | null; status: string; notes: string | null; evidence_due_at: Date | null; opened_at: Date; closed_at: Date | null; currency: string; checkins: number };

export async function listDisputes(limit = 50, offset = 0): Promise<DisputeRow[]> {
  return query<DisputeRow>(
    `SELECT d.*, o.code AS order_code, o.buyer_email, o.currency, e.title AS event_title, g.name AS org_name, g.slug AS org_slug,
            (SELECT COUNT(*) FROM tickets k WHERE k.order_id = o.id AND k.status = 'used') AS checkins
       FROM disputes d JOIN orders o ON o.id = d.order_id JOIN events e ON e.id = o.event_id JOIN organizations g ON g.id = o.organization_id
      ORDER BY (d.closed_at IS NULL) DESC, d.opened_at DESC LIMIT ? OFFSET ?`, [limit, offset],
  );
}

export async function countDisputes(): Promise<number> {
  const r = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM disputes`);
  return Number(r?.n ?? 0);
}

/** Open dispute count and amount at risk, independent of the paginated list. */
export async function openDisputeTotals(): Promise<{ count: number; cents: number }> {
  const r = await queryOne<Row & { n: number; cents: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS cents FROM disputes WHERE closed_at IS NULL`);
  return { count: Number(r?.n ?? 0), cents: Number(r?.cents ?? 0) };
}

export type PaymentRow = Row & { id: number; code: string; buyer_email: string; status: string; total_cents: number; refunded_cents: number; currency: string; paid_at: Date | null; created_at: Date; stripe_payment_intent_id: string | null; event_title: string; org_name: string; org_slug: string; source: string };

export async function listPayments(search = '', limit = 50, offset = 0): Promise<PaymentRow[]> {
  const like = `%${search}%`;
  return query<PaymentRow>(
    `SELECT o.id, o.code, o.buyer_email, o.status, o.total_cents, o.refunded_cents, o.currency, o.paid_at, o.created_at, o.stripe_payment_intent_id, o.source, e.title AS event_title, g.name AS org_name, g.slug AS org_slug
       FROM orders o JOIN events e ON e.id = o.event_id JOIN organizations g ON g.id = o.organization_id
      WHERE o.total_cents > 0 AND o.status <> 'expired' AND (? = '' OR o.code LIKE ? OR o.buyer_email LIKE ? OR o.stripe_payment_intent_id LIKE ?)
      ORDER BY o.id DESC LIMIT ? OFFSET ?`, [search, like, like, like, limit, offset],
  );
}

export async function countPayments(search = ''): Promise<number> {
  const like = `%${search}%`;
  const r = await queryOne<Row & { n: number }>(
    `SELECT COUNT(*) AS n FROM orders o
      WHERE o.total_cents > 0 AND o.status <> 'expired' AND (? = '' OR o.code LIKE ? OR o.buyer_email LIKE ? OR o.stripe_payment_intent_id LIKE ?)`,
    [search, like, like, like],
  );
  return Number(r?.n ?? 0);
}

export type ReconRow = Row & { id: number; mode: string; range_start: Date; range_end: Date; stripe_count: number; stripe_cents: number; db_count: number; db_cents: number; discrepancies: string | null; run_by_name: string | null; created_at: Date };

export async function listReconciliations(limit = 20): Promise<ReconRow[]> {
  return query<ReconRow>(`SELECT r.*, u.name AS run_by_name FROM reconciliation_runs r LEFT JOIN users u ON u.id = r.run_by ORDER BY r.id DESC LIMIT ?`, [limit]);
}

export async function paymentsSummary() {
  const r = await queryOne<Row & { paid: number; gross: number; refunded: number; fees: number; disputes_open: number; disputed_cents: number }>(
    `SELECT (SELECT COUNT(*) FROM orders WHERE status IN ('paid','partially_refunded') AND total_cents > 0) AS paid,
            (SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE status IN ('paid','partially_refunded','refunded') AND total_cents > 0) AS gross,
            (SELECT COALESCE(SUM(refunded_cents),0) FROM orders) AS refunded,
            (SELECT COALESCE(SUM(platform_fee_cents + absorbed_fee_cents),0) FROM orders WHERE status IN ('paid','partially_refunded')) AS fees,
            (SELECT COUNT(*) FROM disputes WHERE closed_at IS NULL) AS disputes_open,
            (SELECT COALESCE(SUM(amount_cents),0) FROM disputes WHERE closed_at IS NULL) AS disputed_cents`,
  );
  const n = (v: unknown) => Number(v ?? 0);
  return { paid: n(r?.paid), gross: n(r?.gross), refunded: n(r?.refunded), fees: n(r?.fees), disputesOpen: n(r?.disputes_open), disputedCents: n(r?.disputed_cents) };
}

export type LockedUserRow = Row & { id: number; email: string; name: string; failed_login_count: number; locked_until: Date | null; status: string };

/** Operational health for the Monitoring page. */
export async function monitoringSnapshot() {
  const [locked, failedLogins24h, throttledIps, failedEmails, queuedEmails, lastWebhook, webhooks24h, pendingHolds, expiredHolds24h, overrides24h, disputesOpen, dbOk, cardPayments7d] = await Promise.all([
    query<LockedUserRow>(`SELECT id, email, name, failed_login_count, locked_until, status FROM users WHERE locked_until > NOW() OR status <> 'active' ORDER BY locked_until DESC LIMIT 50`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM login_attempts WHERE success = 0 AND created_at > NOW() - INTERVAL 1 DAY`),
    query<Row & { ip: string; n: number }>(`SELECT ip, COUNT(*) AS n FROM login_attempts WHERE success = 0 AND created_at > NOW() - INTERVAL 1 DAY GROUP BY ip HAVING n >= 10 ORDER BY n DESC LIMIT 20`),
    query<Row & { id: number; to_email: string; subject: string; error: string | null; created_at: Date }>(`SELECT id, to_email, subject, error, created_at FROM email_outbox WHERE status = 'failed' ORDER BY id DESC LIMIT 20`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'queued'`),
    queryOne<Row & { at: Date | null; type: string | null }>(`SELECT received_at AS at, type FROM stripe_events ORDER BY received_at DESC LIMIT 1`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM stripe_events WHERE received_at > NOW() - INTERVAL 1 DAY`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE status = 'pending' AND hold_expires_at > NOW()`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE status = 'expired' AND created_at > NOW() - INTERVAL 1 DAY`),
    query<Row & { id: number; result: string; reason: string | null; created_at: Date; staff: string | null; code: string | null; event_title: string }>(
      `SELECT c.id, c.result, c.reason, c.created_at, u.name AS staff, k.code, e.title AS event_title FROM checkin_log c JOIN events e ON e.id = c.event_id LEFT JOIN users u ON u.id = c.staff_user_id LEFT JOIN tickets k ON k.id = c.ticket_id
        WHERE c.result IN ('override','undo') AND c.created_at > NOW() - INTERVAL 7 DAY ORDER BY c.id DESC LIMIT 20`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM disputes WHERE closed_at IS NULL`),
    queryOne<Row & { ok: number }>(`SELECT 1 AS ok`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE stripe_payment_intent_id IS NOT NULL AND paid_at > NOW() - INTERVAL 7 DAY`),
  ]);
  const n = (r: (Row & { n: number }) | null) => Number(r?.n ?? 0);
  return {
    locked, failedLogins24h: n(failedLogins24h), throttledIps, failedEmails, queuedEmails: n(queuedEmails),
    lastWebhookAt: lastWebhook?.at ? new Date(lastWebhook.at) : null, lastWebhookType: lastWebhook?.type ?? null, webhooks24h: n(webhooks24h), cardPayments7d: n(cardPayments7d),
    pendingHolds: n(pendingHolds), expiredHolds24h: n(expiredHolds24h), overrides: overrides24h, disputesOpen: n(disputesOpen), dbOk: Number(dbOk?.ok) === 1,
  };
}
