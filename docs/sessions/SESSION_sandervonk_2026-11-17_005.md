# Work session

User: sandervonk
Date: 2026-11-17
Workstream: email-compat
Agent: Claude (Sonnet 5.5)
Status: completed

## Summary

Added a free, local email client compatibility checker for the notification email HTML (Gmail, Outlook, Apple Mail) and ran it in the functions unit tests. It found one real issue (`<bdi>` unsupported in Gmail and Outlook), fixed without a visible change. No deploy, no sends, no accounts created.

## Changes

- `gcp/functions/tools/emailCompat/checks.ts`, `cli.ts` (new): caniemail 2.x data for `gmail.*`, `outlook.*`, `apple-mail.*`; html-validate with email-appropriate relaxations; own rules (HTML under 100 KB for the Gmail 102 KB clip, inline-only layout, no float/grid/flex/position/CSS variables, image alt and size, https letsdip.work URLs, dark-mode meta and rules, light/dark art pairs, links, plain-text part, asset files exist). `--online` adds HEAD requests.
- `package.json`: `check:email`. `gcp/functions/package.json` and `package-lock.json`: dev dependencies `caniemail`, `html-validate`, `htmlparser2` (not in the deployed bundle).
- `gcp/tests/unit/email-compat.test.ts` (new): real templates must have zero errors; mutation tests prove each rule fails.
- `gcp/functions/src/modules/email/domain/templates/render.ts`: `<bdi>` became `<span dir="auto">` (same bidi isolation); the visually hidden "was " helper before struck-through values also gets `display:inline-block;font-size:1px;color:transparent;text-decoration:none` so clients that strip `position` (Gmail) do not show it or draw a strike through it. Snapshots regenerated (only these two changes).
- `docs/ops/email-compatibility.md` (new), `docs/ops/README.md`, `docs/design/stretch/email.md`, `CURRENT_STATE.md`.

## Validation

- `node --import tsx --test gcp/tests/unit/email-compat.test.ts gcp/tests/unit/email-templates.test.ts`: all pass.
- `npm run check:email`: 21 templates, no errors, warning groups listed (partial support, enhancement-layer features, reviewed degradations).
- Screenshots of `event_changed_both` normal and with `position:absolute` removed (Gmail simulation): identical to the previous look, no visible "was". Design auditor not re-run because nothing visible changed.
- `npm run test:docs`, `npm run test:sessions`, `npm run typecheck --workspace @dip/functions`: see PR. Full suites not run (targeted tests only).

## Decisions

- Chose `caniemail` over `doiuse-email` (stale since 2023) and `@jsx-email/doiuse-email` (older fork); both use the same caniemail.com data. `juice` not used because styles are hand-inlined; the checker instead fails if essential styling is only in `<style>`.
- Essential features unsupported in some client are errors unless listed in `REVIEWED_DEGRADATIONS` with a reason; enhancement-layer (`<style>`, `@media`, `<link>`, `@import`, meta) findings are warnings.
- Paid services (Litmus, Email on Acid, Mailtrap) only mentioned in the doc as an optional last step.

## Handoff

Real-client checks are still manual: see the checklist in `docs/ops/email-compatibility.md` (Gmail web, Gmail iOS and Android, Outlook Windows and web, Apple Mail, dark mode, images blocked, plain text, RTL) before the first real send. Run `npm run check:email` after any template change.
