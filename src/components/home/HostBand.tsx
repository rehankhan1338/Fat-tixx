/*
 * Organizer band. The fee points are passed in from the platform's fee settings (Admin → Fees & Settings),
 * so the marketing copy can never drift from what checkout actually charges.
 */

import { button, cardShadow, container, cx, eyebrow, sectionTitle } from "@/components/home/styles";

export type HostStat = { b: string; t: string };

export default function HostBand({ stats: STATS, createHref }: { stats: HostStat[]; createHref: string }) {
  return (
    <section className="relative bg-fx-ivory pt-[110px] max-[721px]:pt-[88px]" id="host" aria-labelledby="host-h">
      <div className={container}>
        <div
          className={cx(
            "reveal relative grid grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] items-center gap-12 overflow-hidden rounded-[28px] border border-fx-red/14 bg-white p-[clamp(32px,5vw,64px)] max-[901px]:grid-cols-1",
            cardShadow,
          )}
        >
          <div>
            <div className={eyebrow}>For organizers</div>
            <h2 className={cx(sectionTitle, "mt-3 text-[clamp(34px,4.2vw,56px)] leading-none tracking-[-0.04em]")} id="host-h">
              Hosting something?
              <br />
              Do it all with FATTIXX.
            </h2>
            <p className="mt-4 max-w-[480px] text-[16px] leading-[1.6] text-fx-red/78">
              Build your event page, set your ticket tiers and check guests in at the door, with one simple fee.
            </p>
            <div className="mt-7 flex flex-wrap gap-[10px]">
              <a href={createHref} className={button("primary")}>
                Create an event
              </a>
              <a href="#how" className={button("outline")}>
                How it works
              </a>
            </div>
          </div>
          <div className="relative grid">
            {STATS.map((s) => (
              <div key={s.b} className="flex items-baseline gap-[18px] border-t border-fx-red/14 py-[18px] last:border-b max-[721px]:flex-col max-[721px]:gap-1">
                <b className="min-w-[150px] shrink-0 font-display text-[26px] font-semibold tracking-[-0.02em] text-fx-red-second">{s.b}</b>
                <span className="text-[14px] leading-[1.5] text-fx-red/78">{s.t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
