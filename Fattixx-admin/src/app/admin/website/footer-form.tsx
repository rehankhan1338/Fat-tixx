"use client";

import { useActionState } from "react";
import { saveFooterContent } from "@/lib/site-content/actions";
import { MAX_COLUMNS, SOCIAL_OPTIONS, type FooterContent } from "@/lib/site-content/schema";
import { SOCIAL_NETWORKS } from "@/components/ui/SocialIcon";
import { FieldWrap, FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Rows, SectionHead, TokenHelp } from "./rows";

const linesOf = (links: { label: string; href: string }[]) => links.map((l) => `${l.label} | ${l.href}`).join("\n");

export function FooterForm({ c }: { c: FooterContent }) {
  const [state, action] = useActionState(saveFooterContent, undefined);
  const socialRows = c.social.length ? c.social : [{ network: "instagram" as const, href: "" }];
  return (
    <form action={action} className="space-y-6">
      <FormStatus state={state} successText={state?.message} />
      <TokenHelp />
      <TextAreaField label="Blurb under the logo" id="blurb" name="blurb" defaultValue={c.blurb} rows={2} maxLength={300} />

      <SectionHead title="Social profiles" description="Shown as icons under the blurb. Leave the link empty to hide a network." />
      <Rows
        items={socialRows}
        max={SOCIAL_OPTIONS.length}
        blank={{ network: "instagram", href: "" }}
        label="network"
        render={(s, i) => (
          <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
            <SelectField label="Network" id={`social_network_${i}`} name="social_network" defaultValue={s.network} options={SOCIAL_OPTIONS.map((n) => ({ value: n, label: SOCIAL_NETWORKS[n].label }))} />
            <TextField label="Profile link" id={`social_href_${i}`} name="social_href" defaultValue={s.href} placeholder="https://" />
          </div>
        )}
      />

      <SectionHead title="Link columns" description='One link per line, written as "Label | /path". Links can also be mailto:, tel: or https://.' />
      <Rows
        items={c.columns}
        max={MAX_COLUMNS}
        blank={{ title: "", links: [] }}
        label="column"
        render={(col, i) => (
          <div className="space-y-3">
            <TextField label="Column title" id={`col_title_${i}`} name="col_title" defaultValue={col.title} maxLength={40} />
            <TextAreaField label="Links" id={`col_links_${i}`} name="col_links" defaultValue={linesOf(col.links)} rows={5} className="font-mono text-xs" />
          </div>
        )}
      />

      <SectionHead title="Bottom line" />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Copyright line" id="copyright" name="copyright" defaultValue={c.copyright} maxLength={200} hint="{year} is replaced with the current year." />
        <FieldWrap label="Legal links" htmlFor="legal_links" hint='One per line, "Label | /path".'>
          <TextAreaField label="" id="legal_links" name="legal_links" defaultValue={linesOf(c.legal)} rows={4} className="font-mono text-xs" />
        </FieldWrap>
      </div>

      <SubmitButton pendingText="Saving…">Save footer</SubmitButton>
    </form>
  );
}
