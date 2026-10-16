import "server-only";
import { cache } from "react";
import { CATEGORY_ICONS, DEFAULT_CATEGORIES, type Category } from "../event-categories";
import { getSettingValue, setSetting } from "../settings";
import { MAX_CATEGORIES } from "./categories-limits";

export { MAX_CATEGORIES };
const KEY = "event_categories";

/** The event categories, as managed in Super Admin → Fees & Settings → Event categories (the design's list until one is saved). */
export const listCategories = cache(async (): Promise<Category[]> => {
  const raw = await getSettingValue(KEY);
  if (!raw) return DEFAULT_CATEGORIES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_CATEGORIES;
    const out = parsed
      .filter((c): c is Category => !!c && typeof c === "object" && typeof (c as Category).name === "string" && (c as Category).name.trim() !== "")
      .map((c) => ({ name: c.name.trim(), icon: typeof c.icon === "string" && c.icon in CATEGORY_ICONS ? c.icon : "tag" }));
    return out.length ? out : DEFAULT_CATEGORIES;
  } catch {
    return DEFAULT_CATEGORIES;
  }
});

export async function categoryNames(): Promise<string[]> {
  return (await listCategories()).map((c) => c.name);
}

export async function saveCategories(categories: Category[], userId: number): Promise<void> {
  await setSetting(KEY, JSON.stringify(categories), userId);
}
