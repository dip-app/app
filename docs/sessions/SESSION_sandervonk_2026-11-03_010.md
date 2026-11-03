# Work session

User: sandervonk
Date: 2026-11-03
Workstream: 04-organizer-events
Agent: Claude Sonnet 5.5
Status: handoff

## Summary

Restyled the admin portal to match the running iOS app and set up Firebase Hosting for it.

## Changes

- apps/admin: flat solid-neutral design (no gradients/tints/borders), the app's event photos on gray cards (photo left, details right), compact dark sidebar, purple pill page title, custom switch, concentric nested radii, wide-screen grid and a live preview column, error summary and focus-to-first-invalid, skeleton loading, pencil edit icon.
- firebase.json: `hosting` block (site team05-dip, public apps/admin/out, noindex and security headers).
- .github/workflows/admin.yml: lint, typecheck, test and static build on PRs; deploys to Firebase Hosting from main only when the FIREBASE_SERVICE_ACCOUNT_TEAM05_DIP secret exists.

## Validation

- `npm test` (10), lint, `tsc` and the production build pass. A separate grading agent reviewed the running portal against the iOS app over several rounds (7.5, 8.3, 8.8, 8.9, then a final round); see the PR for the last result.
- Not covered by automation: visual regression, real device/browser matrix.

## Decisions

- The portal is still mock mode: a public deploy shows the local preview only, with no backend data. It is served noindex.
- The event photos come from the app's prototype assets whose release rights are unconfirmed (docs/design/README.md); fine for an internal preview, to be resolved before wider exposure.
- CI deploy needs a Hosting service-account secret that only the owner should create.

## Handoff

Add the FIREBASE_SERVICE_ACCOUNT_TEAM05_DIP secret (or run `firebase init hosting:github`) to enable automatic deploys; implement the organizer callables and a Firebase adapter behind AdminApi; replace placeholder photos with the approved catalog.

## Late fix

The portal's `src/lib/*` was never committed in the earlier admin PR: the root `.gitignore` excludes every `**/lib/`. The new CI job caught it (typecheck: cannot find '@/lib/...'). Added `!apps/admin/src/lib/` to `.gitignore` and committed the five files. Until this PR merges, `main` has an admin app that does not compile from a fresh clone.
