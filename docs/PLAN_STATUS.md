# Fat Tixx: project plan status

Checked against *Fat_Tixx_Project_Plan.docx* on 2026-10-01. ✅ built and tested · 🟡 partly built (the gap is stated) · ⛔ not built (the reason is stated).

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
| Legal documents (11.6) | ✅ Drafts of all five documents. **Legal counsel must review them** | `/terms`, `/privacy`, `/refunds`, `/ticketing-terms`, `/organizer-agreement` |
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

## Phase 3 (scale & monetization): not started

| Plan item | Why it is not built |
|---|---|
| Automated organizer payouts | Needs Stripe Connect and the money-flow decisions in 7.2 |
| FATTIXX iOS / Android app | 🟡 Built 2026-10-04 as an Expo app in `Fat-Tixx-App/` (discover, event pages, Stripe checkout, tickets with QR, account, door scanner, Manage tab for organisers / staff / admins with native sales, attendee and order screens, and every other dashboard page inside the app via the `/app-login` sign-in handoff) on top of the Bearer-token API under `src/app/api/mobile/v1`. Offline scanning added 2026-10-04 (ticket list stored in SQLite with payload hashes only, queued check-ins synced with conflict flagging, same code on Android and iOS). Still to do: device testing on iOS, App Store / Play publishing under Chapman Products Co. accounts |
| Apple / Google Wallet passes | Needs Apple Pass Type ID certificate and Google Wallet issuer account |
| White-label, subscriptions, sponsorship marketplace, self-service ad portal, expanded ad targeting | Phase 3 product scope; the data model (campaigns, org scoping) is ready for it |

## Decisions still open (plan section 7.2 / 18)

Stripe Connect vs. a single account, the seller of record, chargeback fee split, payout timing and reserve, cancelled-event liability, refundability of fees, attendee-data ownership, the CAPTCHA provider, and the mobile app approach. Phase 1 currently assumes Fat Tixx is seller of record on a single Stripe account.
