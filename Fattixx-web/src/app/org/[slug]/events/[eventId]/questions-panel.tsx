"use client";

import { useActionState, useState } from "react";
import { MessageSquarePlusIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { createQuestion, updateQuestion, deleteQuestion, type ActionState } from "@/lib/events/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckField, FormStatus, SelectField, TextAreaField, TextField } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import { EmptyState, Section } from "@/components/shared";

export interface QuestionView { id: number; label: string; kind: string; required: boolean; options: string; sort_order: number }

const KINDS = [{ value: "text", label: "Short answer" }, { value: "textarea", label: "Long answer" }, { value: "select", label: "Choose one option" }, { value: "checkbox", label: "Checkbox (yes / no)" }];

function QuestionDialog({ orgSlug, eventId, question, trigger }: { orgSlug: string; eventId: number; question?: QuestionView; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(question?.kind ?? "text");
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = question ? await updateQuestion(prev, fd) : await createQuestion(prev, fd);
    if (r?.ok) { toast.success(question ? "Question updated" : "Question added"); setOpen(false); }
    return r;
  }, undefined);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger nativeButton={!trigger} render={trigger ? <span /> : <Button />}>{trigger ?? <><MessageSquarePlusIcon /> Add question</>}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{question ? "Edit question" : "Add a checkout question"}</DialogTitle><DialogDescription>Asked once per order on the ticket page, before payment. Answers show on the order.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-4">
          <FormStatus state={state} />
          <input type="hidden" name="org" value={orgSlug} /><input type="hidden" name="event_id" value={eventId} />
          {question ? <input type="hidden" name="question_id" value={question.id} /> : null}
          <TextField label="Question" id="q-label" name="label" required maxLength={200} defaultValue={question?.label} placeholder="Any accessibility needs?" autoFocus />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Answer type" id="q-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} options={KINDS} />
            <TextField label="Display order" id="q-sort" name="sort_order" type="number" min={0} defaultValue={question?.sort_order ?? 0} />
          </div>
          {kind === "select" ? <TextAreaField label="Options (one per line)" id="q-options" name="options" rows={4} required defaultValue={question?.options ?? ""} placeholder={"Vegetarian\nVegan\nNo preference"} /> : null}
          <CheckField id="q-required" name="required" label="Required" hint="Buyers cannot check out without answering." defaultChecked={question?.required} />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><SubmitButton pendingText="Saving…">{question ? "Save" : "Add question"}</SubmitButton></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function QuestionsPanel({ orgSlug, eventId, canEdit, questions }: { orgSlug: string; eventId: number; canEdit: boolean; questions: QuestionView[] }) {
  return (
    <Section title="Checkout questions" description="Collect event-specific information from buyers (dietary needs, company name, T-shirt size…)." actions={canEdit ? <QuestionDialog orgSlug={orgSlug} eventId={eventId} /> : null}>
      {questions.length === 0 ? <EmptyState title="No questions" description="Buyers only enter their name, email and phone." action={canEdit ? <QuestionDialog orgSlug={orgSlug} eventId={eventId} /> : undefined} /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Question</TableHead><TableHead>Type</TableHead>{canEdit ? <TableHead /> : null}</TableRow></TableHeader>
          <TableBody>
            {questions.map((q) => (
              <TableRow key={q.id}>
                <TableCell><span className="font-medium">{q.label}</span>{q.required ? <Badge variant="outline" className="ml-2 text-[10px]">required</Badge> : null}{q.kind === "select" ? <span className="block text-xs text-muted-foreground">{q.options.split("\n").join(" · ")}</span> : null}</TableCell>
                <TableCell className="text-muted-foreground">{KINDS.find((k) => k.value === q.kind)?.label ?? q.kind}</TableCell>
                {canEdit ? (
                  <TableCell className="text-right"><div className="flex justify-end gap-1">
                    <QuestionDialog orgSlug={orgSlug} eventId={eventId} question={q} trigger={<Button variant="ghost" size="icon-sm" aria-label="Edit"><PencilIcon /></Button>} />
                    <ConfirmButton action={deleteQuestion} fields={{ org: orgSlug, event_id: eventId, question_id: q.id }} title="Delete this question?" description="Answers already given are kept on their orders." confirmText="Delete" variant="ghost" successText="Deleted">Delete</ConfirmButton>
                  </div></TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
