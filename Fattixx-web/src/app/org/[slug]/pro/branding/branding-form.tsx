"use client";

import { useActionState, useState } from "react";
import { saveBranding } from "@/lib/pro/site-actions";
import { checkBrandColors, contrastRatio, MIN_CONTRAST, normalizeHex } from "@/lib/pro/brand-colors";
import { CheckField, FieldWrap, FormStatus } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";

const FATTIXX = { primary: "#a8121a", accent: "#ffd23f" };

function ColorField({ id, label, value, onChange, disabled, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean; hint: string }) {
  const hex = normalizeHex(value) ?? "#000000";
  return (
    <FieldWrap label={label} htmlFor={id} hint={hint}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label} picker`} value={hex} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-10 w-12 cursor-pointer rounded-lg border bg-white p-1" />
        <Input id={id} name={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} maxLength={7} className="font-mono" spellCheck={false} />
      </div>
    </FieldWrap>
  );
}

export function BrandingForm(p: { org: string; disabled: boolean; logoUrl: string | null; name: string; primary: string | null; accent: string | null; coverUrl: string | null; ownHeader: boolean }) {
  const [state, action] = useActionState(saveBranding, undefined);
  const [useColors, setUseColors] = useState(!!(p.primary && p.accent));
  const [primary, setPrimary] = useState(p.primary ?? FATTIXX.primary);
  const [accent, setAccent] = useState(p.accent ?? FATTIXX.accent);
  const check = checkBrandColors(primary, accent);
  const shown = useColors && check.ok ? check : { primary: FATTIXX.primary, accent: FATTIXX.accent };
  const pageRatio = normalizeHex(primary) ? contrastRatio(primary, "#F5F1EA") : 0;
  const buttonRatio = normalizeHex(primary) && normalizeHex(accent) ? contrastRatio(primary, accent) : 0;

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <FormStatus state={state} successText={state?.message} />
        <input type="hidden" name="org" value={p.org} />
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" name="use_colors" value="1" checked={useColors} onChange={(e) => setUseColors(e.target.checked)} disabled={p.disabled} className="size-4" />
          Use my own colors
        </label>
        {useColors ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField id="brand_primary" label="Main color" value={primary} onChange={setPrimary} disabled={p.disabled}
              hint={`Text, links and dark buttons. Contrast on the page: ${pageRatio.toFixed(1)}:1 (needs ${MIN_CONTRAST}:1).`} />
            <ColorField id="brand_accent" label="Accent color" value={accent} onChange={setAccent} disabled={p.disabled}
              hint={`The ticket buttons. Contrast with the main color: ${buttonRatio.toFixed(1)}:1 (needs ${MIN_CONTRAST}:1).`} />
          </div>
        ) : null}
        {useColors && !check.ok ? <p role="alert" className="text-sm text-destructive">{check.error}</p> : null}

        <FieldWrap label="Cover image" htmlFor="cover" hint="A wide photo shown at the top of your event pages and your organizer page. JPG, PNG or WebP; resized automatically.">
          <div className="flex flex-wrap items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.coverUrl ? <img src={p.coverUrl} alt="" className="h-16 w-32 rounded-lg object-cover" /> : null}
            <Input id="cover" name="cover" type="file" accept="image/*" disabled={p.disabled} className="max-w-xs" />
          </div>
        </FieldWrap>
        {p.coverUrl ? <CheckField id="remove_cover" name="remove_cover" label="Remove the cover image" /> : null}
        <CheckField id="own_header" name="own_header" defaultChecked={p.ownHeader} label="Use my own header"
          hint="Your logo and name replace the Fattixx header on your pages, and other organizers' events are not suggested. A short footer with the terms and privacy links stays. Always on when visitors come through your custom domain." />
        {!p.disabled ? <SubmitButton pendingText="Saving…" disabled={useColors && !check.ok}>Save branding</SubmitButton> : null}
      </div>

      {/* preview with the colors as the event page draws them */}
      <div aria-label="Preview" className="overflow-hidden rounded-[24px] border bg-[#F5F1EA]" style={{ color: shown.primary }}>
        <div className="flex items-center gap-2 border-b-2 bg-[#F5F1EA] px-4 py-3" style={{ borderColor: shown.accent }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.logoUrl ? <img src={p.logoUrl} alt="" className="h-8 w-auto rounded" /> : <span className="grid size-8 place-items-center rounded-full text-xs font-bold text-white" style={{ background: shown.primary }}>{p.name.slice(0, 2).toUpperCase()}</span>}
          <span className="font-display font-semibold">{p.name}</span>
        </div>
        <div className="space-y-3 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.coverUrl ? <img src={p.coverUrl} alt="" className="h-20 w-full rounded-xl object-cover" /> : null}
          <p className="font-display text-[22px] leading-tight font-semibold">Your event title</p>
          <p className="text-sm opacity-80">Fri, Nov 20 · 8 PM · The Venue</p>
          <span className="inline-flex min-h-10 items-center rounded-full px-5 text-sm font-semibold" style={{ background: shown.accent, color: shown.primary }}>Get tickets from $25.00</span>
        </div>
      </div>
    </form>
  );
}
