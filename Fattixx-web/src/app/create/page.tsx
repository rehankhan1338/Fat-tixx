import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { query, type Row } from "@/lib/db";
import { listMemberships, requireOrg, type MembershipSummary } from "@/lib/authz";
import { logout } from "@/lib/auth/actions";
import { ORG_ROLE_LABEL, orgNavGroups } from "@/lib/org-nav";
import { uploadUrl } from "@/lib/uploads";
import { getSettings } from "@/lib/settings";
import { AppShell } from "@/components/app-shell";
import { siteFees } from "@/lib/home/data";
import { FeesProvider } from "@/lib/home/fees-context";
import type { VenueOption } from "@/lib/home/create";
import { listCategories } from "@/lib/site-content/categories";
import CreateEvent from "@/components/create/CreateEvent";

export const metadata: Metadata = {
  title: "Create an event",
  description: "Create your event on Fattixx in a few minutes. Sign in at the end, no account needed to start.",
  robots: { index: false },
};

type VenueRow = Row & { id: number; organization_id: number; name: string; city: string | null; region: string | null; timezone: string; tax_bps: number; tax_label: string | null };

/**
 * One long form, saved in the browser as the organizer types. Only signed-in members of an organization (organizer or
 * admin) can open it. The lists on the page come from the database: the categories (Super Admin → Website), each
 * organization's saved venues (Dashboard → Venues) and the platform's default for who pays the fees (Admin → Settings).
 */
export default async function CreatePage({ searchParams }: PageProps<"/create">) {
  const [session, fees, sp, categories, settings] = await Promise.all([getSession(), siteFees(), searchParams, listCategories(), getSettings()]);
  const wanted = typeof sp.org === "string" ? sp.org : undefined;
  // sign in first; organizers without an approved organization apply to sell tickets first
  if (!session) redirect(`/login?next=${encodeURIComponent(wanted ? `/create?org=${wanted}` : "/create")}`);
  const canFeature = session.user.roles.includes("super_admin");
  const memberships: MembershipSummary[] = (await listMemberships(session.user.id)).filter((m) => m.status === "active" && m.role !== "staff");
  // Super Admin: "New event" from any organization's dashboard, member or not
  if (canFeature && wanted && !memberships.some((m) => m.slug === wanted)) {
    const { org } = await requireOrg(wanted, "organizer");
    memberships.unshift({ organization_id: org.id, slug: org.slug, name: org.name, role: "org_admin", status: "active", logo_path: org.logo_path } as MembershipSummary);
  }
  if (!memberships.length) redirect("/sell?reason=create");

  const orgIds = memberships.map((m) => m.organization_id);
  const marks = memberships.map(() => "?").join(",");
  const [verifiedRows, venueRows] = await Promise.all([
    query<Row & { id: number }>(`SELECT id FROM organizations WHERE verified_at IS NOT NULL AND id IN (${marks})`, orgIds),
    query<VenueRow>(`SELECT id, organization_id, name, city, region, timezone, tax_bps, tax_label FROM venues WHERE organization_id IN (${marks}) ORDER BY name`, orgIds),
  ]);
  const verified = new Set(verifiedRows.map((r) => Number(r.id)));
  const organizations = memberships.map((m) => ({ slug: m.slug, name: m.name, verified: verified.has(Number(m.organization_id)) }));
  const venuesByOrg: Record<string, VenueOption[]> = {};
  for (const m of memberships) {
    venuesByOrg[m.slug] = venueRows
      .filter((v) => Number(v.organization_id) === Number(m.organization_id))
      .map((v) => ({ id: Number(v.id), name: v.name, city: v.city, region: v.region, timezone: v.timezone, taxBps: Number(v.tax_bps), taxLabel: v.tax_label }));
  }
  const defaultFeePayer = settings.default_fee_mode === "organizer_absorbs" ? "organizer" : "buyer";
  const preselect = wanted;
  const form = (embedded: boolean) => (
    <FeesProvider fees={fees}>
      <CreateEvent signedIn organizations={organizations} preselect={preselect} embedded={embedded} categories={categories} venuesByOrg={venuesByOrg} defaultFeePayer={defaultFeePayer} canFeature={canFeature} />
    </FeesProvider>
  );

  // from the organization's panel: the same header as the rest of the panel
  if (preselect && memberships.some((m) => m.slug === preselect)) {
    const ctx = await requireOrg(preselect, "organizer");
    return (
      <AppShell
        brand={ctx.org.name} brandHref={`/org/${ctx.org.slug}`} areaLabel={ORG_ROLE_LABEL[ctx.role]} groups={orgNavGroups(ctx)} user={ctx.session.user} onSignOut={logout}
        orgSwitcher={{ current: ctx.org.slug, items: memberships.map((m) => ({ slug: m.slug, name: m.name, role: m.role })) }}
        logoUrl={uploadUrl(ctx.org.logo_path)}
      >
        {form(true)}
      </AppShell>
    );
  }

  return <div className="fx-home">{form(false)}</div>;
}
