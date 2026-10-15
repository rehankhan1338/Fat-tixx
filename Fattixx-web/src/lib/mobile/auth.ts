import 'server-only';
import { queryOne, type Row } from '../db';
import { listMemberships, type OrgRole } from '../authz';
import type { PlatformRole } from '../auth/session';
import { uploadUrl } from '../uploads';
import { absoluteUrl } from './events';

/** What the app knows about the signed-in person. Internal numeric ids never leave the server. */
export interface MobileUser {
  id: string;            // public UUID
  email: string;
  name: string;
  emailVerified: boolean;
  roles: PlatformRole[];
}

export interface MobileMembership { slug: string; name: string; role: OrgRole; logoUrl: string | null; suspended: boolean }

export interface MobileAccount {
  user: MobileUser;
  memberships: MobileMembership[];
  /** True when the account has somewhere to be in the app: an active organisation membership. Platform roles alone do not count. */
  canScan: boolean;
}

export async function mobileAccount(userId: number): Promise<MobileAccount | null> {
  const row = await queryOne<Row & { public_id: string; email: string; name: string; email_verified_at: Date | null; status: string; roles: string | null }>(
    `SELECT u.public_id, u.email, u.name, u.email_verified_at, u.status,
            (SELECT GROUP_CONCAT(r.role) FROM user_platform_roles r WHERE r.user_id = u.id) AS roles
       FROM users u WHERE u.id = ?`,
    [userId],
  );
  if (!row || row.status !== 'active') return null;
  const memberships = await listMemberships(userId);
  const roles = (row.roles ? row.roles.split(',') : []) as PlatformRole[];
  return {
    user: { id: row.public_id, email: row.email, name: row.name, emailVerified: row.email_verified_at != null, roles },
    memberships: memberships.map((m) => ({ slug: m.slug, name: m.name, role: m.role, logoUrl: absoluteUrl(uploadUrl(m.logo_path)), suspended: m.status !== 'active' })),
    canScan: memberships.some((m) => m.status === 'active'),
  };
}
