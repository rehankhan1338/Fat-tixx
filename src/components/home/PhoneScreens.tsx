/*
 * The four in-app screens shown inside the phone in "How it works".
 * Static mockups (sample content). HowItWorks.tsx slides them by setting inline transforms.
 * Converted 1:1 from the approved HTML design; styles live in styles/06-how-it-works.css.
 */
export default function PhoneScreens() {
  return (
    <>
      {/* Screen 1: create */}
      <div className="screen is-active" data-i="0">
        <div className="a-status">
          <span>9:41</span>
          <span className="a-sicons">
            <i />
            <b />
          </span>
        </div>
        <div className="a-body">
          <div className="a-top">
            <span className="a-title">New event</span>
            <span className="a-chip">DRAFT</span>
          </div>
          <div className="a-poster">
            <span className="p-sun" />
            <span className="p-t">
              ROOFTOP
              <br />
              JAZZ NIGHT
            </span>
            <span className="p-s">SAT OCT 17 AT THE TERRACE</span>
          </div>
          <div className="a-field">
            <small>Event name</small>
            <span>Rooftop Jazz Night</span>
          </div>
          <div className="a-field">
            <small>Date &amp; time</small>
            <span>Sat, Oct 17, 8:00 PM</span>
          </div>
          <div className="a-field">
            <small>Venue</small>
            <span>The Terrace</span>
          </div>
          <div className="a-btn">Publish event</div>
        </div>
        <div className="a-tabs">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <svg className="on" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14 7v10" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        </div>
      </div>
      {/* Screen 2: tickets */}
      <div className="screen is-next" data-i="1">
        <div className="a-status">
          <span>9:41</span>
          <span className="a-sicons">
            <i />
            <b />
          </span>
        </div>
        <div className="a-body">
          <div className="a-top">
            <span className="a-title">Tickets</span>
            <span className="a-link">+ Add</span>
          </div>
          <div className="a-tier">
            <div>
              <b>Early bird</b>
              <small>$18, 50 available</small>
            </div>
            <span className="a-toggle" />
          </div>
          <div className="a-tier hot">
            <div>
              <b>General Admission</b>
              <small>$25, 300 available</small>
            </div>
            <span className="a-toggle" />
          </div>
          <div className="a-tier">
            <div>
              <b>VIP Table</b>
              <small>$60, 20 available</small>
            </div>
            <span className="a-toggle" />
          </div>
          <div className="a-add">+ Add ticket type</div>
          <div className="a-sub" style={{ marginTop: "4px" }}>Promo codes</div>
          <div className="a-code">
            <b>FRIENDS20</b>
            <span>20% off</span>
          </div>
          <div className="a-btn">Save tickets</div>
        </div>
        <div className="a-tabs">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <svg className="on" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14 7v10" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        </div>
      </div>
      {/* Screen 3: share */}
      <div className="screen is-next" data-i="2">
        <div className="a-status">
          <span>9:41</span>
          <span className="a-sicons">
            <i />
            <b />
          </span>
        </div>
        <div className="a-body">
          <div className="a-top">
            <span className="a-title">Share</span>
            <span className="a-chip live">LIVE</span>
          </div>
          <div className="a-preview">
            <div className="a-poster sm">
              <span className="p-sun" />
              <span className="p-t">
                ROOFTOP
                <br />
                JAZZ
              </span>
            </div>
            <div>
              <b>Rooftop Jazz Night</b>
              <small>Tickets from $18</small>
            </div>
          </div>
          <div className="a-linkbox">
            <span>fattixx.com/rooftopjazz</span>
            <em>Copy</em>
          </div>
          <div className="a-share">
            <span>
              <i>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="5" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              </i>
              Story
            </span>
            <span>
              <i>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
                </svg>
              </i>
              Message
            </span>
            <span>
              <i>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>
                </svg>
              </i>
              Link
            </span>
            <span>
              <i>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v7M14 20h3" />
                </svg>
              </i>
              QR code
            </span>
          </div>
          <div className="a-stats">
            <div>
              <small>Page views</small>
              <b>1,204</b>
            </div>
            <div>
              <small>Tickets sold</small>
              <b>86</b>
            </div>
          </div>
          <div className="a-toast">
            <i>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A8121A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
            </i>
            New order: 2 × General Admission
          </div>
        </div>
        <div className="a-tabs">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
          </svg>
          <svg className="on" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14 7v10" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        </div>
      </div>
      {/* Screen 4: check-in */}
      <div className="screen is-next" data-i="3">
        <div className="a-status">
          <span>9:41</span>
          <span className="a-sicons">
            <i />
            <b />
          </span>
        </div>
        <div className="a-body">
          <div className="a-top">
            <span className="a-title">Check in</span>
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
              <small>General Admission, checked in</small>
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
        <div className="a-tabs">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          <svg className="on" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14 7v10" />
          </svg>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        </div>
      </div>

    </>
  );
}
