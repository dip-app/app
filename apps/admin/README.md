# DIP Admin portal (V1)

Organizer portal for V1-05, built from the `sandervonk/nextjs-template` setup (Next.js 15, SCSS, strict TypeScript, static export) and styled with the DIP tokens.

## What it does

- Sign in screen (preview personas: organizer and member).
- Events list filtered by Upcoming / Past / Cancelled, classified from timestamps and status.
- Create and edit an event with every `EventDraft` field, validated like the contract: title/description limits, UTC time order, future start on create, venue and coordinate bounds, integer price, capacity bounds, cover from the default catalog.
- Create keeps one `requestId` across retries; edit sends `expectedRevision` and offers "Reload latest" on a conflict; capacity cannot drop below people already going; events can be cancelled and restored, never deleted.
- **Weekly themes** (`/themes/`): the "This Week's Challenge" card on the app's Home. A theme is a `Challenge` document with `type: "weekly"` and `coverImageURL = catalog://theme/<key>`, which picks a bundled illustration and accent colour (`src/lib/themes.ts`, images in `public/img/themes/`; first and only theme: Fitness). The list has Current / Upcoming / Past tabs. Create and edit cover the theme, title, description, tags, goal and unit, points reward, and the weeks.
  - Weeks run Monday 00:00 to Sunday 23:59:59 **Eastern Time** (`src/lib/weeks.ts`), for one or two weeks, so the portal, the seed script and the app agree on "this week" whatever the organizer's own time zone. The pickers are dropdowns of Mondays and Sundays (`<input type="week">` isn't supported in Safari or Firefox), mark weeks that already have a theme as taken, and default a new theme to the first free week from next Monday.
  - One theme per week per company: overlaps are caught before saving and, if someone else got there first, the server's `CHALLENGE_WINDOW_OVERLAP` answer (with `details.conflict`) is shown against the conflicting theme's week. A new theme can start in the week already under way but not in a week that has ended. Once anyone has joined or completed, the start is locked and the end can't move into the past (`WINDOW_CHANGE_BLOCKED`). Counts are server-owned and never sent.
  - Same retry rules as events: one `requestId` per create attempt (a replay returns the same theme), `expectedRevision` on edit with "Reload latest" on a conflict.

## Mock mode and live mode

`src/lib/api.ts` defines the `AdminApi` interface the UI depends on, with two implementations chosen at build time:

- **Mock (default):** `createMockApi` keeps data in the browser and enforces the same rules as the callables (authorization, requestId dedupe, revision conflicts, time lock, server-assigned fields). This is what the hosted preview serves until live mode is configured.
- **Live:** `createFirebaseApi` (`src/lib/firebaseAdapter.ts`) uses Google sign-in, `resolveMembershipV1` on first sign-in, Firestore reads (the event feed, the `tags` catalog) and the `createEventV1`/`updateEventV1` callables. It is selected when `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID` and `NEXT_PUBLIC_FIREBASE_APP_ID` are set (see `.env.example`). Authorization is enforced by the backend; the portal's "No organizer access" screen is only a convenience.

Setting up live mode (once per Firebase project):

1. Register a web app: `firebase apps:create web "DIP Admin" --project team05-dip`, then `firebase apps:sdkconfig web <appId> --project team05-dip` for the config values.
2. Google sign-in is already enabled for the project; `<project>.web.app` is an authorized domain by default.
3. Production callables enforce App Check, so the web app needs a reCAPTCHA Enterprise key registered in App Check (`NEXT_PUBLIC_APPCHECK_SITE_KEY`). For local work use `NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN=true` and register the printed token, or run against the emulators with `NEXT_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1`.
4. Assign organizers with trusted tooling after their first sign-in: set `users/{uid}.role` to `"admin"` (Admin SDK or the Firebase console). Clients cannot write roles.
5. Build with the variables set (`.env.local` or the environment) and deploy as described below.

Weekly themes in live mode read `companies/{companyId}/challenges` (type `weekly`) and write only through `createChallengeV1` / `updateChallengeV1` (request `{ contractVersion: 1, companyId, requestId | challengeId + expectedRevision, draft }`). Those callables and the challenge read rules come from the weekly theme backend work (`feature/weekly-theme-backend`); until they are deployed, the live portal's Weekly themes screen fails with the backend's answer, and the mock is the way to try it. Error mapping keeps the server's `details.reason` on `ApiError.reason` and an overlap's `details.conflict` on `ApiError.conflict`.

Tests: `npm test` runs the unit tests. `npm run test:admin:live` (repo root) runs the adapter end to end against the Auth, Firestore and Functions emulators; it is part of CI. The weekly theme part of that suite skips itself until `gcp/functions/src/index.ts` exports `createChallengeV1`.

## Run

```sh
cd apps/admin
npm install
npm run dev      # http://localhost:3100
npm test         # contract and mock API tests
npm run build    # static export to out/
```

## Deploy (Firebase Hosting)

The portal is a static export (`output: "export"`) served by Firebase Hosting, project `team05-dip`, site `letsdip` at **https://letsdip.work/admin/**. The hosting config is the `hosting` block in the root [`firebase.json`](../../firebase.json) (public dir `apps/admin/out`, `trailingSlash`, `noindex`, `X-Frame-Options: DENY`, long cache on `/_next/static/**`).

What is live is the **live-mode portal** (since November 4, 2026): Google sign-in against `team05-dip`, events read through Firestore rules and written only through `createEventV1`/`updateEventV1`. The site itself serves no private data; every read and write is authorized by the backend. It is `noindex`. A build without the `NEXT_PUBLIC_FIREBASE_*` variables is the mock-mode preview instead, so **always build with the live config before deploying** (below). The event photos are the app's prototype assets with unconfirmed release rights (see [asset provenance](../../docs/design/asset-provenance.md)); keep the URL internal until that is settled.

### Manual deploy

Needs Node 24+, the Firebase CLI, and `firebase login` as someone with Hosting access to `team05-dip`. Put the live configuration in `apps/admin/.env.local` first (gitignored; see `.env.example` and the production values below), otherwise the build is the mock preview and would replace the live portal.

```sh
cd apps/admin
npm ci
npm run lint && npm run typecheck && npm test   # must pass first
npm run build                                   # writes apps/admin/out
cd ../..
firebase deploy --only hosting --project team05-dip
```

Check afterwards: the login page shows "Sign in with Google" (the mock says "Sign in as organizer"), `/login/`, `/events/` and `/img/events/fitness.jpg` return 200, and the response has `x-robots-tag: noindex, nofollow`. Deploying is a deliberate, human-triggered action (see root `AGENTS.md`): do not run it as part of routine coding. Always build from a clean `apps/admin/out` (`rm -rf .next out`), because `next build` and `next dev` share `.next` and a running dev server will corrupt the build.

### Preview before going live

```sh
firebase hosting:channel:deploy my-change --project team05-dip --expires 7d
```

This prints a temporary URL and leaves the live site untouched.

### Automatic deploy (CI)

[`.github/workflows/admin.yml`](../../.github/workflows/admin.yml) runs on pull requests and on pushes to `main` that touch `apps/admin/**` or `firebase.json`:

1. `build`: `npm ci`, lint, typecheck, tests, static build, uploads the `out` artifact.
2. `deploy` (only on `main`): deploys that artifact to the live channel **if** the repository secret `FIREBASE_SERVICE_ACCOUNT_TEAM05_DIP` exists and the `NEXT_PUBLIC_FIREBASE_*` repository variables are set; otherwise it prints that it was skipped. The build job reads those variables (public web-app identifiers, already set), so CI builds are live-mode and a deploy can never replace the live portal with the mock.

To turn on automatic deploys, an owner creates that secret. Either run `firebase init hosting:github` from the repo root (it creates the service account and secret), or create a service account with the *Firebase Hosting Admin* role, download its JSON key once, and store it as the secret. Treat the key as a credential: never commit it, and rotate it if it leaks. Until the secret exists, merging to `main` does **not** update the live site; deploy manually as above.

### Roll back

Open Firebase console, Hosting, release history for `team05-dip`, and roll back to the previous release, or check out the previous commit, rebuild and redeploy.

### Gotchas

- The root `.gitignore` excludes every `**/lib/` (compiled backend output). `apps/admin/src/lib/` is re-included with `!apps/admin/src/lib/`; if you add another `lib` folder in the portal, check `git status` shows it.
- `devIndicators` is off in `next.config.ts`; the dev server needs a restart after config changes.

## Production configuration (team05-dip, November 4, 2026)

- **Backend:** `createEventV1`, `updateEventV1`, `resolveMembershipV1` and the event read rules are deployed.
- **Web app:** "DIP Admin", app ID `1:28423377357:web:a19e30f455328ae322b484` (public identifier; `firebase apps:sdkconfig WEB <appId> --project team05-dip` prints the rest of the config).
- **App Check:** a reCAPTCHA Enterprise key ("DIP Admin web", domains `letsdip.work`, `www.letsdip.work`, `team05-dip.web.app`, `team05-dip.firebaseapp.com`, `localhost`) is registered for the web app (`NEXT_PUBLIC_APPCHECK_SITE_KEY`, a public site key). Production callables enforce App Check.
- **Repository variables:** the five `NEXT_PUBLIC_*` values above are GitHub Actions variables (not secrets).
- **First organizer:** one maintainer account has `users/{uid}.role == "admin"`, assigned with trusted tooling. Assign more the same way (Admin SDK or the Firebase console); clients cannot write roles. To revoke, set the role back to `"member"`.
- **Not yet verified in production:** a real browser sign-in followed by an event create/edit (the adapter is proven end to end against the emulators in CI, and the live site loads and passes the App Check exchange).
