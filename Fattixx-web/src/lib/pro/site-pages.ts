import 'server-only';
import { getPublicOrganization } from '../events/queries';
import type { OrgBrand } from '../home/types';
import { orgBrandFrom } from './branding';
import { getSitePage, sitePageLinks, whiteLabelActive, type SitePageRow } from './white-label';

/** A published white-label site page with the brand its chrome needs, or null (not white-label, not published, unknown). */
export async function loadSitePage(orgSlug: string, pageSlug: string): Promise<{ page: SitePageRow; brand: OrgBrand; orgSlug: string } | null> {
  const org = await getPublicOrganization(orgSlug);
  if (!org || !whiteLabelActive(org)) return null;
  const page = await getSitePage(org.id, pageSlug);
  const brand = orgBrandFrom(org);
  if (!page || !Number(page.published) || !brand) return null;
  brand.pages = await sitePageLinks(org);
  return { page, brand, orgSlug: org.slug };
}
