'use server';

/* Super Admin → Fees & Settings → Event categories. */

import { revalidatePath } from 'next/cache';
import { audit } from '../audit';
import { assertSuperAdmin } from '../auth/guard';
import { CATEGORY_ICONS, type Category } from '../event-categories';
import { MAX_CATEGORIES, saveCategories } from './categories';

export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;

const list = (fd: FormData, k: string, max: number, maxLen: number) => fd.getAll(k).map((v) => String(v).trim().slice(0, maxLen)).slice(0, max);

/** Event categories: homepage pills, /events filter, /create, the organizer's event form and the mobile app. */
export async function saveEventCategories(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const names = list(fd, 'cat_name', MAX_CATEGORIES, 40);
  const icons = list(fd, 'cat_icon', MAX_CATEGORIES, 30);
  const categories: Category[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!name) continue;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return { error: `"${name}" is listed twice.` };
    categories.push({ name, icon: icons[i] in CATEGORY_ICONS ? icons[i] : 'tag' });
  }
  if (!categories.length) return { error: 'Keep at least one category.' };
  await saveCategories(categories, session.user.id);
  await audit('settings.categories', { actorUserId: session.user.id, metadata: { count: categories.length } });
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Categories saved. Events already filed under a removed category keep it until they are edited.' };
}
