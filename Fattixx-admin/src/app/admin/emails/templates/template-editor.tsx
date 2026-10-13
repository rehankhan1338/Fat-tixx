"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { previewEmailTemplate, resetEmailTemplate, saveEmailTemplate, type ActionState } from "@/lib/admin/finance-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormStatus } from "@/components/form-fields";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";

export interface TemplateView { key: string; name: string; description: string; variables: string[]; defaultSubject: string; defaultBody: string; subject: string; body: string; customized: boolean; updatedAt: string | null; updatedBy: string | null }

export function TemplateEditor({ templates }: { templates: TemplateView[] }) {
  const [selected, setSelected] = useState(templates[0].key);
  const t = templates.find((x) => x.key === selected)!;
  return (
    <div className="grid gap-6 lg:grid-cols-4">
      <Card className="lg:col-span-1">
        <CardHeader><CardTitle className="text-sm">Templates</CardTitle></CardHeader>
        <CardContent className="p-2">
          <ul className="space-y-1">
            {templates.map((x) => (
              <li key={x.key}>
                <button type="button" onClick={() => setSelected(x.key)} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent ${x.key === selected ? "bg-accent font-medium" : ""}`}>
                  <span>{x.name}</span>{x.customized ? <Badge variant="outline" className="text-[10px]">edited</Badge> : null}
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <div className="lg:col-span-3"><Editor key={t.key} t={t} /></div>
    </div>
  );
}

function Editor({ t }: { t: TemplateView }) {
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [, start] = useTransition();
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await saveEmailTemplate(prev, fd);
    if (r?.ok) toast.success(r.message ?? "Saved");
    return r;
  }, undefined);

  useEffect(() => {
    const id = setTimeout(() => start(async () => { const p = await previewEmailTemplate(t.key, subject, body); if (!("error" in p)) setPreview(p); }), 400);
    return () => clearTimeout(id);
  }, [t.key, subject, body]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">{t.name} {t.customized ? <span className="text-xs font-normal text-muted-foreground">edited {t.updatedAt}{t.updatedBy ? ` by ${t.updatedBy}` : ""}</span> : <span className="text-xs font-normal text-muted-foreground">default</span>}</CardTitle>
          <CardDescription>{t.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <FormStatus state={state} successText={state?.message} />
            <input type="hidden" name="key" value={t.key} />
            <div className="grid gap-1.5"><Label htmlFor="tpl-subject">Subject</Label><Input id="tpl-subject" name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required /></div>
            <div className="grid gap-1.5"><Label htmlFor="tpl-body">Body (HTML allowed)</Label><Textarea id="tpl-body" name="body_html" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="font-mono text-xs" required /></div>
            <p className="text-xs text-muted-foreground">Placeholders: {t.variables.map((v) => <code key={v} className="mr-1 rounded bg-muted px-1">{v.startsWith("{{{") ? v : `{{${v}}}`}</code>)} <code className="mr-1 rounded bg-muted px-1">{"{{platform_name}}"}</code> <code className="rounded bg-muted px-1">{"{{support_email}}"}</code>. Buttons: <code className="rounded bg-muted px-1">{'<a href="{{url}}" class="btn">Label</a>'}</code>.</p>
            <div className="flex flex-wrap gap-2">
              <SubmitButton pendingText="Saving…">Save template</SubmitButton>
              <Button type="button" variant="ghost" onClick={() => { setSubject(t.defaultSubject); setBody(t.defaultBody); }}>Load default text</Button>
              {t.customized ? <ConfirmButton action={resetEmailTemplate} fields={{ key: t.key }} title="Reset to the default template?" description="Your edits to this template are discarded." confirmText="Reset" variant="outline" successText="Reset to default">Reset to default</ConfirmButton> : null}
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Preview with sample data</CardTitle>{preview ? <CardDescription>Subject: {preview.subject}</CardDescription> : null}</CardHeader>
        <CardContent>{preview ? <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[560px] w-full rounded-lg border bg-white" /> : <p className="text-sm text-muted-foreground">Rendering…</p>}</CardContent>
      </Card>
    </div>
  );
}
