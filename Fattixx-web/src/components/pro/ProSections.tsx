import Link from "next/link";
import { button, cardShadow, container, cx, eyebrow, sectionTitle } from "@/components/ui/styles";
import { feeLabel, processingLabel, type FeeConfig } from "@/lib/home/pricing";
import { PRO_FEATURES, PRO_GROUPS, PRO_SIGNUP_HREF } from "@/lib/home/pro";
import { ProFeatureIcon } from "./icons";
import SeatMapDemo from "./SeatMapDemo";

const byKey = Object.fromEntries(PRO_FEATURES.map((f) => [f.key, f]));

function SectionHead({ id, eyebrowText, title, text }: { id: string; eyebrowText?: string; title: string; text?: string }) {
  return (
    <>
      {eyebrowText && <div className={eyebrow}>{eyebrowText}</div>}
      <h2 id={id} className={cx(sectionTitle, "text-[clamp(32px,3.6vw,48px)] leading-none tracking-[-0.04em]", eyebrowText && "mt-3")}>
        {title}
      </h2>
      {text && <p className="mt-[14px] max-w-[600px] text-[16px] leading-[1.6] text-fx-red/78">{text}</p>}
    </>
  );
}

export function ProFeatures({ className }: { className?: string }) {
  return (
    <section aria-labelledby="pro-features-h" className={cx(container, className)}>
      <SectionHead id="pro-features-h" eyebrowText="What you get" title="Everything Pro adds." text="On top of everything every organizer already gets: event pages, ticket sales and payouts." />
      <div className="mt-10 border-b border-fx-red/14">
        {PRO_GROUPS.map((g) => (
          <div key={g.title} className="reveal grid grid-cols-[minmax(0,.7fr)_minmax(0,2fr)] gap-10 border-t border-fx-red/14 py-9 max-[901px]:grid-cols-1 max-[901px]:gap-5">
            <h3 className="font-display text-[26px] leading-[1.05] font-semibold tracking-[-0.03em]">{g.title}</h3>
            <ul className="grid grid-cols-2 gap-x-10 gap-y-7 max-[721px]:grid-cols-1">
              {g.keys.map((k) => (
                <li key={k} className="flex gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-fx-red/8">
                    <ProFeatureIcon k={k} />
                  </span>
                  <span>
                    <span className="block text-[16px] font-semibold">{byKey[k].title}</span>
                    <span className="mt-1 block text-[14px] leading-[1.55] text-fx-red/78">{byKey[k].text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

const SEATING_STEPS = [
  { title: "Pick a venue map", text: "Choose your room from the Fattixx Venue Library and go straight to pricing." },
  { title: "Or request a new one", text: "Send us the venue’s official seating chart and we build the interactive map." },
  { title: "Approve and sell", text: "Check every section, row and seat, set your price tiers, and go on sale." },
];

export function ReservedSeating({ className }: { className?: string }) {
  return (
    <section aria-labelledby="pro-seating-h" className={cx(container, className)}>
      <div className="grid grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] items-center gap-14 max-[901px]:grid-cols-1 max-[901px]:gap-10">
        <div>
          <SectionHead
            id="pro-seating-h"
            eyebrowText="Reserved seating"
            title="Let buyers pick their seat."
            text="Sell numbered seats, tables, boxes and sections from an interactive map, with accessible seating marked and every price shown with fees included."
          />
          <div className="mt-8 grid gap-5">
            {SEATING_STEPS.map((s) => (
              <div key={s.title} className="border-t border-fx-red/14 pt-5">
                <h3 className="text-[16px] font-semibold">{s.title}</h3>
                <p className="mt-1 max-w-[440px] text-[15px] leading-[1.55] text-fx-red/78">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="reveal">
          <SeatMapDemo />
          <p className="mt-3 text-center text-[13px] text-fx-red/78">Try it: pick a seat.</p>
        </div>
      </div>
    </section>
  );
}

const faqFor = (fees: FeeConfig): { q: string; a: string }[] => [
  {
    q: "Does Pro change my ticket fee?",
    a: `No. The per-ticket fee is the same on every plan: ${feeLabel(fees)}${processingLabel(fees) ? `, plus card processing of ${processingLabel(fees)}` : ", card processing included"}. Pro is a separate monthly price for the extra tools.`,
  },
  {
    q: "Do I need Pro to sell tickets?",
    a: "No. Every organizer can create events, sell general admission, VIP, table and free tickets, scan at the door and get paid. Pro adds your branding, reserved seating, marketing and deeper reports.",
  },
  {
    q: "How does my own web address work?",
    a: "You keep your domain and point a subdomain like tickets.yourbrand.com to Fattixx. We check the setup and turn on the secure (https) connection for you. Your regular fattixx.com links keep working too.",
  },
  {
    q: "How do seat maps get made?",
    a: "If your venue is already in the Fattixx Venue Library, pick its layout and you’re ready to price. If not, request a map and send the venue’s official seating chart. We build it, you review it, and tickets go on sale once you approve it. A new map may have a one-time setup fee.",
  },
  {
    q: "Who can I email?",
    a: "Past buyers who agreed to hear from you. Tickets, receipts and event updates are sent separately and don’t count as marketing, and unsubscribes are handled for you.",
  },
  {
    q: "What happens if I cancel?",
    a: "Events you’ve already published keep selling, scanning and paying out as normal, and buyers keep their tickets and seats. After a short grace period your pages go back to standard Fattixx branding and the Pro tools switch off. Your event history stays.",
  },
];

export function ProFaq({ className, fees, contactEmail }: { className?: string; fees: FeeConfig; contactEmail: string }) {
  const FAQ = faqFor(fees);
  return (
    <section aria-labelledby="pro-faq-h" className={cx(container, className)}>
      <div className="flex flex-wrap items-start gap-x-16 gap-y-8">
        <div className="flex-[1_1_300px]">
          <SectionHead id="pro-faq-h" title="Good to know." />
          <p className="mt-[14px] max-w-[340px] text-[16px] leading-[1.6] text-fx-red/78">
            Something else?{" "}
            <a href={`mailto:${contactEmail}?subject=Fattixx%20Pro`} className="font-semibold text-fx-red-second underline underline-offset-4">
              Talk to us
            </a>
            .
          </p>
        </div>
        <div className="min-w-0 flex-[2_1_560px] border-b border-fx-red/14 max-[641px]:flex-[1_1_100%]">
          {FAQ.map((f, i) => (
            <details key={f.q} open={i === 0} className="group border-t border-fx-red/14">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-[22px] font-display text-[20px] font-semibold tracking-[-0.02em] max-[641px]:text-[18px] [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fx-sand transition-transform duration-300 ease-fx group-open:rotate-45">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M7 1v12M1 7h12" />
                  </svg>
                </span>
              </summary>
              <p className="m-0 max-w-[720px] pr-[60px] pb-6 text-[16px] leading-[1.6] text-fx-red/78 max-[641px]:pr-0">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ProCta({ className }: { className?: string }) {
  return (
    <section aria-labelledby="pro-cta-h" className={cx(container, className)}>
      <div className={cx("reveal flex flex-wrap items-center justify-between gap-8 rounded-[28px] border border-fx-red/14 bg-white p-[clamp(28px,4vw,48px)]", cardShadow)}>
        <div>
          <h2 id="pro-cta-h" className={cx(sectionTitle, "text-[clamp(30px,3.4vw,44px)] leading-[1.02] tracking-[-0.04em]")}>
            Make every page yours.
          </h2>
          <p className="mt-[10px] text-[16px] leading-[1.6] text-fx-red/78">Switch on Pro and your next event goes live with your brand.</p>
        </div>
        <div className="flex flex-wrap gap-[10px]">
          <Link href={PRO_SIGNUP_HREF} className={button("primary")}>
            Get Fattixx Pro
          </Link>
          <a href="#pricing" className={button("outline")}>
            See pricing
          </a>
        </div>
      </div>
    </section>
  );
}
