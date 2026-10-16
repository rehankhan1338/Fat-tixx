"use client";

import { useActionState, useState, type ReactNode } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { saveEventCategories } from "@/lib/site-content/actions";
import { CATEGORY_ICONS, type Category } from "@/lib/event-categories";
import { MAX_CATEGORIES } from "@/lib/site-content/categories-limits";
import { FormStatus, SelectField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";

const ICON_OPTIONS = Object.entries(CATEGORY_ICONS).map(([value, i]) => ({ value, label: i.label }));

let seq = 0;
const key = () => `r${++seq}`;

/**
 * A list the admin can add to and remove from. Inputs inside use `defaultValue`, so rows keep a stable key: React keeps
 * their DOM nodes (and what was typed) when another row is removed.
 */
function Rows<T>({ items, max, blank, label, render }: { items: T[]; max: number; blank: T; label: string; render: (item: T, index: number) => ReactNode }) {
  const [rows, setRows] = useState(() => items.map((item) => ({ k: key(), item })));
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.k} className="relative rounded-lg border p-3 pr-12">
          {render(r.item, i)}
          {rows.length > 1 && (
            <Button type="button" variant="ghost" size="icon" className="absolute top-2 right-2" aria-label={`Remove ${label} ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.k !== r.k))}>
              <Trash2Icon />
            </Button>
          )}
        </div>
      ))}
      {rows.length < max && (
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, { k: key(), item: blank }])}>
          <PlusIcon /> Add {label}
        </Button>
      )}
    </div>
  );
}

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
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <TextField label="Name" id={`cat_name_${i}`} name="cat_name" defaultValue={c.name} maxLength={40} />
            <SelectField label="Icon" id={`cat_icon_${i}`} name="cat_icon" defaultValue={c.icon} options={ICON_OPTIONS} />
          </div>
        )}
      />
      <SubmitButton pendingText="Saving…">Save categories</SubmitButton>
    </form>
  );
}
