"use client";

import { useActionState } from "react";
import { savePricingContent } from "@/lib/site-content/actions";
import { MAX_FAQ, type PricingContent } from "@/lib/site-content/schema";
import { FieldWrap, FormStatus, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { Rows, SectionHead, TokenHelp } from "./rows";

/** `c` is the stored document (tokens unreplaced). The fee figures themselves live under Fees & Settings. */
export function PricingForm({ c }: { c: PricingContent }) {
  const [state, action] = useActionState(savePricingContent, undefined);
  const h = c.hero;
  return (
    <form action={action} className="space-y-6">
      <FormStatus state={state} successText={state?.message} />
      <TokenHelp />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Browser / search title" id="meta_title" name="meta_title" defaultValue={c.meta.title} maxLength={120} />
        <TextAreaField label="Search description" id="meta_description" name="meta_description" defaultValue={c.meta.description} maxLength={300} rows={2} />
      </div>

      <SectionHead title="Hero and fee calculator" description="The calculator's figures come from Fees & Settings; these are the words around it." />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Eyebrow" id="hero_eyebrow" name="hero_eyebrow" defaultValue={h.eyebrow} maxLength={60} />
        <TextAreaField label="Heading" id="hero_title" name="hero_title" defaultValue={h.title} rows={2} />
        <TextAreaField className="sm:col-span-2" label="Lead" id="hero_lead" name="hero_lead" defaultValue={h.lead} rows={2} maxLength={500} />
        <TextField label="Ticket stub: small label" id="hero_ticket_label" name="hero_ticket_label" defaultValue={h.ticketLabel} maxLength={40} />
        <TextField label="Ticket stub: ticket name" id="hero_ticket_type" name="hero_ticket_type" defaultValue={h.ticketType} maxLength={60} />
        <TextField label="Ticket stub: tagline" id="hero_ticket_tagline" name="hero_ticket_tagline" defaultValue={h.ticketTagline} maxLength={120} />
        <TextField label="Receipt: platform fee line" id="hero_fee_label" name="hero_fee_label" defaultValue={h.feeLabel} maxLength={40} />
        <TextField label="Who covers the fee: question" id="hero_payer_question" name="hero_payer_question" defaultValue={h.payerQuestion} maxLength={80} />
        <div className="grid gap-3 grid-cols-2">
          <TextField label="Option: buyers" id="hero_payer_buyer" name="hero_payer_buyer" defaultValue={h.payerBuyer} maxLength={40} />
          <TextField label="Option: organizer" id="hero_payer_organizer" name="hero_payer_organizer" defaultValue={h.payerOrganizer} maxLength={40} />
        </div>
        <TextField label="Note when buyers pay" id="hero_buyer_note" name="hero_buyer_note" defaultValue={h.buyerNote} maxLength={300} />
        <TextField label="Note when the organizer pays" id="hero_organizer_note" name="hero_organizer_note" defaultValue={h.organizerNote} maxLength={300} />
        <TextField className="sm:col-span-2" label="Tax note" id="hero_tax_note" name="hero_tax_note" defaultValue={h.taxNote} maxLength={300} />
      </div>

      <SectionHead title="The three rules" description="Big figure, title and text per column. {fee} and {processing_rate} follow Fees & Settings." name="rules_show" show={c.rules.show} />
      <div className="grid gap-3 sm:grid-cols-3">
        {c.rules.items.slice(0, 3).map((r, i) => (
          <div key={i} className="space-y-3 rounded-lg border p-3">
            <TextField label="Figure" id={`rule_big_${i}`} name="rule_big" defaultValue={r.big} maxLength={40} />
            <TextField label="Title" id={`rule_title_${i}`} name="rule_title" defaultValue={r.title} maxLength={80} />
            <TextAreaField label="Text" id={`rule_text_${i}`} name="rule_text" defaultValue={r.text} rows={3} />
          </div>
        ))}
      </div>

      <SectionHead title="Comparison" description="Fattixx fees next to another platform's published rates." name="compare_show" show={c.compare.show} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Eyebrow" id="compare_eyebrow" name="compare_eyebrow" defaultValue={c.compare.eyebrow} maxLength={60} />
        <TextAreaField label="Heading" id="compare_title" name="compare_title" defaultValue={c.compare.title} rows={2} />
        <TextAreaField className="sm:col-span-2" label="Lead" id="compare_lead" name="compare_lead" defaultValue={c.compare.lead} rows={2} maxLength={500} />
      </div>
      <div className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextField label="Other platform's name" id="comp_label" name="comp_label" defaultValue={c.compare.competitor.label} maxLength={60} />
        <TextField label="Their service fee (%)" id="comp_service_pct" name="comp_service_pct" type="number" step="0.01" min={0} defaultValue={c.compare.competitor.servicePercent} />
        <TextField label="Their fixed fee per ticket ($)" id="comp_service_fixed" name="comp_service_fixed" type="number" step="0.01" min={0} defaultValue={(c.compare.competitor.serviceFixedCents / 100).toFixed(2)} />
        <TextField label="Their payment processing (%)" id="comp_processing_pct" name="comp_processing_pct" type="number" step="0.01" min={0} defaultValue={c.compare.competitor.processingPercent} />
        <TextField label="Rates checked" id="comp_checked" name="comp_checked" defaultValue={c.compare.competitor.checked} maxLength={60} hint="e.g. October 2026" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextAreaField label="Savings note" id="compare_save_note" name="compare_save_note" defaultValue={c.compare.saveNote} rows={2} maxLength={300} />
        <TextAreaField label="Footnote" id="compare_footnote" name="compare_footnote" defaultValue={c.compare.footnote} rows={3} maxLength={1000} hint="{competitor}, {competitor_rate} and {competitor_checked} fill in the figures above." />
      </div>

      <SectionHead title="Questions" description="Frequently asked questions. The first one is open by default." name="faq_show" show={c.faq.show} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Eyebrow" id="faq_eyebrow" name="faq_eyebrow" defaultValue={c.faq.eyebrow} maxLength={60} />
        <TextField label="Heading" id="faq_title" name="faq_title" defaultValue={c.faq.title} />
        <TextAreaField className="sm:col-span-2" label="Side note" id="faq_lead" name="faq_lead" defaultValue={c.faq.lead} rows={2} maxLength={300} hint="[Contact us](mailto:{support_email}) makes a link to the support email." />
      </div>
      <FieldWrap label="Questions and answers" htmlFor="faq_q_0">
        <Rows
          items={c.faq.items}
          max={MAX_FAQ}
          blank={{ q: "", a: "" }}
          label="question"
          render={(f, i) => (
            <div className="space-y-3">
              <TextField label="Question" id={`faq_q_${i}`} name="faq_q" defaultValue={f.q} />
              <TextAreaField label="Answer" id={`faq_a_${i}`} name="faq_a" defaultValue={f.a} rows={3} />
            </div>
          )}
        />
      </FieldWrap>

      <SectionHead title="Closing call to action" name="cta_show" show={c.cta.show} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextAreaField label="Heading" id="cta_title" name="cta_title" defaultValue={c.cta.title} rows={2} />
        <TextAreaField label="Lead" id="cta_lead" name="cta_lead" defaultValue={c.cta.lead} rows={2} maxLength={300} />
        <TextField label="Button label" id="cta_label" name="cta_label" defaultValue={c.cta.primary.label} required />
        <TextField label="Button link" id="cta_href" name="cta_href" defaultValue={c.cta.primary.href} required />
        <TextField label="Second button (emails support)" id="cta_secondary" name="cta_secondary" defaultValue={c.cta.secondaryLabel} maxLength={40} hint="Leave empty to hide it." />
      </div>

      <SubmitButton pendingText="Saving…">Save pricing page</SubmitButton>
    </form>
  );
}
