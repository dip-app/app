# Production deploy runbook

Everything we learned deploying DIP to the Firebase project `team05-dip`. Deploying is a deliberate, human-triggered action (root `AGENTS.md`): agents and routine coding never run these commands. Nothing in this repository deploys by itself except the optional CI hosting job described below.

Related: [launch switches](launch-switches.md) (noindex, App Store ID), [TestFlight and Universal Links](testflight-universal-links.md), [seed data conventions](seed-data.md), [push enablement](../design/push-client.md), [share links](../design/share-links.md), [admin deploy notes](../../apps/admin/README.md#deploy-firebase-hosting).

## 0. Tooling (get this right first)

| Tool | Version | Why |
| --- | --- | --- |
| Firebase CLI | **14.x** (`npm i -g firebase-tools@14`) | CLI 13 cannot deploy the `nodejs22` runtime that `firebase.json` declares for Functions. |
| Node for the deploy shell | **20** (use `nvm use 20` while running `firebase deploy --only functions`) | The Functions predeploy runs `npm --prefix gcp/functions run build`; Node 20 is what the CLI 14 Functions packaging was verified with. The repository checks run on Node 24.12+ (`npm ci`, `npm run check`); switch back for those. |
| gcloud | current | Only for the one-time IAM, DNS and TTL steps below. |
| Login | `firebase login` as a person with Owner or Editor on `team05-dip` | Never use or commit a key file. Credentials stay on the operator's machine. |

Always pass `--project team05-dip` (there is no committed `.firebaserc`; it is gitignored). Check `firebase use` or the flag before every deploy: a wrong project is the main way to hurt production.

Pre-flight for any deploy, from the branch you are deploying (see section 9 for which branch):

```sh
git status                       # clean, on the intended commit
node -v && firebase --version    # Node 24 for checks, CLI 14
npm ci && npm run check && npm run test:rules   # plus the integration suites the change touches
```

## 1. Deploy commands per surface

Deploy one surface at a time and smoke test it (section 7) before the next. Order for a full release: Firestore rules and indexes, Storage rules, Functions, then Hosting. Rules and indexes go first so a new function never runs against old rules; hosting goes last because the share page and admin portal call functions.

### Firestore rules and indexes

```sh
firebase deploy --only firestore:rules,firestore:indexes --project team05-dip
```

Index builds run in the background after the command returns; wait until the Firebase console shows them as `Enabled` before testing queries that need them (a query against a still-building index fails with `failed-precondition`). Rules take effect within about a minute.

### Storage rules

```sh
firebase deploy --only storage --project team05-dip
```

Prerequisite (one time, see section 3): the Storage service agent must hold `roles/firebaserules.firestoreServiceAgent`. Without it the rules deploy can succeed but uploads and reads fail with permission errors, because Storage rules that call `firestore.get`/`exists` cannot read Firestore.

### Functions

```sh
nvm use 20
firebase deploy --only functions --force --project team05-dip
```

- `--force` is required when a deploy would delete functions that exist in production but not in the code, and when the CLI needs to set or change cleanup/artifact policies non-interactively. Read the plan the CLI prints first: if it lists a deletion you did not intend, stop (a missing export in `gcp/functions/src/index.ts` deletes the production function).
- Deploy a subset while iterating: `--only functions:dip:setRsvpV1,functions:dip:sendInviteV1` (the codebase is `dip`).
- All exports are in `gcp/functions/src/index.ts`; the callable contract is [callables.md](../contracts/callables.md). Callables enforce App Check outside the emulator (`enforceAppCheck: true`), so a client without a valid App Check token is rejected by design.
- First deploy of a trigger or scheduler may take several minutes and needs the Eventarc/Cloud Scheduler APIs enabled; the CLI offers to enable them.

### Hosting

Two sites in the project (see `firebase.json`):

| Site | URL | Content |
| --- | --- | --- |
| `letsdip` | https://letsdip.work (apex, plus `www` redirect) | Landing page at `/`, the admin portal at `/admin/`, the share page (`/e/**` rewrite to `eventSharePageV1`), and the Apple App Site Association file. Public dir `site-dist/`, built by `scripts/build-site.sh`. |
| `team05-dip` | https://team05-dip.web.app | Redirect only: every path gets a 301 to the same path on `https://letsdip.work`. Public dir `apps/redirect`. Always `noindex`. |

Build the live admin export, assemble `site-dist/`, then deploy:

```sh
# 1. Live admin config (section 2). Without it you build the MOCK portal and would replace the live one.
export NEXT_PUBLIC_FIREBASE_API_KEY=...        # values from `firebase apps:sdkconfig web <appId>`
export NEXT_PUBLIC_FIREBASE_PROJECT_ID=team05-dip
export NEXT_PUBLIC_FIREBASE_APP_ID=...
export NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=letsdip.work
export NEXT_PUBLIC_APPCHECK_SITE_KEY=...       # reCAPTCHA Enterprise site key (public)
(cd apps/admin && rm -rf .next out && npm ci && npm run lint && npm run typecheck && npm test)
scripts/build-site.sh                           # builds apps/admin, writes site-dist/
# 2. Deploy
firebase deploy --only hosting:letsdip --project team05-dip
firebase deploy --only hosting:team05-dip --project team05-dip    # only when apps/redirect or its redirects changed
```

`scripts/build-site.sh [--skip-admin-build]` copies the landing page (rewritten for the App Store config, see [launch switches](launch-switches.md)), `robots.txt`, `sitemap.xml`, the landing images (`/img/landing/`), the admin export (`/admin/`), and the shared public assets (`aasa/`, `share/`, `img/`). Always build the admin export from a clean `.next out`: `next dev` and `next build` share `.next`.

Preview first when in doubt (leaves the live site untouched):

```sh
firebase hosting:channel:deploy my-change --only letsdip --project team05-dip --expires 7d
```

## 2. Admin live environment

The admin portal is a static export, so its Firebase configuration is baked in at build time. A build without it is the mock portal ("Sign in as organizer"); the live one says "Sign in with Google".

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | From `firebase apps:sdkconfig web <appId> --project team05-dip`. These are public web identifiers, not secrets. Web app "DIP Admin" has app ID `1:28423377357:web:a19e30f455328ae322b484`. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `letsdip.work`. The auth domain is the custom domain so the Google sign-in redirect handler lives at `https://letsdip.work/__/auth/handler` (section 4). |
| `NEXT_PUBLIC_APPCHECK_SITE_KEY` | The reCAPTCHA Enterprise site key of the "DIP Admin web" key (public). Production callables enforce App Check. |
| `NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN` | Local only. Never in a production build. |

They live in `apps/admin/.env.local` (gitignored) for manual builds and in GitHub Actions repository variables for CI (`vars.NEXT_PUBLIC_*`, see `.github/workflows/admin.yml`). After building, verify with the post-deploy smoke test (section 7): the login page text and the `x-robots-tag` header.

CI deploy (`.github/workflows/admin.yml`, only on `main`) is inactive until the `FIREBASE_SERVICE_ACCOUNT_TEAM05_DIP` secret and the variables exist. It runs `scripts/build-site.sh --skip-admin-build` and deploys the live channel. Until then merging to `main` does not change production.

## 3. One-time project setup (already done for `team05-dip`; repeat for a new project)

1. **Storage service agent role.** Grant the Cloud Storage service agent `roles/firebaserules.firestoreServiceAgent`, otherwise the Storage rules cannot consult Firestore (album uploads require a going RSVP) and uploads and reads fail:
   ```sh
   PROJECT_NUMBER=$(gcloud projects describe team05-dip --format='value(projectNumber)')
   gcloud projects add-iam-policy-binding team05-dip \
     --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-firebasestorage.iam.gserviceaccount.com" \
     --role="roles/firebaserules.firestoreServiceAgent"
   ```
   Check the exact service agent address in IAM (tick "Include Google-provided role grants"); it is the Firebase Storage service agent of the project.
2. **Firestore TTL policy on `inviteRateLimits.expiresAt`.** The invitation rate limiter writes `inviteRateLimits/{key}` documents with an `expiresAt` timestamp; without a TTL policy they accumulate forever:
   ```sh
   gcloud firestore fields ttls update expiresAt --collection-group=inviteRateLimits --enable-ttl --project team05-dip
   ```
   TTL deletes lag by up to about 24 hours, so never treat `expiresAt` as exact; the limiter compares timestamps itself.
3. **APIs and Auth.** Firebase Auth with Google sign-in enabled (the only provider, ADR 0007). Authorized domains (section 4). App Check registered for the iOS app (App Attest) and the web app (reCAPTCHA Enterprise). Cloud Scheduler and Eventarc APIs for `sendEventReminders` and Firestore triggers.
4. **First admin.** Set `users/{uid}.role = "admin"` with trusted tooling (Admin SDK or the console) after the person's first sign-in. Clients cannot write roles.

## 4. Custom domain `letsdip.work`

- **Firebase Hosting, site `letsdip`:** add `letsdip.work` (and `www.letsdip.work` as a redirect to the apex) under Hosting, Add custom domain. The console shows the exact records to add.
- **DNS records** (at the registrar; values come from the console, these are the usual shapes): apex `A` records to the Firebase Hosting IPs the console lists (it may also ask for a `TXT` `hosting-site=letsdip` verification record), and `www` as a `CNAME` to `letsdip.web.app` (or the A records the console lists). Remove any conflicting `AAAA`/parking records. Certificate provisioning can take up to a day; do not point production links at the domain before the console shows "Connected".
- **Cloud Console OAuth client (Web client used by Firebase Auth):** Authorized JavaScript origins add `https://letsdip.work`; Authorized redirect URIs add `https://letsdip.work/__/auth/handler`. Without them the Google sign-in popup/redirect on the custom domain fails with `redirect_uri_mismatch`.
- **Firebase Auth, Settings, Authorized domains:** `letsdip.work`, `www.letsdip.work`, plus the defaults (`team05-dip.web.app`, `team05-dip.firebaseapp.com`, `localhost`).
- **reCAPTCHA Enterprise key "DIP Admin web", allowed domains:** `letsdip.work`, `www.letsdip.work`, `team05-dip.web.app`, `team05-dip.firebaseapp.com`, `localhost`. A missing domain shows up as App Check failures (`appCheck/recaptcha-error`) and callable `unauthenticated`/`failed-precondition` responses from the admin portal.
- **Universal Links:** the AASA file is served from `https://letsdip.work/.well-known/apple-app-site-association` (200, `application/json`, no redirect). `team05-dip.web.app` is deliberately not an `applinks:` host because Apple does not follow redirects for the association file. See [TestFlight and Universal Links](testflight-universal-links.md).

## 5. CDN caching

- `/e/**` is rewritten to the `eventSharePageV1` function and responds with `Cache-Control: public, max-age=300, s-maxage=600` (transient failures use a short no-store style value). Firebase Hosting caches function responses at its CDN only when `s-maxage` is set; so a changed event title or cover can take up to 10 minutes to show in link previews. Never set `Set-Cookie` on that response (it disables CDN caching).
- `/_next/static/**`: one year, immutable. `/img/**`: 24 hours (replacing an image under an existing path takes up to a day to reach every client; use a new filename for urgent changes). The AASA file: 5 minutes.
- After a hosting deploy the CDN serves the new site assets immediately; the function responses age out on their own.

## 6. Rollback notes

| Surface | Rollback |
| --- | --- |
| Hosting | Firebase console, Hosting, release history, Rollback on the previous release (instant, per site). Or check out the previous commit, rebuild, redeploy. |
| Functions | Check out the previous release commit and `firebase deploy --only functions:dip:<name> --force`. There is no console "rollback"; functions are versioned only by the source you deploy. A function you deleted by mistake is recreated by redeploying (its URL stays; triggers are re-attached). Callable names are versioned (`...V1`): never change a V1 wire shape, add a V2 instead, so an old app build keeps working. |
| Firestore and Storage rules | Redeploy the previous rules file (`git checkout <sha> -- gcp/firestore.rules`) or use the console Rules tab, which keeps a release history. Rule rollbacks are instant-ish and cannot undo data written while a looser rule was live. |
| Indexes | Removing an index is destructive for queries that need it. Prefer leaving extra indexes in place. |
| Data | There is no automatic data rollback. Seed scripts write `seed-` prefixed documents with a manifest so they can be undone ([seed data](seed-data.md)). Take a Firestore export before any bulk write: `gcloud firestore export gs://<backup-bucket>/pre-change --project team05-dip`. |

## 7. Smoke tests

Run after each surface. Use a real member account in the app or the admin portal; curl for the public endpoints. Callables need App Check, so exercise them from a client, not curl.

| Surface or function | Check |
| --- | --- |
| Hosting `letsdip` | `curl -sI https://letsdip.work/` is 200 with `x-robots-tag: noindex, nofollow` (until launch). `/admin/login/` says "Sign in with Google". `/img/landing/logo.svg` 200. `curl -sI https://letsdip.work/robots.txt` 200. |
| Hosting `team05-dip` | `curl -sI https://team05-dip.web.app/admin/` is a 301 to `https://letsdip.work/admin/`. |
| AASA | `curl -si https://letsdip.work/.well-known/apple-app-site-association`: 200, `content-type: application/json`, no redirect, body lists `/e/*` for the team's app ID. |
| `eventSharePageV1` | `curl -s https://letsdip.work/e/<realEventId>` contains the event title in `og:title` and the coarse date only (no venue, no time of day); an unknown id returns the same generic 200 page. `cache-control` has `s-maxage=600`. |
| `resolveMembershipV1` | Sign in with a company-domain Google account: lands in the app Home; a personal domain is refused (`PERSONAL_EMAIL_DOMAIN`). |
| `createEventV1`, `updateEventV1` | Admin portal: create an event, edit it (revision increments), a second edit with a stale revision is refused. |
| `setRsvpV1` | Join and leave an event in the app; a full event is refused. |
| `createChallengeV1`, `updateChallengeV1` | Admin portal Weekly themes: create/edit; an overlapping window is refused. The app Home card shows the current theme. |
| `submitChallengeV1`, `approveChallengeV1`, `rejectChallengeV1`, `listChallengeSubmissionsV1` | Submit from the app; approve in the portal; points balance rises once (retry does not add again). |
| `finalizeEventPhotoV1`, `onPhotoCommentCreated` | After an event ends, a going member uploads a photo (confirms the Storage service agent role); the album shows it; a comment increments the count. |
| `sendInviteV1`, `respondToInviteV1`, `listCoworkersV1` | Invite a same-company coworker (search needs 2+ characters); the recipient sees it in the bell sheet and accepts; a full event leaves the invite pending. |
| `registerDeviceV1`, `unregisterDeviceV1`, `onEventMessageCreated`, `onEventChanged`, `onRsvpChanged`, `sendEventReminders` | Push-enabled device only ([push client](../design/push-client.md)): `users/{uid}/devices` gains a document; chat message, event edit and reminders arrive; opt-outs are respected. Without APNs these still write notices and logs; check Cloud Logging for errors. |
| Admin callables (`removeEventPhotoV1`, `removeEventPhotoCommentV1`, `addEventAttendeeV1`, `removeEventAttendeeV1`, `recordAttendanceV1`, `listMembersV1`, `getMemberV1`, `updateMemberV1`, `resetMemberProfileV1`, `setMemberStatusV1`, `adjustMemberPointsV1`, `upsertTeamV1`, `upsertRosterEntryV1`, `revokeRosterEntryV1`, `importEmployeesV1`, `applyEmployeeImportV1`, `getEmployeeImportV1`) | Portal, as an admin and as a plain member: the member gets `permission-denied`; every admin write appears in `companies/{c}/auditLog`; repeating a request id returns the same result. |
| Rules | A member of company A cannot read company B events or albums (the rules tests prove it; spot check in production with two accounts). |
| Bug reports | Shake to report in a TestFlight or Debug build; the document lands in `bugReports` and the screenshot in Storage `bugReports/{uid}/...`. |

Look at Cloud Logging (severity `ERROR`, resource Cloud Function) for ten minutes after a Functions deploy.

## 8. Who may deploy what

Rules, indexes, Functions and Hosting are shared choke points (`firebase.json`, rules, indexes): one integrator deploys, from a clean checkout of the agreed commit, after the PR is merged. Record each deploy (what, commit, time, smoke results) in the session log and, if a release, in [CURRENT_STATE.md](../../CURRENT_STATE.md).

## 9. The combined-branch deploy flow

`feature/v2-combined` contains everything on `main` plus the V2 work that is not on `main` yet (it is what the TestFlight build and the production backend are cut from while V2 is in flight). The flow:

1. All feature PRs target `feature/v2-combined` (not `main`). Merge only with green CI; resolve conflicts on the feature branch, never by resetting someone else's work.
2. When the combined branch is ready: pull it, run the full checks once (`npm ci`, `npm run check`, `npm run test:rules`, the `test:*:integration` suites, `npm run test:swift`, the Xcode build and tests for the app), then deploy surface by surface in the order of section 1 from that exact commit.
3. Tag the commit that was deployed (`git tag deploy-YYYYMMDD-N <sha>`) and note it in CURRENT_STATE.md so rollback has a target.
4. Merge `feature/v2-combined` into `main` once production runs it, so `main` always describes production.

Never deploy from a dirty worktree, from a feature branch that is not in the combined branch, or with a `--project` you did not type yourself.
