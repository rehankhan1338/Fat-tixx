"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveProfile, savePrivacy, type SocialState } from "@/lib/social/actions";
import { FormStatus, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Label } from "@/components/ui/label";

type Me = { username: string; name: string; bio: string; city: string; instagram: string; tiktok: string; x: string; avatar: string | null; adult: boolean; favorites: string[] };

export function ProfileForm({ me, categories, next }: { me: Me; categories: string[]; next: string | null }) {
  const [state, action] = useActionState<SocialState, FormData>(saveProfile, undefined);
  const router = useRouter();
  useEffect(() => { if (state?.ok && next) router.push(next); else if (state?.ok) router.refresh(); }, [state, next, router]);
  return (
    <form action={action} className="space-y-5">
      <FormStatus state={state} successText={next ? "Saved. Taking you back…" : state?.message} />
      <div className="flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- uploaded image */}
        {me.avatar ? <img src={me.avatar} alt="" className="size-20 rounded-full object-cover" /> : <div className="grid size-20 place-items-center rounded-full bg-muted text-2xl font-semibold">{me.name.slice(0, 1)}</div>}
        <div className="space-y-2">
          <Label htmlFor="pf-avatar">Photo</Label>
          <input id="pf-avatar" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" className="block text-sm" />
          {me.avatar ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="remove_avatar" /> Remove photo</label> : null}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Display name" id="pf-name" name="name" defaultValue={me.name} required maxLength={120} />
        <TextField label="Username" id="pf-username" name="username" defaultValue={me.username} required minLength={3} maxLength={30} hint="Your profile link: fattixx.com/u/username" autoComplete="off" />
      </div>
      <TextAreaField label="Bio" id="pf-bio" name="bio" defaultValue={me.bio} maxLength={160} rows={2} hint="Up to 160 characters." />
      <TextField label="City" id="pf-city" name="city" defaultValue={me.city} maxLength={120} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Instagram" id="pf-ig" name="instagram" defaultValue={me.instagram} placeholder="@handle" />
        <TextField label="TikTok" id="pf-tt" name="tiktok" defaultValue={me.tiktok} placeholder="@handle" />
        <TextField label="X" id="pf-x" name="x" defaultValue={me.x} placeholder="@handle" />
      </div>
      {categories.length ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Favorite kinds of events</legend>
          <p className="text-xs text-muted-foreground">Used for your “For you” list on the events page.</p>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <label key={c} className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                <input type="checkbox" name="categories" value={c} defaultChecked={me.favorites.includes(c)} className="accent-current" /> {c}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {!me.adult ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="adult" required className="mt-1" />
          <span>I confirm I am 18 or older. Public profiles and guest lists are for adults only.</span>
        </label>
      ) : null}
      <SubmitButton pendingText="Saving…">{me.username ? "Save profile" : "Create my profile"}</SubmitButton>
    </form>
  );
}

type Privacy = { profilePublic: boolean; guestLists: boolean; eventsOnProfile: boolean; approval: boolean; marketing: boolean; socialSms: boolean; hasPhone: boolean };

function Toggle({ name, label, hint, defaultChecked, disabled }: { name: string; label: string; hint: string; defaultChecked: boolean; disabled?: boolean }) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
      <input type="checkbox" role="switch" name={name} defaultChecked={defaultChecked} disabled={disabled} className="mt-1 size-4" />
    </label>
  );
}

export function PrivacyForm({ values, disabled }: { values: Privacy; disabled: boolean }) {
  const [state, action] = useActionState<SocialState, FormData>(savePrivacy, undefined);
  return (
    <form action={action} className="space-y-3">
      <FormStatus state={state} successText={state?.message} />
      {disabled ? <p className="text-sm text-muted-foreground">Create your profile first to choose these.</p> : null}
      <Toggle name="profile_public" label="Public profile" hint="Off: only people who follow you see your bio, links and events." defaultChecked={values.profilePublic} disabled={disabled} />
      <Toggle name="show_on_guest_lists" label="Show me on Who’s Going" hint="Your name and photo on the guest list of events you have tickets for. You can still hide yourself from any one event." defaultChecked={values.guestLists} disabled={disabled} />
      <Toggle name="show_events_on_profile" label="Show events I’m attending on my profile" hint="Public events only. Never your tickets, prices or orders." defaultChecked={values.eventsOnProfile} disabled={disabled} />
      <fieldset className="rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Who can follow me</legend>
        <label className="mt-1 flex items-center gap-2 text-sm"><input type="radio" name="who_can_follow" value="anyone" defaultChecked={!values.approval} disabled={disabled} /> Anyone</label>
        <label className="mt-1 flex items-center gap-2 text-sm"><input type="radio" name="who_can_follow" value="approved" defaultChecked={values.approval} disabled={disabled} /> Only people I approve</label>
      </fieldset>
      <Toggle name="marketing" label="Marketing emails from Fattixx" hint="Events and offers we think you’ll like. Updates about events you have tickets for are always sent." defaultChecked={values.marketing} />
      <Toggle name="social_sms" label="Texts from organizers I follow" hint={values.hasPhone ? "A text when an organizer you follow announces a new event." : "Add a phone number to your account first."} defaultChecked={values.socialSms} disabled={!values.hasPhone} />
      <SubmitButton pendingText="Saving…">Save privacy settings</SubmitButton>
    </form>
  );
}
