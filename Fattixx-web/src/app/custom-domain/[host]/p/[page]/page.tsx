import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { env } from "@/lib/env";
import { richTextPlain } from "@/lib/rich-text";
import { requestCustomDomain, resolveActiveDomain } from "@/lib/pro/domains";
import { loadSitePage } from "@/lib/pro/site-pages";
import { PublicPage } from "@/components/layout/PublicPage";
import SitePage from "@/components/organizer/SitePage";

/* A white-label site page on the organizer's custom domain (tickets.theirbrand.com/p/<page>), rewritten here by src/proxy.ts. */

type Loaded = { fallback: string; data?: undefined } | { fallback?: undefined; data: Awaited<ReturnType<typeof loadSitePage>> };

async function load(paramHost: string, pageSlug: string): Promise<Loaded> {
  const host = await requestCustomDomain();
  if (!host || host !== decodeURIComponent(paramHost).toLowerCase()) return { fallback: env.APP_URL };
  const d = await resolveActiveDomain(host);
  if (!d) return { fallback: env.APP_URL };
  if (!d.pro) return { fallback: `${env.APP_URL}/o/${d.slug}` };
  return { data: await loadSitePage(d.slug, pageSlug) };
}

export async function generateMetadata({ params }: PageProps<"/custom-domain/[host]/p/[page]">): Promise<Metadata> {
  const { host, page } = await params;
  const r = await load(host, page);
  if (!r.data) return { title: "Page not found" };
  return { title: `${r.data.page.title} · ${r.data.brand.name}`, description: richTextPlain(r.data.page.body).slice(0, 160) };
}

export default async function Page({ params }: PageProps<"/custom-domain/[host]/p/[page]">) {
  const { host, page } = await params;
  const r = await load(host, page);
  if (r.fallback !== undefined) redirect(r.fallback);
  if (!r.data) notFound();
  return (
    <PublicPage brand={r.data.brand}>
      <SitePage title={r.data.page.title} body={r.data.page.body} />
    </PublicPage>
  );
}
