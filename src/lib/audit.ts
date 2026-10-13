import 'server-only';
import { execute } from './db';
import { clientIp, userAgent } from './request';

/** Dotted action names: <area>.<object>.<verb>. Kept as a string union so typos fail typecheck. */
export type AuditAction =
  | 'auth.login.success' | 'auth.login.failed' | 'auth.login.locked' | 'auth.login.throttled_ip'
  | 'auth.session.created' | 'auth.session.revoked' | 'auth.session.revoked_all' | 'auth.logout'
  | 'auth.password.rehashed' | 'auth.password.reset_requested' | 'auth.password.set' | 'auth.register'
  | 'user.created' | 'user.invited' | 'user.role.granted' | 'user.role.revoked' | 'user.status.changed' | 'user.updated' | 'user.deleted'
  | 'org.created' | 'org.updated' | 'org.status.changed' | 'org.deleted' | 'org.member.added' | 'org.member.updated' | 'org.member.removed'
  | 'order.deleted' | 'ticket.voided' | 'ticket.transferred'
  | 'venue.created' | 'venue.updated' | 'venue.deleted'
  | 'event.created' | 'event.updated' | 'event.published' | 'event.unpublished' | 'event.cancelled' | 'event.postponed' | 'event.deleted'
  | 'event.member.assigned' | 'event.member.unassigned' | 'event.duplicated' | 'event.series_created' | 'event.private_key_rotated'
  | 'event_date.created' | 'event_date.updated' | 'event_date.deleted'
  | 'ticket_type.created' | 'ticket_type.updated' | 'ticket_type.deleted'
  | 'addon.created' | 'addon.updated' | 'addon.deleted'
  | 'question.created' | 'question.updated' | 'question.deleted'
  | 'waitlist.joined' | 'waitlist.left' | 'waitlist.notified' | 'waitlist.removed'
  | 'order.created' | 'order.paid' | 'order.expired' | 'order.cancelled' | 'order.comp_issued' | 'order.box_office'
  | 'order.tickets_resent' | 'order.attendee_updated' | 'order.refunded' | 'order.bulk_refund'
  | 'checkin.scan' | 'checkin.manual' | 'checkin.override' | 'checkin.undo'
  | 'settings.updated' | 'settings.branding' | 'settings.stripe' | 'settings.website' | 'email.resent' | 'email_template.updated' | 'email_template.reset'
  | 'payout.approved' | 'payout.paid' | 'payout.voided' | 'dispute.updated' | 'reconciliation.run'
  | 'checkin.offline_conflict' | 'checkin.conflict_resolved'
  | 'auth.email_verified' | 'user.data_exported' | 'user.self_deleted'
  | 'promo.created' | 'promo.updated' | 'promo.deleted'
  | 'tracking_link.created' | 'tracking_link.updated' | 'tracking_link.deleted'
  | 'sponsor.created' | 'sponsor.updated' | 'sponsor.deleted'
  | 'ad.created' | 'ad.updated' | 'ad.deleted' | 'ad.status.changed'
  | 'application.submitted' | 'application.approved' | 'application.rejected'
  | 'export.downloaded';

export async function audit(
  action: AuditAction,
  opts: { actorUserId?: number | null; targetType?: string; targetId?: string | number; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
  await execute(
    `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, ip, user_agent, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.actorUserId ?? null,
      action,
      opts.targetType ?? null,
      opts.targetId != null ? String(opts.targetId) : null,
      ip,
      ua,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
    ],
  );
}
