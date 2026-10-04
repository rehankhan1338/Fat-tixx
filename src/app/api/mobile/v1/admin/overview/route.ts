import { assertPlatformRole, ALL_PLATFORM_ROLES } from '@/lib/auth/guard';
import { listAudit, platformOverview, recentOrders } from '@/lib/admin/queries';
import { monitoringSnapshot, paymentsSummary } from '@/lib/admin/finance-queries';
import { handle, json, requireUser } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET (Bearer, platform staff) → the admin dashboard numbers, recent orders and activity, health signals. */
export const GET = handle(async () => {
  await requireUser();
  const session = await assertPlatformRole(ALL_PLATFORM_ROLES);
  const [overview, orders, audit, payments, health] = await Promise.all([platformOverview(), recentOrders(8), listAudit(12), paymentsSummary(), monitoringSnapshot()]);
  return json({
    roles: session.user.roles,
    overview,
    payments,
    health: { dbOk: health.dbOk, failedLogins24h: health.failedLogins24h, lockedUsers: health.locked.length, queuedEmails: health.queuedEmails, failedEmails: health.failedEmails.length, pendingHolds: health.pendingHolds, disputesOpen: health.disputesOpen, lastWebhookAt: health.lastWebhookAt?.toISOString() ?? null, webhooks24h: health.webhooks24h },
    recentOrders: orders.map((r) => ({ code: r.code, buyerEmail: r.buyer_email, status: r.status, totalCents: Number(r.total_cents), currency: r.currency, createdAt: new Date(r.created_at).toISOString(), eventTitle: r.event_title, orgName: r.org_name, orgSlug: r.org_slug })),
    activity: audit.map((a) => ({ id: Number(a.id), action: a.action, actor: a.actor_email, at: new Date(a.created_at).toISOString(), target: a.target_type ? `${a.target_type} ${a.target_id ?? ''}`.trim() : null })),
  });
});
