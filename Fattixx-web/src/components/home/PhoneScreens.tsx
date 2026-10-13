/*
 * The four screens inside the "How it works" phone (static mockups; styles in styles/effects/how-it-works.css).
 * Screens 1–3 are the Fattixx website in the phone's browser (Safari's address bar shows fattixx.com), because
 * organizers create, sell and share on the web, with nothing to download. Screen 4 is the Fattixx Scanner app,
 * the one app, used at the door. Screens 1–2 mirror the real /create page (components/create/CreateEvent.tsx):
 * one long form with its own header (logo + Exit), sections, and a sticky "Create event" button, scrolled to the
 * top (cover, name, summary) and to the Tickets section. The sample event is Rooftop Jazz Night, so the numbers
 * match lib/pricing.ts: a $25 ticket is $27.92 for the buyer and $25.00 for the organizer.
 */

import type { ReactNode } from "react";

/* iOS status bar; `light` for the website screens */
function StatusBar({ light = false }: { light?: boolean }) {
  return (
    <div className={"a-status" + (light ? " light" : "")}>
      <span>9:41</span>
      <span className="a-sicons">
        <i />
        <b />
      </span>
    </div>
  );
}

/* the site's own nav, as it looks on a phone */
function SiteBar() {
  return (
    <div className="w-nav">
      <span className="w-logo">
        <svg width="20" height="10" viewBox="0 0 120 60" fill="none">
          <path d="M10 10h92a6 6 0 0 1 6 6v8a10 10 0 0 0 0 20v8a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6v-8a10 10 0 0 0 0-20v-8a6 6 0 0 1 6-6z" fill="#FFD23F" />
        </svg>
        FATTIXX
      </span>
      <span className="w-navr">
        <i>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </i>
        <em>Create event</em>
      </span>
    </div>
  );
}

/* Safari's bottom bar: the address and the toolbar */
function Safari({ url }: { url: string }) {
  return (
    <div className="w-safari">
      <div className="w-url">
        <span className="w-aa">aA</span>
        <span className="w-addr">
          <svg width="8" height="10" viewBox="0 0 16 20" fill="currentColor">
            <path d="M3 9V6a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h1Zm2 0h6V6a3 3 0 0 0-6 0v3Z" />
          </svg>
          {url}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />
        </svg>
      </div>
      <div className="w-tools">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 5-7 7 7 7" />
        </svg>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity=".4">
          <path d="m9 5 7 7-7 7" />
        </svg>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V18a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18v-5.5" />
        </svg>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20" />
        </svg>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="7" width="13" height="13" rx="2.5" />
          <path d="M4 16V6.5A2.5 2.5 0 0 1 6.5 4H16" />
        </svg>
      </div>
      <span className="w-home" />
    </div>
  );
}

/* the /create page's own header: logo and Exit */
function CreateBar() {
  return (
    <div className="w-cbar">
      <span className="w-logo">
        <span className="w-mark">
          <svg width="14" height="7" viewBox="0 0 120 60" fill="none">
            <path d="M10 10h92a6 6 0 0 1 6 6v8a10 10 0 0 0 0 20v8a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6v-8a10 10 0 0 0 0-20v-8a6 6 0 0 1 6-6z" fill="#FFD23F" />
          </svg>
        </span>
        FATTIXX
      </span>
      <em>Exit</em>
    </div>
  );
}

function WebScreen({ i, url, create = false, children }: { i: number; url: string; create?: boolean; children: ReactNode }) {
  return (
    <div className={"screen web" + (i === 0 ? " is-active" : " is-next")} data-i={i}>
      <StatusBar light />
      <div className={"w-page" + (create ? " create" : "")}>
        {create ? <CreateBar /> : <SiteBar />}
        {children}
      </div>
      <Safari url={url} />
    </div>
  );
}

/* the Rooftop Jazz Night poster (CSS art) */
function Poster({ size = "md" }: { size?: "md" | "wide" }) {
  return (
    <div className={"a-poster " + size}>
      <span className="p-sun" />
      <span className="p-t">
        ROOFTOP
        <br />
        JAZZ NIGHT
      </span>
      <span className="p-s">SAT OCT 17 · THE TERRACE</span>
    </div>
  );
}

export default function PhoneScreens() {
  return (
    <>
      {/* 1. Create: the top of the /create page */}
      <WebScreen i={0} url="fattixx.com/create" create>
        <div className="w-coverbig">
          <Poster />
          <span className="w-ovl">
            <i>Replace</i>
            <i>Remove</i>
          </span>
        </div>
        <b className="w-ctitle">Rooftop Jazz Night</b>
        <div className="w-field">
          <small>Short summary</small>
          <span>Live jazz under the lights on The Terrace.</span>
        </div>
        <div className="w-seg">
          <span className="on">Sell tickets</span>
          <span>RSVP (free)</span>
        </div>
        <div className="w-btn yellow">Create event</div>
      </WebScreen>

      {/* 2. Tickets: the same page, scrolled to the Tickets section */}
      <WebScreen i={1} url="fattixx.com/create" create>
        <div className="w-sec">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14 7v10" />
          </svg>
          Tickets
        </div>
        <div className="w-tcard">
          <div className="w-tfields">
            <span>
              <small>Ticket name</small>
              <b>General admission</b>
            </span>
            <span>
              <small>Price</small>
              <b>$25.00</b>
            </span>
          </div>
          <p>
            Buyers pay <b>$27.92</b>, you receive <b>$25.00</b>.
          </p>
        </div>
        <div className="w-tcard">
          <div className="w-tfields">
            <span>
              <small>Ticket name</small>
              <b>VIP table</b>
            </span>
            <span>
              <small>Price</small>
              <b>$60.00</b>
            </span>
          </div>
          <p>
            Buyers pay <b>$65.19</b>, you receive <b>$60.00</b>.
          </p>
        </div>
        <div className="w-add">+ Add ticket type</div>
        <div className="w-feebox">
          <b>Who covers the Fattixx fee?</b>
          <div className="w-seg">
            <span className="on">Buyers pay it</span>
            <span>I’ll cover it</span>
          </div>
        </div>
        <div className="w-btn yellow">Create event</div>
      </WebScreen>

      {/* 3. Share: the live event page */}
      <WebScreen i={2} url="fattixx.com/e/rooftop-jazz-night">
        <div className="w-live">
          <i>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
          </i>
          Your event is live
        </div>
        <div className="w-event">
          <Poster size="wide" />
          <div className="w-ebody">
            <b>Rooftop Jazz Night</b>
            <small>Sat, Oct 17 · The Terrace</small>
            <span className="w-erow">
              <em>From $27.92</em>
              <span className="w-get">Get tickets</span>
            </span>
          </div>
        </div>
        <div className="w-sharebox">
          <small>Share your event</small>
          <div className="w-link">
            <span>fattixx.com/e/rooftop-jazz-night</span>
            <em>Copy</em>
          </div>
          <div className="w-chips">
            <span>Story</span>
            <span>Message</span>
            <span>QR code</span>
          </div>
        </div>
        <div className="w-stats">
          <span>
            <b>86</b> sold
          </span>
          <span>
            <b>1,204</b> views
          </span>
        </div>
      </WebScreen>

      {/* 4. Check in, in the Fattixx Scanner app */}
      <div className="screen is-next" data-i="3">
        <StatusBar />
        <div className="a-body">
          <div className="s-app">
            <span className="s-icon">
              <svg width="16" height="8" viewBox="0 0 120 60" fill="none">
                <path d="M10 10h92a6 6 0 0 1 6 6v8a10 10 0 0 0 0 20v8a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6v-8a10 10 0 0 0 0-20v-8a6 6 0 0 1 6-6z" fill="#A8121A" />
              </svg>
            </span>
            Fattixx Scanner
          </div>
          <div className="a-top">
            <span className="a-title">Rooftop Jazz</span>
            <span className="a-chip">DOOR 1</span>
          </div>
          <div className="a-scan">
            <div className="a-qr" />
            <div className="fr">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="line" />
          </div>
          <div className="a-result">
            <i>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A8121A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
            </i>
            <div>
              <b>Maya R.</b>
              <small>General admission · checked in</small>
            </div>
          </div>
          <div className="a-count">
            <div className="row">
              <span>Checked in tonight</span>
              <b>128 / 250</b>
            </div>
            <div className="bar">
              <i />
            </div>
          </div>
        </div>
        <div className="s-tabs">
          <span className="on">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16" />
            </svg>
            Scan
          </span>
          <span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
            </svg>
            Guests
          </span>
          <span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 20V11M12 20V4M19 20v-6" />
            </svg>
            Stats
          </span>
        </div>
      </div>
    </>
  );
}
