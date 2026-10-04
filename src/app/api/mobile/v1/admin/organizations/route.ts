import { assertPlatformRole, ALL_PLATFORM_ROLES } from '@/lib/auth/guard';
import { listOrganizations } from '@/lib/admin/queries';
import { handle, json, requireUser } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET ?q= (Bearer, platform staff) → every organisation with member, event and sales counts. */
export const GET = handle(async (req) => {
  await requireUser();
  await assertPlatformRole(ALL_PLATFORM_ROLES);
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 120);
  const rows = await listOrganizations(q);
  return json({
    organizations: rows.map((o) => ({
      slug: o.slug, name: o.name, contactEmail: o.contact_email, status: o.status, createdAt: new Date(o.created_at).toISOString(),
      members: Number(o.members), events: Number(o.events), orders: Number(o.orders), grossCents: Number(o.gross_cents),
    })),
  });
});
