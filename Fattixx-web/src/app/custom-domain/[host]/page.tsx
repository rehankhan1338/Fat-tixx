import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { organizerPage } from "@/lib/home/data";
import { organizerMetadata } from "@/lib/home/organizer-metadata";
import { requestCustomDomain, resolveActiveDomain } from "@/lib/pro/domains";
import { PublicPage } from "@/components/layout/PublicPage";
import OrganizerPage from "@/components/organizer/OrganizerPage";

/*
 * The root of a Fattixx Pro organizer's custom domain (tickets.theirbrand.com/), rewritten here by src/proxy.ts.
 * Shows their organizer page. Opened any other way, or for a domain that is not live (not verified, Pro lapsed),
 * it falls back to the normal Fattixx address (plan 5.7.2).
 */

type Loaded = { ok: true; data: NonNullable<Awaited<ReturnType<typeof organizerPage>>>; host: string } | { ok: false; fallback: string };

async function load(paramHost: string): Promise<Loaded> {
  const host = await requestCustomDomain();
  if (!host || host !== decodeURIComponent(paramHost).toLowerCase()) return { ok: false, fallback: env.APP_URL };
  const d = await resolveActiveDomain(host);
  if (!d) return { ok: false, fallback: env.APP_URL };
  if (!d.pro) return { ok: false, fallback: `${env.APP_URL}/o/${d.slug}` };
  const data = await organizerPage(d.slug);
  if (!data) return { ok: false, fallback: env.APP_URL };
  return { ok: true, data, host };
}

export async function generateMetadata({ params }: PageProps<"/custom-domain/[host]">): Promise<Metadata> {
  const r = await load((await params).host);
  return r.ok ? organizerMetadata(r.data, `https://${r.host}/`) : {};
}

export default async function CustomDomainHome({ params }: PageProps<"/custom-domain/[host]">) {
  const r = await load((await params).host);
  if (!r.ok) redirect(r.fallback);
  return (
    <PublicPage brand={r.data.brand}>
      <main className="bg-fx-ivory">
        <OrganizerPage data={r.data} />
      </main>
    </PublicPage>
  );
}
