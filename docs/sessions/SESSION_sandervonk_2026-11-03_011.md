# Work session

User: sandervonk
Date: 2026-11-03
Workstream: 04-organizer-events
Agent: Claude Sonnet 5.5
Status: completed

## Summary

Login cleanup for the admin portal, the app's real faces on the welcome card, and written deploy documentation.

## Changes

- apps/admin login: removed "Continue as member (no access)"; the button is now "Sign in as organizer". The mock API still models member denial for tests.
- Faces redrawn from the app's welcome card (large overlapping hair discs, face discs low and left, neighbours cutting into the previous face); hero card uses the app's wide proportions.
- Docs: Firebase Hosting deploy section in apps/admin/README.md (manual deploy, preview channels, CI deploy and the service-account secret, rollback, gotchas); README.md no longer says no deploy exists; CURRENT_STATE.md admin portal paragraph; V1 STATUS row 04 updated.

## Validation

- Portal: `npm test` (10), lint, `tsc`, production build pass; login and faces checked in the browser at 1440x900.
- `npm run test:docs`: local Markdown links pass (122 documents).
- Not run: root `npm run check`, the live deploy of this change (done separately and recorded in the PR).

## Decisions

- Documented deploys as a deliberate manual action, consistent with AGENTS.md; CI deploy stays inactive until an owner creates the secret.

## Handoff

Create the FIREBASE_SERVICE_ACCOUNT_TEAM05_DIP secret to enable automatic deploys.
