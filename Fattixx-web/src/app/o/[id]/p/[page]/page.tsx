import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { richTextPlain } from "@/lib/rich-text";
import { loadSitePage } from "@/lib/pro/site-pages";
import { PublicPage } from "@/components/layout/PublicPage";
import SitePage from "@/components/organizer/SitePage";

/* A white-label organizer's site page: fattixx.com/o/<organization>/p/<page> (their custom domain serves /p/<page>). */

export async function generateMetadata({ params }: PageProps<"/o/[id]/p/[page]">): Promise<Metadata> {
  const { id, page } = await params;
  const r = await loadSitePage(id, page);
  if (!r) return { title: "Page not found" };
  return { title: `${r.page.title} · ${r.brand.name}`, description: richTextPlain(r.page.body).slice(0, 160) };
}

export default async function Page({ params }: PageProps<"/o/[id]/p/[page]">) {
  const { id, page } = await params;
  const r = await loadSitePage(id, page);
  if (!r) notFound();
  return (
    <PublicPage brand={r.brand}>
      <SitePage title={r.page.title} body={r.page.body} />
    </PublicPage>
  );
}
