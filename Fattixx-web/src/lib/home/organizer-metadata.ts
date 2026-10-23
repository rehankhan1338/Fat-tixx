import type { Metadata } from "next";
import type { OrganizerPageData } from "./organizer-page";

/** Metadata of an organizer page, at /o/<slug> or the root of a Pro organizer's custom domain (`url` is the canonical address). */
export function organizerMetadata(data: OrganizerPageData, url: string): Metadata {
  const { organizer: o } = data;
  const description = o.bio?.slice(0, 160) || `Upcoming events from ${o.name}.`;
  return {
    // Pro organizers' pages carry their own name only
    title: data.brand ? { absolute: o.name } : `${o.name} events`,
    description,
    alternates: { canonical: url },
    openGraph: { title: `${o.name} events`, description, type: "website", url, ...(o.logo ? { images: [{ url: o.logo, alt: o.name }] } : {}), ...(data.brand ? { siteName: o.name } : {}) },
  };
}
