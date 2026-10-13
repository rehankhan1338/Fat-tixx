import { permanentRedirect } from "next/navigation";

/** Short event links (fattixx.com/e/<slug>) open the event page; the query string (private keys, promo codes) travels along. */
export default async function ShortEventLink({ params, searchParams }: PageProps<"/e/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") qs.set(k, v);
  const q = qs.toString();
  permanentRedirect(`/events/${encodeURIComponent(slug)}${q ? `?${q}` : ""}`);
}
