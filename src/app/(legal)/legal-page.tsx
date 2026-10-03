import { brandingForLayout } from "@/lib/branding";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Plain legal text page. The owner's counsel should review and replace this draft before public launch. */
export async function LegalPage({ title, sections }: { title: string; sections: [string, string][] }) {
  const brand = await brandingForLayout();
  return (
    <article className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <Alert><AlertDescription>Draft for review. These terms describe how {brand.name} operates today and should be confirmed by legal counsel before launch.</AlertDescription></Alert>
      {sections.map(([heading, body]) => (
        <section key={heading} className="space-y-2">
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{body.replace(/this website/gi, brand.name)}</p>
        </section>
      ))}
      <p className="text-xs text-muted-foreground">Questions: <a href={`mailto:${brand.supportEmail}`} className="underline">{brand.supportEmail}</a></p>
    </article>
  );
}
