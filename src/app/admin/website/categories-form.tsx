"use client";

import { useActionState } from "react";
import { saveEventCategories } from "@/lib/site-content/actions";
import { CATEGORY_ICONS, type Category } from "@/lib/event-categories";
import { MAX_CATEGORIES } from "@/lib/site-content/categories-limits";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Rows } from "./rows";

const ICON_OPTIONS = Object.entries(CATEGORY_ICONS).map(([value, i]) => ({ value, label: i.label }));

export function CategoriesForm({ categories }: { categories: Category[] }) {
  const [state, action] = useActionState(saveEventCategories, undefined);
  return (
    <form action={action} className="space-y-6">
      <FormStatus state={state} successText={state?.message} />
      <p className="text-sm text-muted-foreground">
        The order here is the order of the pills on the homepage, the filter on the events page and the choices on the create-event page. Renaming a category does not move the events filed under the old name; edit those events to re-file them.
      </p>
      <Rows
        items={categories}
        max={MAX_CATEGORIES}
        blank={{ name: "", icon: "tag" }}
        label="category"
        render={(c, i) => (
          <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
            <TextField label="Name" id={`cat_name_${i}`} name="cat_name" defaultValue={c.name} maxLength={40} />
            <SelectField label="Icon" id={`cat_icon_${i}`} name="cat_icon" defaultValue={c.icon} options={ICON_OPTIONS} />
          </div>
        )}
      />
      <SubmitButton pendingText="Saving…">Save categories</SubmitButton>
    </form>
  );
}
