import 'server-only';
import type { OrgBrand } from '../home/types';
import { uploadUrl } from '../uploads';
import { normalizeHex } from './brand-colors';
import { isProActive } from './status';

/**
 * The branding a Pro organizer's public pages show (plan 5.7.2), from an organizations row or an event row's org_*
 * columns. Null when the organizer is not on Pro, so the pages fall back to the standard Fattixx look.
 */
type BrandSource = {
  slug: string; name: string; logo_path: string | null; pro_until: Date | string | null;
  brand_primary: string | null; brand_accent: string | null; brand_cover_path: string | null; brand_own_header: number | boolean | null;
  white_label?: number | boolean | null;
};

export function orgBrandFrom(o: BrandSource): OrgBrand | null {
  if (!isProActive(o.pro_until)) return null;
  const primary = normalizeHex(o.brand_primary), accent = normalizeHex(o.brand_accent);
  return {
    slug: o.slug, name: o.name, logo: uploadUrl(o.logo_path),
    // colors are validated when saved; both or neither
    primary: primary && accent ? primary : null, accent: primary && accent ? accent : null,
    cover: uploadUrl(o.brand_cover_path), ownHeader: !!o.brand_own_header || !!Number(o.white_label ?? 0),
    whiteLabel: !!Number(o.white_label ?? 0),
  };
}

/** Same, from a public event row (lib/events/queries.ts PublicEventRow). */
export function eventBrand(e: {
  org_slug: string; org_name: string; org_logo: string | null; org_pro_until: Date | null;
  org_brand_primary: string | null; org_brand_accent: string | null; org_brand_cover: string | null; org_brand_own_header: number; org_white_label?: number;
}): OrgBrand | null {
  return orgBrandFrom({
    slug: e.org_slug, name: e.org_name, logo_path: e.org_logo, pro_until: e.org_pro_until,
    brand_primary: e.org_brand_primary, brand_accent: e.org_brand_accent, brand_cover_path: e.org_brand_cover, brand_own_header: e.org_brand_own_header, white_label: e.org_white_label,
  });
}
