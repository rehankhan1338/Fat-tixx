# Fat Tixx admin console

The platform staff console (Super Admin, Support, Finance) as its own Next.js app. The public site never shows a
staff sign-in: its `/login` turns platform staff away, and every `/admin/*` link on it redirects here.

## How it fits the public site

- **Shared code.** This folder holds only routes. `@/*` resolves to `../Fattixx-web/src/*`, so pages, actions,
  queries and UI components are the same files the public site uses. Dependencies come from
  `../Fattixx-web/node_modules`: the public site's `npm install` links `node_modules` at the repository root to it
  (`Fattixx-web/scripts/link-admin-node-modules.mjs`), so there is nothing to install here.
- **Routes.** `/` is the sign-in page. `/admin/*` are the staff pages (moved here from the public site).
  `/org/*` re-exports the organizer dashboard pages so staff can open any organization from the console
  (the "Open organization panel" buttons). `/api/exports/*` and `/api/uploads/*` re-export the handlers the pages link to.
- **Environment.** `next.config.ts` reads `../Fattixx-web/.env.local` and `../Fattixx-web/.env` as a fallback, so
  one env file serves both servers. A `.env.local` in this folder overrides it. `APP_URL` stays the public site's
  origin (used for links in emails); `ADMIN_URL` is this app's origin and must be set in production.
- **Sessions.** Separate cookie (`fx_admin` here, `fx_session` on the public site), so a console sign-in never shows
  up on the public site, in development as well as in production.

## Commands

From `Fattixx-web/`:

```sh
npm run admin:dev        # http://localhost:3100
npm run admin:build
npm run admin:start
npm run admin:typecheck
npm run admin:lint
```

The same scripts exist in this folder's `package.json` (`npm run dev` here starts the console).

## Deploying

Deploy this folder as its own project with the root directory set to `Fattixx-admin`, "include files outside the
root directory" enabled (the code lives in `../Fattixx-web/src`), the install command run from the public site's
folder (for example `cd ../Fattixx-web && npm ci`, whose postinstall step creates the `node_modules` link at the repository root), and
`ADMIN_URL` set to the console's domain. Point `ADMIN_URL` on the public site's project at the same domain so its
staff links resolve.
