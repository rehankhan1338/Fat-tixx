"use client";

import { useActionState } from "react";
import { saveHomeContent } from "@/lib/site-content/actions";
import { MAX_STATS, type HomeContent } from "@/lib/site-content/schema";
import { CheckField, FieldWrap, FormStatus, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Rows, SectionHead, TokenHelp } from "./rows";

function Photo({ name, label, url, hint }: { name: string; label: string; url: string | null; hint: string }) {
  return (
    <FieldWrap label={label} htmlFor={name} hint={hint}>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" className="h-16 w-24 rounded-md object-cover" /> : <span className="grid h-16 w-24 place-items-center rounded-md bg-muted text-xs text-muted-foreground">Design photo</span>}
        <Input id={name} name={name} type="file" accept="image/*" />
      </div>
      {url ? <CheckField id={`${name}_remove`} name={`${name}_remove`} label="Remove and use the design photo" /> : null}
    </FieldWrap>
  );
}

/** `c` is the stored document (tokens unreplaced); `images` the current hero photo URLs. */
export function HomeForm({ c, images }: { c: HomeContent; images: { go: string | null; host: string | null } }) {
  const [state, action] = useActionState(saveHomeContent, undefined);
  return (
    <form action={action} className="space-y-6">
      <FormStatus state={state} successText={state?.message} />
      <TokenHelp />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Browser / search title" id="meta_title" name="meta_title" defaultValue={c.meta.title} maxLength={120} />
        <TextAreaField label="Search description" id="meta_description" name="meta_description" defaultValue={c.meta.description} maxLength={300} rows={2} />
      </div>

      <SectionHead title="Hero" description="The two photos: going out on the left, hosting on the right." />
      <TextField label="Page heading (read by screen readers and search engines)" id="hero_heading" name="hero_heading" defaultValue={c.hero.heading} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-4 rounded-lg border p-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Left: go out</p>
          <TextAreaField label="Big words" id="hero_go_word" name="hero_go_word" defaultValue={c.hero.go.word} rows={2} maxLength={60} hint="One line per row." />
          <TextAreaField label="Lead" id="hero_go_lead" name="hero_go_lead" defaultValue={c.hero.go.lead} rows={3} maxLength={300} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Button label" id="hero_go_cta_label" name="hero_go_cta_label" defaultValue={c.hero.go.cta.label} required />
            <TextField label="Button link" id="hero_go_cta_href" name="hero_go_cta_href" defaultValue={c.hero.go.cta.href} required />
          </div>
          <Photo name="hero_go_image" label="Photo" url={images.go} hint="Wide photo, at least 2000 px. JPG, PNG or WebP up to 8 MB." />
        </div>
        <div className="space-y-4 rounded-lg border p-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Right: throw one</p>
          <TextAreaField label="Big words" id="hero_host_word" name="hero_host_word" defaultValue={c.hero.host.word} rows={2} maxLength={60} hint="One line per row." />
          <TextAreaField label="Lead" id="hero_host_lead" name="hero_host_lead" defaultValue={c.hero.host.lead} rows={3} maxLength={300} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Button label" id="hero_host_cta_label" name="hero_host_cta_label" defaultValue={c.hero.host.cta.label} required />
            <TextField label="Button link" id="hero_host_cta_href" name="hero_host_cta_href" defaultValue={c.hero.host.cta.href} required />
          </div>
          <Photo name="hero_host_image" label="Photo" url={images.host} hint="Wide photo, at least 2000 px. JPG, PNG or WebP up to 8 MB." />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Divider hint" id="hero_hint" name="hero_hint" defaultValue={c.hero.hint} maxLength={80} hint="Shown on screens where the divider can be dragged." />
        <TextField label="Divider hint, second line" id="hero_hint_sub" name="hero_hint_sub" defaultValue={c.hero.hintSub} maxLength={80} />
      </div>

      <SectionHead title="How it works" description="Four steps next to the phone mock-up. The phone screens are fixed; the words are yours." name="how_show" show={c.how.show} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Eyebrow" id="how_eyebrow" name="how_eyebrow" defaultValue={c.how.eyebrow} maxLength={60} />
        <TextAreaField label="Heading" id="how_title" name="how_title" defaultValue={c.how.title} rows={2} />
        <TextAreaField className="sm:col-span-2" label="Lead" id="how_lead" name="how_lead" defaultValue={c.how.lead} rows={2} maxLength={500} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {c.how.steps.slice(0, 4).map((s, i) => (
          <div key={i} className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Step {i + 1}</p>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
              <TextField label="Title" id={`step_title_${i}`} name="step_title" defaultValue={s.title} />
              <TextField label="Dot label" id={`step_dot_${i}`} name="step_dot" defaultValue={s.dot} maxLength={30} />
            </div>
            <TextAreaField label="Text" id={`step_text_${i}`} name="step_text" defaultValue={s.text} rows={3} />
          </div>
        ))}
      </div>

      <SectionHead title="Featured strip" description="The scrolling photos of featured events (Events → Feature on the homepage). Nothing to write here." name="featured_show" show={c.featured.show} />

      <SectionHead title="Event browser" description="The filterable grid of upcoming events." name="browse_show" show={c.browse.show} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Eyebrow" id="browse_eyebrow" name="browse_eyebrow" defaultValue={c.browse.eyebrow} maxLength={60} />
        <TextField label="Heading" id="browse_title" name="browse_title" defaultValue={c.browse.title} />
        <TextField label="Link label" id="browse_link_label" name="browse_link_label" defaultValue={c.browse.link.label} hint="Leave empty to hide the link." />
        <TextField label="Link" id="browse_link_href" name="browse_link_href" defaultValue={c.browse.link.href} />
      </div>

      <SectionHead title="Organizer band" description="The card near the bottom with the fee points." name="host_show" show={c.host.show} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Eyebrow" id="host_eyebrow" name="host_eyebrow" defaultValue={c.host.eyebrow} maxLength={60} />
        <TextAreaField label="Heading" id="host_title" name="host_title" defaultValue={c.host.title} rows={2} />
        <TextAreaField className="sm:col-span-2" label="Lead" id="host_lead" name="host_lead" defaultValue={c.host.lead} rows={2} maxLength={500} />
        <TextField label="Button label" id="host_cta_label" name="host_cta_label" defaultValue={c.host.cta.label} required />
        <TextField label="Button link" id="host_cta_href" name="host_cta_href" defaultValue={c.host.cta.href} required />
        <TextField label="Pricing link label" id="host_pricing_label" name="host_pricing_label" defaultValue={c.host.pricingLink.label} hint="Leave empty to hide the link." />
        <TextField label="Pricing link" id="host_pricing_href" name="host_pricing_href" defaultValue={c.host.pricingLink.href} />
      </div>
      <FieldWrap label="Fee points" htmlFor="stat_big_0" hint="The big figure and its explanation. {fee} and {processing_clause} keep them in step with Fees & Settings.">
        <Rows
          items={c.host.stats}
          max={MAX_STATS}
          blank={{ big: "", text: "" }}
          label="fee point"
          render={(s, i) => (
            <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <TextField label="Figure" id={`stat_big_${i}`} name="stat_big" defaultValue={s.big} maxLength={40} />
              <TextField label="Text" id={`stat_text_${i}`} name="stat_text" defaultValue={s.text} />
            </div>
          )}
        />
      </FieldWrap>

      <SubmitButton pendingText="Saving…">Save homepage</SubmitButton>
    </form>
  );
}
