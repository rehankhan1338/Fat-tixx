# Fat Tixx: project plan status

Checked against *Fat_Tixx_Project_Plan.docx* on 2026-10-01. Paths are inside `Fattixx-web/` (the public site and shared code); the admin console is `Fattixx-admin/` and the mobile app `Fattixx-app/`. ✅ built and tested · 🟡 partly built (the gap is stated) · ⛔ not built (the reason is stated).

## Phase 1 (initial launch)

| Plan item | Status | Where |
|---|---|---|
| Auth, guest checkout, roles incl. Staff/Scanner, per-org scope (3, 4.1, 12) | ✅ | `src/lib/auth`, `src/lib/authz.ts` |
| Email verification, claim guest orders later (5.3) | ✅ Orders are claimed only **after** the address is confirmed | `/verify-email/[token]` |
| Organizations, events, cancel / postpone (5.2) | ✅ | `/org/[slug]/events` |
| Ticket types, inventory, per-order limits, tables, comps (5.2) | ✅ | Ticket types tab |
| Per-account purchase limits (6.2) | ✅ "Limit per person" per ticket type | `createPendingOrder` |
| Checkout holds, no oversell, duplicate-safe, price snapshot (6.1) | ✅ | `src/lib/orders/checkout.ts` |
| Bot protection on checkout & account creation (6.2, 12) | 🟡 Honeypot, fill-time check and rate limits. No CAPTCHA provider (decision needed) | `src/lib/security/bot.ts` |
| Card / Apple Pay / Google Pay, all-in pricing, webhooks (7.1, 11.1) | ✅ Needs Stripe keys. Permissions-Policy now allows Stripe's Payment Request | `/checkout/[code]`, `src/proxy.ts` |
| Refunds, disputes, settlement statement (7.3–7.5) | ✅ | Order page, Admin → Disputes, Settlement |
| Daily reconciliation with Stripe (7.5) | ✅ Automatic daily run; Finance emailed on discrepancies | `src/lib/jobs.ts` |
| Accounting export, tax by jurisdiction (7.5, 11.2) | ✅ CSV | Admin → Payments → Reconcile |
| Signed QR codes, one-time scan, clear states, overrides logged (8.1) | ✅ | `src/lib/checkin` |
| Offline scanning, sync, conflict flagging (8.2) | ✅ Device copy holds hashes only; conflicts shown on the event page | Scanner, `src/lib/checkin/offline.ts` |
| Printable door list (8.2) | ✅ | Event → Door list |
| Transactional email, SPF/DKIM/DMARC (9) | 🟡 Built; DNS records are set at the mail provider when going live | `src/lib/email.ts` |
| Event reminders (5.3) | ✅ About 24 h before, email (+ SMS if opted in) | Jobs |
| Emails not lost in spikes: automatic retries (13.1) | ✅ Exponential backoff, 8 attempts | `retryDueEmails` |
| Tax configuration, fee transparency (11.1, 11.2) | ✅ | Venue / event settings |
| WCAG 2.1 AA (11.3) | 🟡 Labelled forms, keyboard dialogs, live regions, contrast-safe theme. A formal audit is still needed | |
| Privacy: access / delete requests, cookie consent, retention (11.5) | ✅ Self-service export and delete; consent banner gates pixels | Account page |
| Legal documents (11.6) | ✅ Terms of Service (with the Organizer Agreement and refund rules as sections) and Privacy Policy from the design handoff, rendered from `content/legal/*.md`. `/refunds`, `/ticketing-terms` and `/organizer-agreement` redirect into the Terms. **Legal counsel must review them**; bracketed placeholders are highlighted on the pages | `/terms`, `/privacy` |
| Monitoring, backups, load test, security test (13) | 🟡 Built: `/api/health`, Admin → Monitoring, verified backup/restore, load-test script. Still to do: external uptime alerts and a pen test | `scripts/` |
| Automated tests for holds, payments, refunds, check-in (13.2) | ✅ Vitest + Playwright | `tests/` |

## Phase 2 (platform expansion)

| Plan item | Status |
|---|---|
| Organizer onboarding with identity verification | ✅ `/sell` application and staff review. Automated identity checks come with Stripe Connect |
| Interim payout process | ✅ Manual payouts with approval (Admin → Payouts) |
| Advanced analytics & reporting | ✅ Event Analytics tab, org Analytics page, CSV exports |
| Promo codes, presale access codes, discounts | ✅ |
| Attendee refund requests | ✅ |
| Improved check-in tools | ✅ Offline mode, conflict review, check-in timing chart |
| Ticket transfers | ✅ |
| Waitlists, add-ons, multi-day passes, recurring events | ✅ |
| Door sales / box office | ✅ |
| Tracking pixels, promoter links, embeddable checkout | ✅ |
| SMS ticket delivery & reminders | ✅ Needs Twilio keys; logs only until then |
| Virtual waiting room | ✅ |
| Advertising & sponsorship system (section 14) | ✅ Placements, campaigns, targeting, scheduling, rotation, tracking, reports, organizer sponsor ads with approval |

## Public website design (applied 2026-10-12)

The Fattixx design handoff (`fattixx-web`) is applied to every public page, on top of the real data and checkout. Admin and organizer dashboards are untouched; the design is scoped to the `.fx-home` wrapper (`src/app/globals.css`, `src/styles/fx/`).

| Page | Status | Notes |
|---|---|---|
| `/` homepage | ✅ | Photo hero, hosting walkthrough, featured strip, event browser, organizer band. Copy and photos are the design handoff's, kept as data in `src/lib/site-content/schema.ts` (the Super Admin → Website editor was removed on 2026-10-16: the plan does not ask for one); `{fee}` / `{processing_clause}` placeholders pull the live fee figures |
| `/events` | ✅ | Featured carousel and filters (date, price, category, location within N miles); `?q=`, `?when=`, `?price=`, `?cat=` deep links |
| `/events/<slug>` | ✅ | Design layout with the real ticket types, add-ons, questions, promo and access codes, waitlist and waiting room inside the ticket pop-up; `/e/<slug>` redirects here |
| `/o/<org slug>` | ✅ | Organizer page: upcoming and past public events, bio and website from the organization settings. Follow is browser-local only |
| `/create` | ✅ | The public create flow (the dashboard's own "New event" page, `/org/<slug>/events/new`, keeps the event form's exact fields but is built with this page's design: cover dropzone, category pills, segmented choices, switches and folds; it posts to the same `createEvent` action as before and lands on the new event's page). Opened with `?org=<slug>` it embeds in the dashboard shell with the organization preselected; verified organizations get Publish / Save as draft. Draft saved in the browser; signing in saves it under the organizer's organization (new organizers get an organization created and the event stays a draft until they publish it). Every field on the page is a stored event field (the design's gallery, lineup, video and password fields were dropped; every field of the dashboard's event form is on the page: saved venues (Dashboard → Venues, taking the venue's time zone and tax rate) or a new venue, the full time-zone list, doors-open time, capacity, waitlist, age, ticket transfers, public / link-only / private visibility, refund policy incl. N days before, tax override and label, who pays the fees (default from Admin → Settings) and, for Super Admins, "feature on the homepage"; Super Admins can create from any organization's dashboard). The category list comes from Super Admin → Fees & Settings → Event categories, as do the homepage pills, the events filter, the dashboard form and the mobile app (`/api/mobile/v1/config`) |
| `/pricing`, `/pro` | ✅ | Fee calculator and comparison use the live platform fee settings (there is no fee cap). Pricing-page copy, the three rules, the other platform's comparison rates, the FAQ, the call to action and the shared footer are data in `src/lib/site-content/schema.ts` (no admin editor; see `/` above). Pro is a marketing page; "Get Pro" leads to the organizer application |
| Checkout, orders, tickets, account, sign-in, organizer / staff dashboards | ✅ | Keep their existing components; the organizer / staff panels use the design's top header (logo, page links as pills, organization switcher, user menu) instead of a sidebar (`AppShell`), and every shadcn component inside the public chrome and the panels takes the design's cards, fields, pills, tabs and dialogs through `src/styles/fx/app-skin.css` and the token overrides in `globals.css`. The Super Admin area (`AdminShell`) is deliberately unchanged |
| Not implemented from the design | ⛔ | Pro branding (own header, colors, domain), Pro badges, organizer social links, venue address lookup / geocoding, server-side follows and saved events |

## Phase 3 (scale & monetization): not started

| Plan item | Why it is not built |
|---|---|
| Automated organizer payouts | Needs Stripe Connect and the money-flow decisions in 7.2 |
| FATTIXX iOS / Android app (Scan Manager) | 🟡 Built 2026-10-04 as an Expo app in `Fattixx-app/` on top of the Bearer-token API under `src/app/api/mobile/v1`; scoped 2026-10-14 to the plan's Scan Manager only: sign-in for Organization Admins (every event of the organisation), Organizers (their events; override / undo only if the Organization Admin allows) and Staff / Scanners (assigned events, no financial data), each event with live counts, camera scanner, door list (manual check-in, override, undo) and the ticket list downloaded for offline scanning. Attendees cannot sign in (they buy and view tickets on the website), and nothing in the app links to the website's dashboard, admin console, analytics, marketing, orders or settlement pages (the in-app web view and `/app-login` handoff were removed). Offline scanning since 2026-10-04 (ticket list stored in SQLite with payload hashes only, queued check-ins synced with conflict flagging, same code on Android and iOS). Still to do: device testing on iOS, App Store / Play publishing under Chapman Products Co. accounts |
| Apple / Google Wallet passes | Needs Apple Pass Type ID certificate and Google Wallet issuer account |
| White-label, subscriptions, sponsorship marketplace, self-service ad portal, expanded ad targeting | Phase 3 product scope; the data model (campaigns, org scoping) is ready for it |

## Decisions still open (plan section 7.2 / 18)

Stripe Connect vs. a single account, the seller of record, chargeback fee split, payout timing and reserve, cancelled-event liability, refundability of fees, attendee-data ownership, the CAPTCHA provider, and the mobile app approach. Phase 1 currently assumes Fat Tixx is seller of record on a single Stripe account.
