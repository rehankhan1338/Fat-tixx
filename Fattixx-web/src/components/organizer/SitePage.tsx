import { container, cx } from "@/components/ui/styles";
import { RichText } from "@/components/rich-text";

/* A white-label organizer's own page (About, FAQ, …) written with the event description editor's formatting. */
export default function SitePage({ title, body }: { title: string; body: string }) {
  return (
    <main className="bg-fx-ivory pt-[120px] pb-20 text-fx-red">
      <article className={cx(container, "max-w-[760px]")}>
        <h1 className="font-display text-[clamp(32px,5vw,52px)] leading-[1.05] font-semibold tracking-[-0.03em]">{title}</h1>
        <RichText text={body} className="mt-8 space-y-4 text-[17px] leading-[1.65] text-fx-red/85" />
      </article>
    </main>
  );
}
