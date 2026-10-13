# Fat Tixx mobile app

The Fat Tixx attendee and door-staff app for Android and iOS, built with Expo (React Native). It is a
client of the Fat Tixx website in the parent folder: every screen talks to `/api/mobile/v1/*` on the
Next.js server, which reuses the same database, checkout, payment, ticket and check-in code as the web.

## What the app does

| Area | Screens |
|---|---|
| Discover | Homepage hero, categories, featured strip, upcoming events with the website's filters and search |
| Event | Details, dates, venue map link, sponsors, ticket picker with add-ons, checkout questions, presale codes, promo codes, virtual waiting room |
| Checkout | 10-minute hold countdown, Stripe PaymentSheet (card, Apple Pay, Google Pay), free orders |
| Tickets | Orders on the account plus guest purchases made on the device, QR codes drawn locally, full-screen door ticket with brightness boost, attendee name edit |
| Account | Sign in, create account, password reset, email confirmation, active sessions with remote sign-out, legal links |
| Scan | Organisers and staff: pick an event, scan QR codes with the camera or type a code, live counts, haptic + colour verdicts; keeps working with no signal (see below) |
| Manage | Organisers, their team and platform staff: per-organisation sales and check-in totals, event list with filters, event dashboard (counts, sales, ticket types, recent scans, publish / unpublish / complete), searchable door list with check-in by name, undo and override, order search with resend; platform admins get the admin dashboard, health signals, organisation and user directories |
| Web (in-app) | Every other organiser and admin page of the website (event editor, ticket types, team, venues, analytics, marketing, payouts, disputes, settings, emails, audit, ...) opens inside the app, signed in automatically through `/app-login` |

### How the in-app web pages sign in

The web screen loads `/app-login?next=<page>` with the app's session token in the `Authorization` header on that
first request only. The server creates an ordinary browser session cookie for the same user, labelled as coming
from the app, and redirects. No token ever appears in a URL, and signing out of the app revokes those browser
sessions too. Links that leave the Fat Tixx site open in the system browser.

### Offline scanning

Venues often have no signal at the door, so the scanner does not depend on one (`src/scanner/`):

- **Ticket list on the phone.** Opening an event's scanner while online downloads its ticket list
  (`GET /scan/:org/:event/snapshot`) into SQLite (`expo-sqlite`) and refreshes it every minute and whenever
  the app returns to the foreground. The Scan tab marks such events **Offline ready**, and the tab itself
  remembers the last event list so it still opens after a restart with no connection.
- **Validation without the server.** When the phone is offline, or a scan cannot reach the server, the
  QR is checked locally: the code must be on the list and the SHA-256 of the full signed payload must match
  the stored hash (so a forged QR with a real code fails), the ticket must not be refunded, cancelled or
  transferred, it must be for today on multi-day events, and it must not already be checked in. The verdict
  colours and haptics are the same as online, with "(offline)" in the message.
- **Queued check-ins.** Offline admissions are stored in a queue and uploaded (`POST /scan/:org/:event/sync`)
  as soon as a connection is back, or when staff tap the "to upload" strip. Each has a unique reference, so a
  retried upload never double-counts. If the same ticket was meanwhile admitted on another device or refunded,
  the server records an **offline conflict** that organisers review on the event page of the website; the
  person is already inside, nothing is undone automatically.
- **What is stored.** Only hashes of the QR payloads, never the ticket secret or signature, so a lost phone
  cannot be used to make valid tickets. Lists expire 24 h after the event ends and are deleted on sign-out.
  Queued check-ins survive sign-out so none is lost.

Works the same on Android and iOS; both `expo-sqlite` and `expo-crypto` are included in Expo Go.

## Running it on Windows (Android)

1. Start the website: in the parent folder run `npm run dev` (MariaDB on port 3307 must be running).
2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to your PC's LAN address, e.g.
   `http://192.168.1.22:3000`. The phone and the PC must be on the same Wi-Fi.
   If your IP differs from the one in the website's `next.config.ts` (`allowedDevOrigins`), add it there.
3. `npm install` (first time), then `npx expo start`.
4. Install **Expo Go** on the Android phone and scan the QR code in the terminal.
   Expo Go already includes every native module this app uses (camera, secure store, Stripe), so no
   Android Studio is needed for day-to-day testing. The Android emulator from Android Studio also works.

## iOS

Development: install Expo Go on an iPhone and scan the same QR code (same Wi-Fi). Building the iOS
binary and testing in the Simulator needs a Mac or EAS Build (`npx eas-cli build -p ios`), which
compiles in Expo's cloud and can submit to App Store Connect.

## Checks

```
npx tsc --noEmit      # typecheck
npx expo lint         # lint
npx expo-doctor       # dependency / config health
```

## Release builds

```
npx eas-cli build -p android --profile production
npx eas-cli build -p ios --profile production
```

`EXPO_PUBLIC_API_URL` must be an `https://` origin for release builds (the app refuses to start otherwise).

## Security notes

- **Super Admin accounts cannot sign in to the app for now** (`APP_BLOCKED_ROLES` in the website's
  `src/lib/mobile/http.ts`). The server refuses the sign-in with a clear message and rejects any app session that
  later gains the role. Support and Finance staff can use the app.

- The session token is a random 256-bit value stored only in the OS keychain / Keystore (SecureStore) and
  sent as `Authorization: Bearer`. The server stores just its SHA-256; signing out revokes it server-side.
- App sessions last 30 days and appear in the website's account page alongside browser sessions, where
  they can be revoked. Changing the password revokes every session.
- Card details never pass through the app or the Fat Tixx server: Stripe's PaymentSheet talks to Stripe.
- Guest purchases are remembered through per-order access tokens, also kept in SecureStore.
- Release builds are https-only; Android cloud backup of app data is disabled.
- Login, registration, password reset and checkout share the website's throttling, account lockout,
  breached-password check and input validation.
