# Work session

User: sandervonk
Date: 2026-11-04
Workstream: 04-organizer-events
Agent: Claude Sonnet 5.5
Status: handoff

## Summary

Configured production for the admin portal's live mode and deployed it: registered the web app, registered an App Check reCAPTCHA Enterprise key, assigned the first organizer and published a live-mode build. Made CI deploys live-config-aware so they cannot replace it with the mock.

## Changes

Production changes were all made from the CLI with explicit user approval in chat.

- Firebase web app "DIP Admin" created in team05-dip (app ID 1:28423377357:web:a19e30f455328ae322b484).
- recaptchaenterprise API enabled; reCAPTCHA Enterprise key "DIP Admin web" created for team05-dip.web.app, team05-dip.firebaseapp.com and localhost, and registered with App Check for the web app (token TTL 3600s).
- users/{uid}.role set from "member" to "admin" for one maintainer account (the CMU account identified by the user), after a script verified the document's email. Reversible by setting the role back.
- Portal built with the live config (gitignored apps/admin/.env.local) and deployed to Hosting.
- Repository: five NEXT_PUBLIC_* Actions variables (public identifiers); .github/workflows/admin.yml builds with them and skips the deploy unless they and the deploy secret exist; docs updated.

## Validation

- Live site loads; login shows "Sign in with Google"; the App Check exchange returned 200 after one transient 400 on first load.
- Callable and rules behavior proven against the emulators (`npm run test:admin:live`, in CI).
- NOT verified in production: a real browser Google sign-in followed by an event create/edit (needs the maintainer's own login).

## Decisions

- Live mode replaced the mock preview on https://team05-dip.web.app; every read and write is authorized server-side.
- A script's safety check refused a mistyped uid before any change; the role was then set on the verified document only.

## Handoff

Sign in at https://team05-dip.web.app with the organizer account and create and edit one event; record that as the production evidence for V1-05. Create the FIREBASE_SERVICE_ACCOUNT_TEAM05_DIP secret to enable automatic deploys. Seed users with the legacy role "employee" are not valid roles (members are "member" or "admin") and should be cleaned up or removed.
