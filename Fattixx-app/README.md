# Fat Tixx Scan Manager (mobile app)

The Fat Tixx door-staff app for Android and iOS, built with Expo (React Native). It is a client of the
Fat Tixx website in the parent folder: every screen talks to `/api/mobile/v1/*` on the Next.js server,
which reuses the same database, ticket and check-in code as the web.

The app does one job, the plan's **Scan Manager**: download tickets, scan, manual check-in, override,
undo a check-in, and live counts. Everything else (creating events, orders, refunds, analytics, marketing,
team, settings, payouts, the admin console) is website-only and is not linked from the app at all.
Attendees are not in the app: they buy and view their tickets on the Fat Tixx website, and an attendee
account is refused at sign-in (server and app both check) with a pointer to the site.

## Who sees what

| Role | Events | Check-in actions |
|---|---|---|
| Organization Admin | Every event of the organisation | Download tickets, scan, manual check-in, override, undo, live counts |
| Organizer | Only the events they manage (created or assigned) | Same, but override and undo only if the Organization Admin granted them |
| Staff / Scanner | Only the events they are assigned to | Download tickets, scan, manual check-in, live counts; override only if granted; no financial data |
| Attendee, platform-only roles (Super Admin, Support, Finance) | Cannot sign in to the app | — |

Access needs an active organisation membership (`src/lib/access.ts` in the app, `appPanelError` in the
website's `src/lib/mobile/http.ts`). Which events a member sees and whether override / undo are allowed is
decided on the server from that membership (`src/lib/authz.ts`), exactly as on the website.

## Screens

| Screen | What it does |
|---|---|
| Splash | Brand-red launch screen with the Fattixx ticket logo, native (`expo-splash-screen` in `app.config.ts`) and in-app (`src/components/Splash.tsx`) while fonts load and the stored session is checked |
| Sign in | Email + password, password reset; the website's AuthShell look (logo, title, white card) |
| Events | The events the member may work (upcoming / past), with live checked-in counts and "Offline ready" / "to upload" tags; the last upcoming list is remembered so the tab opens with no signal |
| Event | Live counts (checked in, still to come, tickets issued), the Scan and Door list actions, the ticket list on this phone (download / update / upload queued check-ins), ticket types (issued / quantity, no prices) and recent scans |
| Scan | Camera QR scanning or a typed code, haptic + colour verdicts, ID-check prompt for age-restricted events; keeps working with no signal (see below) |
| Door list | Search by name, email, ticket or order code; check in by name; undo a check-in or override a refused ticket when the member has that permission, every action logged with their name |
| Account | Profile, email confirmation, organisations and roles, active sessions with remote sign-out, legal links (system browser), sign out |

### Offline scanning

Venues often have no signal at the door, so the scanner does not depend on one (`src/scanner/`):

- **Ticket list on the phone.** The event screen's *Download tickets* button, and opening the scanner
  while online, download the event's ticket list (`GET /scan/:org/:event/snapshot`) into SQLite
  (`expo-sqlite`); the scanner refreshes it every minute and whenever the app returns to the foreground.
  The Events tab marks such events **Offline ready**.
- **Validation without the server.** When the phone is offline, or a scan cannot reach the server, the
  QR is checked locally: the code must be on the list and the SHA-256 of the full signed payload must match
  the stored hash (so a forged QR with a real code fails), the ticket must not be refunded, cancelled or
  transferred, it must be for today on multi-day events, and it must not already be checked in. The verdict
  colours and haptics are the same as online, with "(offline)" in the message.
- **Queued check-ins.** Offline admissions are stored in a queue and uploaded (`POST /scan/:org/:event/sync`)
  as soon as a connection is back, or when staff tap *Upload* on the event screen or the "to upload" strip
  in the scanner. Each has a unique reference, so a retried upload never double-counts. If the same ticket
  was meanwhile admitted on another device or refunded, the server records an **offline conflict** that
  organisers review on the event page of the website; the person is already inside, nothing is undone
  automatically.
- **What is stored.** Only hashes of the QR payloads, never the ticket secret or signature, so a lost phone
  cannot be used to make valid tickets. Lists expire 24 h after the event ends and are deleted on sign-out.
  Queued check-ins survive sign-out so none is lost.

Works the same on Android and iOS; both `expo-sqlite` and `expo-crypto` are included in Expo Go.

## Running it on Windows (Android)

1. Start the website: in `../Fattixx-web` run `npm run dev` (port 3000).
2. `npm install` (first time), then `npx expo start`. No addresses to configure: the app talks to the PC
   it loaded the bundle from, on port 3000, and the website allows its own addresses automatically. If the
   website runs on another port, put `EXPO_PUBLIC_API_PORT=<port>` in `.env` (see `.env.example`).
3. Install **Expo Go** on the Android phone, join the same Wi-Fi as the PC, and scan the QR code in the terminal.
   Expo Go already includes every native module this app uses (camera, secure store, SQLite), so no
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

- Only organisation members can sign in. Super Admin accounts are refused outright (`APP_BLOCKED_ROLES` in
  the website's `src/lib/mobile/http.ts`); Support and Finance accounts get in only through an organisation
  membership of their own. The server rechecks on every request, so a removed member loses access at once.
- The app never shows money: no sales, prices, orders, refunds or settlement, for any role. Those endpoints
  of the mobile API were removed along with the in-app web view.
- The session token is a random 256-bit value stored only in the OS keychain / Keystore (SecureStore) and
  sent as `Authorization: Bearer`. The server stores just its SHA-256; signing out revokes it server-side.
- App sessions last 30 days and appear in the website's account page alongside browser sessions, where
  they can be revoked. Changing the password revokes every session.
- The app never handles payments: ticket sales happen on the website only.
- Release builds are https-only; Android cloud backup of app data is disabled.
- Login and password reset share the website's throttling, account lockout,
  breached-password check and input validation.
