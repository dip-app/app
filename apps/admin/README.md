# DIP Admin portal (V1)

Organizer portal for V1-05, built from the `sandervonk/nextjs-template` setup (Next.js 15, SCSS, strict TypeScript, static export) and styled with the DIP tokens.

## What it does

- Sign in screen (preview personas: organizer and member).
- Events list filtered by Upcoming / Past / Cancelled, classified from timestamps and status.
- Create and edit an event with every `EventDraft` field, validated like the contract: title/description limits, UTC time order, future start on create, venue and coordinate bounds, integer price, capacity bounds, cover from the default catalog.
- Create keeps one `requestId` across retries; edit sends `expectedRevision` and offers "Reload latest" on a conflict; capacity cannot drop below people already going; events can be cancelled and restored, never deleted.

## Mock mode (current)

There are no organizer callables yet (`createEventV1`, `updateEventV1` are specified in `docs/contracts/callables.md`, not implemented). `src/lib/api.ts` defines the `AdminApi` interface and a localStorage-backed mock that enforces the same rules (authorization, requestId dedupe, revision conflicts, server-assigned fields). Swap in a Firebase adapter (Google sign-in, the two callables, admin event reads under reviewed rules) without touching the UI. Visibility in the UI is never the authorization boundary.

V1 mapping: see the [acceptance-test status table](../../docs/milestones/v1/04-organizer-events/README.md#admin-portal-status-against-the-acceptance-tests-november-3). Non-organizers see a "No organizer access" screen; tags are catalog IDs (not labels); cards and the live preview show date, start-end time, duration, address and price.

Open items: the default-image catalog (`src/lib/catalog.ts` holds placeholders until design approves it), RSVP start-time synchronization when times change, and the live Firebase adapter.

## Run

```sh
cd apps/admin
npm install
npm run dev      # http://localhost:3100
npm test         # contract and mock API tests
npm run build    # static export to out/
```

## Deploy (Firebase Hosting)

The portal is a static export (`output: "export"`) served by Firebase Hosting, project `team05-dip`, site `team05-dip` at **https://team05-dip.web.app**. The hosting config is the `hosting` block in the root [`firebase.json`](../../firebase.json) (public dir `apps/admin/out`, `trailingSlash`, `noindex`, `X-Frame-Options: DENY`, long cache on `/_next/static/**`).

What is live is the **mock-mode preview**: sign-in is a local picker and data stays in each visitor's browser, so nothing private is served. It is `noindex`. The event photos are the app's prototype assets with unconfirmed release rights (see [asset provenance](../../docs/design/asset-provenance.md)); keep the URL internal until that is settled.

### Manual deploy

Needs Node 24+, the Firebase CLI, and `firebase login` as someone with Hosting access to `team05-dip`.

```sh
cd apps/admin
npm ci
npm run lint && npm run typecheck && npm test   # must pass first
npm run build                                   # writes apps/admin/out
cd ../..
firebase deploy --only hosting --project team05-dip
```

Check afterwards: `/login/`, `/events/` and `/img/events/fitness.jpg` return 200, and the response has `x-robots-tag: noindex, nofollow`. Deploying is a deliberate, human-triggered action (see root `AGENTS.md`): do not run it as part of routine coding. Always build from a clean `apps/admin/out` (`rm -rf .next out`), because `next build` and `next dev` share `.next` and a running dev server will corrupt the build.

### Preview before going live

```sh
firebase hosting:channel:deploy my-change --project team05-dip --expires 7d
```

This prints a temporary URL and leaves the live site untouched.

### Automatic deploy (CI)

[`.github/workflows/admin.yml`](../../.github/workflows/admin.yml) runs on pull requests and on pushes to `main` that touch `apps/admin/**` or `firebase.json`:

1. `build`: `npm ci`, lint, typecheck, tests, static build, uploads the `out` artifact.
2. `deploy` (only on `main`): deploys that artifact to the live channel **if** the repository secret `FIREBASE_SERVICE_ACCOUNT_TEAM05_DIP` exists; otherwise it prints that it was skipped.

To turn on automatic deploys, an owner creates that secret. Either run `firebase init hosting:github` from the repo root (it creates the service account and secret), or create a service account with the *Firebase Hosting Admin* role, download its JSON key once, and store it as the secret. Treat the key as a credential: never commit it, and rotate it if it leaks. Until the secret exists, merging to `main` does **not** update the live site; deploy manually as above.

### Roll back

Open Firebase console, Hosting, release history for `team05-dip`, and roll back to the previous release, or check out the previous commit, rebuild and redeploy.

### Gotchas

- The root `.gitignore` excludes every `**/lib/` (compiled backend output). `apps/admin/src/lib/` is re-included with `!apps/admin/src/lib/`; if you add another `lib` folder in the portal, check `git status` shows it.
- `devIndicators` is off in `next.config.ts`; the dev server needs a restart after config changes.
