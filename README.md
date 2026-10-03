# Fat Tixx

Ticketing and event-management platform (web). This repository implements **Phase 1** of the Fat Tixx
project plan: organizations and roles, events and ticket types, all-in pricing, checkout with inventory
holds, Stripe payments, signed QR tickets, check-in scanning, orders and refunds, settlement statements,
fee and tax configuration, email delivery and a full audit trail. Product requirements live in `docs/`.

## Stack

| Layer      | Choice                                                            |
|------------|-------------------------------------------------------------------|
| App        | Next.js 16 (App Router, Server Actions, TypeScript)               |
| UI         | shadcn/ui (Base UI primitives) + Tailwind CSS 4, light theme (dark variants kept; add `dark` to `<html>` to switch) |
| Database   | MariaDB / MySQL (XAMPP locally), plain SQL migrations             |
| Payments   | Stripe Payment Element + webhooks (single platform account)       |
| Email      | Any SMTP server (Nodemailer); every message logged in an outbox   |
| Passwords  | Argon2id + breached-password check                                |

## First-time setup (Windows + XAMPP)

1. Start **Apache** and **MySQL** in the XAMPP control panel.
2. Install dependencies and create the database, tables and a least-privilege DB user:

   ```bash
   npm install
   npm run db:setup
   ```

   This writes `.env.local` (DB credentials, QR signing key). It connects as XAMPP's `root` with an empty
   password on port `3307`; override with `DB_ADMIN_USER`, `DB_ADMIN_PASSWORD`, `DB_HOST`, `DB_PORT` if yours differ.
   Browse the `fattixx` database at http://localhost/phpmyadmin.

3. Create the Super Admin account:

   ```bash
   npm run admin:create
   ```

4. Run the app and sign in at http://localhost:3000/login:

   ```bash
   npm run dev
   ```

Re-running `npm run admin:create` with the same email resets that account's password and revokes its sessions.
Re-running `npm run db:setup` applies any new migration in `db/migrations/`.

## Optional integrations (.env.local)

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Card, Apple Pay and Google Pay payments. Without them only free / complimentary / box-office orders work. |
| `STRIPE_WEBHOOK_SECRET` | From `stripe listen --forward-to localhost:3000/api/stripe/webhook`. Makes payment confirmation, dashboard refunds and disputes flow back automatically. |
| `SMTP_URL`, `MAIL_FROM` | Real email delivery, e.g. `smtp://user:pass@smtp.example.com:587`. Without it, emails are recorded under **Admin → Emails** and invitation links are shown on screen. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | SMS ticket links and reminders for buyers who opt in. Without them texts are only logged under **Admin → Emails**. |
| `CRON_SECRET` | Bearer token for `GET /api/cron` when an external scheduler runs the background jobs. Generated per process if unset. |
| `JOBS_DISABLED=true` | Turn off the built-in every-minute job scheduler (use with an external cron, e.g. on Vercel). |
| `TRUST_PROXY=true` | Only behind a reverse proxy you control; reads the client IP from `X-Forwarded-For`. |

Copy `.env.example` for the full list.

## Roles (per the project plan)

| Role | Where they work | What they can do |
|---|---|---|
| **Super Admin** | `/admin` | Everything: create, edit and delete organizations, events (even with orders), orders, tickets and users; platform fees, emails, audit log, security. |
| **Support / Finance** | `/admin` (reduced) | Platform staff roles for order lookup and money operations. |
| **Organization Admin** | `/org/<slug>` | Team & permissions, venues, all events, orders, refunds, settlement, organization profile. |
| **Organizer** | `/org/<slug>` | Events they created or are assigned to; refunds / overrides only if granted. |
| **Staff / Scanner** | `/org/<slug>/scan` | Check-in only, on assigned events. No financial data. |
| **Attendee** | public site, `/account` | Browse, buy as guest or with an account, view QR tickets, request refunds when the policy allows. |

Roles are scoped per organization and enforced on the server for every page and every action.

## What is implemented

A line-by-line check of the project plan against the code is in [docs/PLAN_STATUS.md](docs/PLAN_STATUS.md).

### Phase 1

- **Organizations**: created by Super Admin, first admin invited by a one-time password link, per-org fee overrides, suspension.
- **Team**: Org Admin / Organizer / Staff with fine-grained permissions (refunds, override, undo, all-events access); assignment per event; removal ends access immediately.
- **Venues**: address, time zone, capacity, admissions/sales tax rate (e.g. SC 5%).
- **Events**: image, dates in the venue time zone, doors, capacity, public / unlisted / **private (secret key in the link, rotatable)**, age restriction, fee mode (buyer pays / organizer absorbs), tax override, refund policy, transfers flag; draft → publish → complete; **postpone** (tickets stay valid, everyone notified) and **cancel** (bulk refund + bulk notification); **duplicate** to another date and **recurring series** (daily / weekly / every 2 weeks / monthly, copies carry schedule, ticket types, add-ons and questions; the public page links the dates).
- **Multi-day events**: a Schedule tab turns an event into several days; ticket types are either **multi-day passes** (admitted once per day) or valid for one day only (the scanner reports "wrong day").
- **Ticket types**: General, VIP, Table (one QR per seat), Complimentary; price, quantity, min/max per order, sales window, hidden types for door sales, **presale / access codes** that unlock hidden types on the event page.
- **Add-ons**: parking, merchandise, upgrades — sold with tickets (own inventory, holds and per-order limits, no QR), shown on orders, the scanner, the door list and the settlement statement.
- **Checkout questions**: any number per event (short / long answer, choice list, checkbox, required or optional); answers are stored with the order.
- **Waitlist**: buyers join when a ticket type sells out; organizers release tickets to the oldest entries by email; a purchase marks the entry converted.
- **Public site**: listing, event page with **all-in prices** (FTC rule), Open Graph tags and schema.org Event markup, guest checkout.
- **Checkout**: 10-minute inventory hold with countdown, transactional row locks so tickets are never oversold, duplicate-safe payment confirmation, free orders without Stripe, Stripe Payment Element for paid orders, idempotent webhook.
- **Tickets**: HMAC-signed QR codes (verifiable offline), full-screen ticket page, confirmation email with links, "Find my tickets" magic link, attendee names editable by buyer.
- **Check-in**: camera scanner (jsQR) with sound/vibration, clear states (valid, already used, refunded, cancelled, wrong event, wrong day, invalid), add-ons to hand over shown on a valid scan, ID prompt for age-restricted events, manual search & check-in, permissioned **override** and **undo** with reasons, live counts across devices, recent-scan log, printable **door list** fallback.
- **Orders**: search by order number, buyer, attendee or ticket code; resend tickets; edit attendee details; full and partial **refunds** (Stripe or recorded), tickets voided and inventory returned on full refund; complimentary and box-office orders issued by staff.
- **Money**: per-event **settlement statement** (gross, refunds, fees, tax, net payout), printable; platform dashboard with 30-day totals.
- **Platform settings**: platform fee % and fixed fee, processing fee estimate, default fee mode, hold minutes, platform name, support email.
- **Communications**: transactional emails (tickets, refunds, cancellations, postponements, invitations, password links), organizer broadcast to ticket holders, marketing opt-in captured at checkout.
- **Security**: Argon2id, breached-password check, progressive lockout, hashed server-side sessions, CSRF checks, strict CSP with nonces, security headers, least-privilege DB user, immutable audit log of every administrative, financial and check-in action.
- **Offline scanning**: the scanner downloads the event's tickets to the device (IndexedDB; each ticket stored only as a hash of its signed QR, so a lost device cannot mint tickets), keeps validating with no connection, queues check-ins and syncs them when the connection returns. A ticket admitted on two offline devices, or refunded meanwhile, is flagged as an **offline conflict** on the event page for review. A service worker lets the scanner page reopen offline; sign-out wipes the device copy.
- **Email verification**: new accounts confirm their address; guest orders bought with that email are attached only after confirmation.
- **Background jobs** (every minute, in-process or via `/api/cron`): hold expiry, **automatic email retries** with exponential backoff, **event reminders** ~24 h before, and a **daily Stripe reconciliation** that emails Finance when it finds discrepancies.
- **Bot protection & limits**: honeypot + fill-time check and per-IP rate limits on checkout, registration and organizer applications; **per-person limits** per ticket type across orders.
- **Finance exports**: accounting CSV (sales, refunds, disputes with fees and tax split out) and **tax by jurisdiction** CSV (state / city / event, net of refunds) under Admin → Payments.
- **Privacy**: "Download my data" (JSON) and self-service account deletion (anonymized; financial records kept) on the account page; Organizer Agreement and Ticketing Terms pages.
- **Operations**: `/api/health` for uptime monitors, `npm run db:backup -- --verify` (backup + test restore), `npm run load-test`.

### Public homepage

The approved Fattixx homepage design (nav with search and auto-location, 3D ticket hero, scroll-driven "How it works" phone, category pills, featured photo strip, upcoming-events browser, organizer band, footer) lives in `src/components/home`, with its animated effects in `src/styles/fx-home` (scoped under `.fx-home` so they never affect the admin UI). It shows real published events: lowest all-in price, venue city, organizer, image and link. Organizers pick a **category** on the event form, a Super Admin can **feature** an event on the homepage, and venues accept optional latitude / longitude for "events near you". Until the first event is published, the design's sample events are shown with a "Preview" tag. The organizer band's fee figures come from Admin → Fees & Settings.

### Phase 2

- **Promo codes**: percent or amount off per ticket, limited to ticket types, validity window, max uses enforced under concurrency; shown on checkout, receipts and settlement.
- **Promoter / affiliate links** (`/r/<code>`) with click counts and UTM attribution of orders; UTM / channel report per event.
- **Analytics**: sales per day, ticket-type mix, checkout conversion, returning buyers, channels, promo performance, check-ins per 15 minutes; organization-wide trends; CSV exports.
- **Embeddable checkout widget**: `<script src="…/embed.js" data-event="slug">`; ticket selection in an iframe, payment continues on Fat Tixx in a new tab.
- **Sponsors & modular ad system**: event sponsors with logos and visibility windows; ad campaigns as data (draft / active / paused, scheduled / expired by date), named placements (event list, event page, order confirmation, ticket dashboard, organizer dashboard, check-in dashboard, emails), targeting (state, city, age-restricted, signed-in, days before event), priority and weighted rotation, impression (in-view) and click tracking, CTR reports and export. Organizers submit sponsor ads for their events; a Super Admin approves them. No ads or third-party scripts on payment pages.
- **Virtual waiting room** for high-demand on-sales (people per minute, first come first served, enforced again at checkout).
- **Organizer onboarding with verification**: public `/sell` application, staff review queue, approval creates a verified organization.
- **SMS** ticket links and reminders (Twilio), opt-in at checkout.
- **Tracking pixels** (Meta Pixel, GA4) per organization, consent-gated, event pages only.
- Already in Phase 1 work: ticket transfers, waitlists, add-ons, multi-day passes, recurring events, door sales, attendee refund requests.

## Not built yet

These need decisions or accounts outside the code (see docs/PLAN_STATUS.md):
Stripe Connect organizer payouts (automated payouts, Phase 3), white-label organizer sites, organizer subscription plans,
Apple / Google Wallet passes (need Apple / Google issuer certificates), the native FATTIXX Scan Manager iOS / Android app
(the web scanner works offline in the meantime), a sponsorship marketplace / self-service advertiser portal, and a CAPTCHA
provider. Pen test, legal / accounting review and production hosting are launch tasks, not code.

## Testing

| Command | What it runs |
|---|---|
| `npm test` | **Vitest** unit tests (pricing, time zones, slugs, crypto, password policy, signed QR codes, CSV safety) and **database integration tests** (concurrent inventory holds, oversell protection, hold expiry, ticket issuance, promo codes under concurrency, per-person limits, offline check-in sync and conflicts, reminders, email retries, ad selection / targeting / tracking) against a separate `fattixx_test` database. |
| `npm run test:e2e` | **Playwright** browser tests in Chrome: authentication and security headers, the complete platform flow (organization → venue → event → tickets → publish → guest purchase → scanning → resend → cancellation), platform staff roles, offline scanning with sync and conflict review, promoter link + promo checkout, ad campaigns, organizer applications, embed headers, and a smoke pass over every page that fails on any console error. |
| `npm run test:all` | typecheck + lint + unit + e2e |

One-time setup for the integration database: `DB_NAME=fattixx_test node scripts/db-setup.mjs`
(PowerShell: `$env:DB_NAME='fattixx_test'; node scripts/db-setup.mjs`).
The e2e suite starts the dev server if it is not running, creates its own Super Admin (`e2e-admin@fattixx.local`)
and removes everything it created afterwards. Reports land in `tests/e2e/.report`.

## Project layout

```
db/migrations/           SQL migrations, applied in order by scripts/db-setup.mjs
scripts/                 db-setup.mjs (database, user, migrations) · create-super-admin.mjs
src/proxy.ts             security headers, CSP nonce, CSRF origin check, /admin redirect
src/lib/auth/            sessions, login/password actions, guards
src/lib/authz.ts         per-organization roles and event access rules
src/lib/orders/          checkout (holds, pricing, ticket issuance), actions (refunds, comps, cancel/postpone), queries
src/lib/checkin/         scan / manual / override / undo
src/lib/events/          venues, events, ticket types
src/lib/payments/        Stripe client · src/app/api/stripe/webhook
src/lib/email.ts         outbox + SMTP · src/lib/tickets.ts  signed QR payloads
src/app/admin/**         Super Admin panel · src/app/org/[slug]/**  organization panel
src/app/…                /, /events/[slug], /checkout/[code], /orders/[code], /t/[code], /tickets/find, /account
src/components/ui/       shadcn/ui components (owned source)
tests/unit/              Vitest unit + DB integration tests · tests/e2e/  Playwright specs
uploads/                 event and organization images (served by /api/uploads)
```

## Scripts

| Command                | Purpose                                            |
|------------------------|----------------------------------------------------|
| `npm run dev`          | development server on http://localhost:3000         |
| `npm run db:setup`     | create DB, app user, apply pending migrations       |
| `npm run admin:create` | create or reset a Super Admin                       |
| `npm run db:backup`    | gzip backup to backups/ (add `-- --verify` to test-restore it) |
| `npm run db:restore`   | restore a backup into a new database               |
| `npm run load-test`    | latency / error-rate check against targets (staging) |
| `npm run typecheck`    | TypeScript check                                    |
| `npm run lint`         | ESLint                                              |
| `npm run build`        | production build                                    |
#   F a t - t i x x  
 