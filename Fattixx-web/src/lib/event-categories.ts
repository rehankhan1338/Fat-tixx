/**
 * Event categories: the homepage category pills, the /events filter, the /create page and the organizer's event form
 * share one list. The list itself is managed in Super Admin → Fees & Settings → Event categories (src/lib/site-content/categories.ts);
 * this module holds the icon set and the default list.
 */
export type Category = { name: string; icon: string };

/* Icons a category can use (SVG path, 24x24 viewBox) */
export const CATEGORY_ICONS: Record<string, { label: string; path: string }> = {
  music: { label: "Music", path: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" },
  nightlife: { label: "Nightlife", path: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" },
  beauty: { label: "Beauty & hair", path: "M6 3v18M10 3v18M6 8h4M14 3l4 4-4 4M18 7H10" },
  education: { label: "Education", path: "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5" },
  community: { label: "Community", path: "M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" },
  heart: { label: "Heart (fundraisers)", path: "M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" },
  food: { label: "Food & drink", path: "M4 3v8a3 3 0 0 0 6 0V3M7 3v18M17 3c-2 2-3 5-3 8h4V3zM18 11v10" },
  comedy: { label: "Comedy", path: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14c1 2 2.5 3 4 3s3-1 4-3M9 9h.01M15 9h.01" },
  fitness: { label: "Fitness", path: "M13 4a2 2 0 1 0 0-.01M9 20l3-6 3 3v4M7 12l3-4 4 2 3 3" },
  art: { label: "Art", path: "M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 2 0 3 0a4 4 0 0 0 4-4 9 9 0 0 0-9-9zM7.5 10.5h.01M10.5 7h.01M15 7.5h.01" },
  sports: { label: "Sports", path: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.6 9h16.8M3.6 15h16.8M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" },
  theater: { label: "Theater & film", path: "M4 5h16v14H4zM4 9h16M4 15h16M8 5v14M16 5v14" },
  family: { label: "Family", path: "M9 6a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4 21v-7a5 5 0 0 1 10 0v7M14 21v-5a3 3 0 0 1 6 0v5" },
  business: { label: "Business", path: "M3 8h18v12H3zM8 8V5h8v3M3 13h18" },
  tech: { label: "Tech", path: "M4 5h16v11H4zM2 19h20M9 9l-2 2 2 2M15 9l2 2-2 2" },
  outdoors: { label: "Outdoors", path: "M3 20l6-10 4 6 2-3 6 7zM17 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" },
  tag: { label: "Other", path: "M20 12l-8 8-9-9V3h8zM7.5 7.5h.01" },
};

export const DEFAULT_CATEGORIES: Category[] = [
  { name: "Music", icon: "music" },
  { name: "Nightlife", icon: "nightlife" },
  { name: "Beauty & hair", icon: "beauty" },
  { name: "Education", icon: "education" },
  { name: "Community", icon: "community" },
  { name: "Fundraisers", icon: "heart" },
  { name: "Food & drink", icon: "food" },
  { name: "Comedy", icon: "comedy" },
  { name: "Fitness", icon: "fitness" },
];

/** The SVG path for a category's icon (unknown icons get the generic tag). */
export function categoryIconPath(icon: string): string {
  return (CATEGORY_ICONS[icon] ?? CATEGORY_ICONS.tag).path;
}
