import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { organizerPage } from "@/lib/home/data";
import { organizerHref } from "@/lib/home/events";
import { PublicPage } from "@/components/layout/PublicPage";
import OrganizerPage from "@/components/organizer/OrganizerPage";

/*
 * Organizer page: fattixx.com/o/<organization slug>. Linked from the event page's organizer card and the event tiles.
 */

export async function generateMetadata({ params }: PageProps<"/o/[id]">): Promise<Metadata> {
  const data = await organizerPage((await params).id);
  if (!data) return { title: "Organizer not found" };
  const { organizer: o } = data;
  const url = organizerHref(o.id);
  return {
    title: `${o.name} events`,
    description: o.bio?.slice(0, 160) || `Upcoming events from ${o.name}.`,
    alternates: { canonical: url },
    openGraph: { title: `${o.name} events`, description: o.bio?.slice(0, 160) || `Upcoming events from ${o.name}.`, type: "website", url, ...(o.logo ? { images: [{ url: o.logo, alt: o.name }] } : {}) },
  };
}

export default async function Page({ params }: PageProps<"/o/[id]">) {
  const data = await organizerPage((await params).id);
  if (!data) notFound();

  return (
    <PublicPage>
      <main className="bg-fx-ivory">
        <OrganizerPage data={data} />
      </main>
    </PublicPage>
  );
}
