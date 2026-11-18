# DIP Admin portal (V1)

Organizer portal for V1-05, built from the `sandervonk/nextjs-template` setup (Next.js 15, SCSS, strict TypeScript, static export) and styled with the DIP tokens.

## What it does

- Sign in screen: value statement (events, albums and moderation, attendees, members and roster, bulk import, challenge review), a solid "Sign in with Google" button ("Sign in as organizer" in the mock), an outlined access note and an animated cluster of the app's own avatar characters (`public/img/avatars/`, regenerate with `python3 scripts/export-admin-avatars.py`; motion is off under Reduce Motion). The portal is light-only, so the page stays light in dark mode.
- Page metadata: `src/lib/seo.ts` and `src/app/layout.tsx` (Next metadata API: title template, description, canonical `https://letsdip.work/admin/`, Open Graph and Twitter with absolute URLs, light/dark theme-color, favicon set, manifest); the login page has its own title and description. The share image is `public/img/og-admin.jpg` (1200x630) and the favicon/manifest files are in `public/img/admin/`, both built by `python3 scripts/make-og-images.py` (also writes the landing page's `apps/landing/img/og.jpg` and favicons). `robots` stays noindex; the whole site is also noindex through the `X-Robots-Tag` header in `firebase.json`.
- Events list filtered by Upcoming / Past / Cancelled, classified from timestamps and status.
- Create and edit an event with every `EventDraft` field, validated like the contract: title/description limits, UTC time order, future start on create, venue and coordinate bounds, integer price, capacity bounds, cover from the default catalog.
- Create keeps one `requestId` across retries; edit sends `expectedRevision` and offers "Reload latest" on a conflict; capacity cannot drop below people already going; events can be cancelled and restored, never deleted.
- **Weekly themes** (`/themes/`): the "This Week's Challenge" card on the app's Home. A theme is a `Challenge` document with `type: "weekly"` and `coverImageURL = catalog://theme/<key>`, which picks a bundled illustration and accent colour (`src/lib/themes.ts`, images in `public/img/themes/`; nine broad themes: Fitness, Outdoors, Food & Drink, Arts & Crafts, Games, Music, Learning, Volunteering, Wellness; copy and defaults in `docs/design/theme-catalog.md`). The list has Current / Upcoming / Past tabs. Create and edit cover the theme, title, description, tags, goal and unit, points reward, and the weeks.
  - Weeks run Monday 00:00 to Sunday 23:59:59 **Eastern Time** (`src/lib/weeks.ts`), for one or two weeks, so the portal, the seed script and the app agree on "this week" whatever the organizer's own time zone. The pickers are dropdowns of Mondays and Sundays (`<input type="week">` isn't supported in Safari or Firefox), mark weeks that already have a theme as taken, and default a new theme to the first free week from next Monday.
  - One theme per week per company: overlaps are caught before saving and, if someone else got there first, the server's `CHALLENGE_WINDOW_OVERLAP` answer (with `details.conflict`) is shown against the conflicting theme's week. A new theme can start in the week already under way but not in a week that has ended. Once anyone has joined or completed, the start is locked and the end can't move into the past (`WINDOW_CHANGE_BLOCKED`). Counts are server-owned and never sent.
  - Same retry rules as events: one `requestId` per create attempt (a replay returns the same theme), `expectedRevision` on edit with "Reload latest" on a conflict.

## Admin tools (V2: members, roster, import, albums, attendees, audit)

Tickets #121 to #126. All of it sits behind `AdminOpsApi` (`src/lib/adminApi.ts`), implemented by `adminMock.ts` (same rules as the callables: role and tenant checks, revisions, request-ID idempotency, last-admin protection, capacity) and `adminLive.ts` (Firestore reads, callables, Storage blobs). Callable names live in `ADMIN_CALLABLES` (`adminTypes.ts`) and follow [`docs/contracts/admin.md`](../../docs/contracts/admin.md). Live mode reads lists from Firestore where the rules allow it (album, RSVPs, teams, roster and audit log for admins) and uses `listMembersV1` / `getMemberV1` for people; it is not yet verified against a deployed backend.

| Screen | Path | Who |
| --- | --- | --- |
| Album viewer, remove photo or comment (reason required) | `/events/album/?id=` (past events) | organizer, admin |
| Attendees: search, add (a full event needs a reason and grows by one), remove, check in or undo (`recordAttendanceV1`; undo is refused once points were awarded), CSV export | `/events/attendees/?id=` | organizer, admin |
| Member directory: server-side search and filters, "Showing N of M", Load more, CSV export of every match (organizers see people without points) | `/members/` | organizer (read), admin |
| Member detail: role, teams, location, department, title, deactivate or reactivate, reset participant profile, adjust or reset points (all with a reason) | `/members/detail/?id=` | admin (organizers read only) |
| Bulk import: template, CSV or XLSX, dry-run preview with create / update / unchanged / invalid counts and field diff, apply in chunks with progress, error CSV | `/import/` | admin |
| Roster: everyone at the company (Invited, Active, Deactivated, Revoked) paged and searched on the server (`listRosterV1`), exact counts, "Showing N of M", Load more. Invited people: **Resend invite** (`resendRosterInviteV1` records the resend and shows a message and link to copy; DIP sends no email), revoke; revoked: invite again. A banner offers **Add existing members to the roster** (`backfillRosterV1`: dry-run summary, then confirm) when members are missing from it. No roster-only mode | `/roster/` | admin |
| Audit log (read-only, search, category filter, readable action labels in `src/lib/auditLabels.ts`, details, CSV) | `/audit/` | admin |
| Overview (landing page): stat tiles, 30-day activity chart with table fallback, top events, needs attention, weekly theme; points and top members for admins only. Mock scenarios: `?insights=empty`, `low`, `high`, `error`, `slow` | `/overview/` | organizer, admin |

- **Admin-only pages** show organizers an "Admins only" page: what to ask an admin for, the admins' names, and links back. Organizers have no challenge submissions queue (admin only, by contract).
- **Roles:** `member | organizer | admin` (`can(role, capability)` in `adminTypes.ts`). Organizers manage events, themes, albums and attendees and can read the member list; admins also manage people, imports, roster and audit. The UI only hides what the backend would refuse.
- **Import:** parsed in the browser (`csv.ts`; `xlsx.ts` uses `fflate@0.8.2`, loaded on demand, first sheet as text). Local checks reject bad emails, wrong domain, duplicates, unknown roles and bad dates before anything is sent; valid rows go to `importEmployeesV1` in one dry-run call (the server plans up to 2000 rows), then `applyEmployeeImportV1` is called repeatedly, one 100-row chunk per call with the `planHash`, until `done`. Limits: 2000 rows, 2 MB. Blank cells keep the current value. Re-running a chunk is a no-op and the counters stay exact. An unfinished import is remembered in this browser (localStorage, job id and plan hash only); on return the page asks the server where it stands (`getEmployeeImportV1`), offers "Continue import" with the rows already done, or reports that it finished.
- **Destructive actions** use a native `<dialog>` with a required reason that is written to the audit log. Exported CSVs neutralize leading `= + - @`.
- Pass `?`-style ids in the URL (static export): `/members/detail/?id=<uid>`.

### Dipbot (AI event ideas, V2 stretch)

The portal calls its AI features **Dipbot**. All user-facing AI copy lives in one flat keyed module, `src/lib/aiStrings.ts` (`AI_NAME` constant, `t()` and `tn()` helpers), ready to move to an i18n catalog later.

- **Dipbot Suggest**: `eventIdeaSuggestions(sessionId)` (`getEventIdeaSuggestionsV1`, one call per visit) tags at most one option per choice with "Perfect fit", "Great choice" or "Good match". Thresholds and provider caps (fallbacks stop at "Good match") are in `src/lib/suggestionLabels.ts`; no percentages are shown and nothing is selected for the admin. "Use suggestions" fills the tagged choices. The banner says "Powered by Jev" only when Jev answered. Mock scenarios: `?jev=perfect`, `great`, `good`, `openai`, `heuristic`, `low` (no tags), `none`, `slow`, `error`.
- Illustrations: `public/img/ai/*.svg` (flat mascot spots and interest scenes, regenerate with `python3 scripts/make-ai-art.py apps/admin/public/img/ai`), the weekly-theme art for interests. Interest tags resolve by NAME in `src/lib/tagArt.ts` (explicit table, then keyword synonyms, then a deterministic generated mascot on an accent tile keyed by the tag id) and get a 3 to 5 word blurb from the same module (a `description` on the tag document overrides it). Option cards are image-led and compact (68 px tall, 72 px on phones): a 64 px art tile flush left, one-line name and blurb right. Mock only: `?tags=live` swaps in production-like tag names (use with `?ai=nodata`). Every image is non-draggable and non-selectable (global rule in `globals.scss` plus `draggable={false}` on shared components).

`/ideas/` (nav item "Dipbot", capability `ai.generate`, **admins only**; organizers get the "Admins only" page). A five step flow (interests, goal, group and setting, budget and timing, note) ends in up to three event drafts to review. Nothing is created: "Open in editor" stores the draft in `sessionStorage` (`dip.aiDraft.v1`, valid for one hour, read once) and opens `/events/new/?from=ai`, where `EventForm` pre-fills title, description, tags, cover, price, capacity and indoor/outdoor. Venue and times stay empty and the normal Save creates the event.

- Callables (`ADMIN_CALLABLES`, `adminTypes.ts`): `getEventIdeaContextV1` (`eventIdeaContext()`: rounded interest buckets, running weekly theme, quota) and `generateEventDraftsV1` (`generateEventDrafts()`: one `requestId` per attempt; reused only when the user retries an unchanged request after `AI_UNAVAILABLE` or `AI_OUTPUT_INVALID`, new on Regenerate or any change). Server reasons (`AI_DISABLED`, `AI_PROMPT_REJECTED`, `AI_DAILY_LIMIT`, ...) arrive on `ApiError.reason`. Flow logic is in `src/lib/ideas.ts`, the mock in `src/lib/ideasMock.ts` and `adminMock.ts`.
- Mock mode: admin only, 30 per month and 10 per day (starts at 12 and 3 used), replay by `requestId`, a note containing "ignore previous instructions" is rejected. Scenarios by query, mock only: `?ai=off`, `nodata`, `quota`, `error` (generate fails with `AI_UNAVAILABLE`), `slow` (8 s), `lowcredits` (under 20% of the credits left), `nocredits` (out of Dipbot credits). The mock starts at 412 of 500 credits; a generation costs 10. The portal shows credits only, never money.
- Screenshot states, mock only: `/ideas/?step=1` to `?step=5` (earlier steps answered), `/ideas/?step=results` (presets, generates on load); combine with `&ai=`.

## UI conventions (quality pass, November 2026)

Findings and remaining work: [`docs/quality/admin-audit-2026-11.md`](../../docs/quality/admin-audit-2026-11.md).

- **Shared building blocks:**
  - `Tabs` is a tablist with arrow keys.
  - `RadioGrid` is used by the cover and theme pickers.
  - `TableRegion` wraps every data table in a named, focusable scroll region.
  - `Toast` / `toast()` gives success and error feedback and an optional Undo.
  - `Dialog` handles confirmations; danger dialogs start on Cancel.
  - `Ui.tsx` has `LoadError`, `Loading`, `Empty`, `SearchBox`, `ResultCount` and `LoadMore`.
- **URL state:** list filters, search, tabs and the selected item live in the URL (`useQueryState`), so reload, Back and shared links restore them. Press `/` to focus a list's search.
- **Colors:** filled purple surfaces with white text use `--primary` (#5562dc, 5:1). The brand purple #7b88fa is only for decoration. Control borders are #8a8fa5 (3:1). Notices and banners use full tinted borders, never a one-sided stripe.
- **Images:** bundled images go through `asset()` (`src/lib/asset.ts`) so they resolve under the `/admin` base path.
- **Page titles:** each page's title is set by `Shell` ("Page | DIP Admin").

## Member photos

`Avatar` (`src/components/Avatar.tsx`, re-exported from `Ui.tsx`) is the one component for every person in the portal: Overview top members, Members (list and detail), Roster, Attendees and the attendee picker, Audit log actors, Bug reports (list and detail), Review submissions, and the Admins-only page. Chain: the Google profile photo (`photoURL`, stored size-less by `resolveMembershipV1`; requested as `=s96-c`, `=s192-c` for 64 px; a load error falls through), then the stored `avatarId` mascot art in `public/img/avatars/` (a colour name or `avatar-NN`), then the character the app generates from the user id, then initials only when the user id is unknown. Real accounts start with `photoURL` and `avatarId` empty, so most people show the generated character. `src/lib/generatedAvatar.ts` ports `DIPAvatarStyle.assigned(forUserID:)` exactly (FNV-1a 64 over UTF-8, SplitMix64 finaliser, figure/mood/palette as mixed-radix digits); `CrewFace` draws it as inline SVG from the brand tokens, and the unit test pins pairs computed from the Swift code. The image is decorative (`alt=""`, `referrerPolicy="no-referrer"`, `loading="lazy"`). Additive wire fields carry the stored profile where a list has it: `InsightsTopMember.photoURL/avatarId`, `AdminBugReport.reporterPhotoURL/reporterAvatarId`, `RosterEntry.memberPhotoURL/memberAvatarId` (claimed entries, same company only); attendees join the member list, review submissions already carry `userAvatarId`/`photoURL`, and audit actors use the user id only. Mock members carry local photos from `public/img/mock-photos/`. The CSP `img-src` allows `https://*.googleusercontent.com` and `https://*.ggpht.com` (`firebase.json`).

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
