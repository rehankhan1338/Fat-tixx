import { assertPlatformRole } from '@/lib/auth/guard';
import { listUsers } from '@/lib/admin/queries';
import { handle, json, requireUser } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET ?q= (Bearer, super admin or support) → user directory. Actions on users stay on the website. */
export const GET = handle(async (req) => {
  await requireUser();
  await assertPlatformRole(['super_admin', 'support']);
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 120);
  const rows = await listUsers(q, 60);
  return json({
    users: rows.map((u) => ({
      email: u.email, name: u.name, status: u.status, hasPassword: !!Number(u.has_password), roles: u.platform_roles ? u.platform_roles.split(',') : [],
      orgCount: Number(u.org_count), orderCount: Number(u.order_count), lastLoginAt: u.last_login_at ? new Date(u.last_login_at).toISOString() : null, createdAt: new Date(u.created_at).toISOString(),
    })),
  });
});
