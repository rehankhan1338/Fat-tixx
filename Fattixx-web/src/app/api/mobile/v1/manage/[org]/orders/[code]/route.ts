import { manageOrderDetail, manageResendTickets } from '@/lib/mobile/manage';
import { ApiError, handle, json, readJson, requireUser, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ org: string; code: string }> };

/** GET (Bearer, organizer or above) → an order with its tickets, refunds and the caller's permissions. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser();
  const { org, code } = await params;
  return json(await manageOrderDetail(v.slug(org, 'organization'), v.orderCode(code)));
});

/** POST { action: 'resend' } (Bearer) → email the tickets again. Refunds and transfers stay on the website. */
export const POST = handle<Ctx>(async (req, { params }) => {
  await requireUser();
  const { org, code } = await params;
  const body = await readJson(req, 2 * 1024);
  if (v.str(body.action, 20) === 'resend') return json(await manageResendTickets(v.slug(org, 'organization'), v.orderCode(code)));
  throw new ApiError(400, 'Unknown action.');
});
