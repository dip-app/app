# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Integrate main into feature/v2-combined
Agent: Claude Code
Status: completed

## Summary

Merged origin/main into feature/v2-combined and resolved 15 conflicts so the V2 branch can be merged into main.

## Changes

- gcp rules, photos module and its tests, functions index, contracts, callables and data-ownership docs, package.json scripts and CI jobs: combined's side kept (it is what production runs); main's additions that did not overlap were kept.
- gcp/functions/src/modules/share/domain/sharePage.ts: main's share page redesign.
- apps/admin login: main's redesign auto-merged; the mock-mode "Preview as organizer" button is kept.
- .gitignore: both sides (.dd-*/, *.xcresult, site-dist/).
- Main's session log 016 renamed to 342 because both branches added a different 016.
- test:rules now runs with --test-concurrency=1 (parallel files shared one emulator and failed intermittently).
- accounts-profile rules test no longer lists users/member/notifications/n as denied; the invites rules open owner get and are tested in invites.test.ts.

## Validation

npm ci, npm run check, test:rules, all emulator integration suites, test:swift, admin typecheck/lint/vitest, scripts/build-site.sh.

## Decisions

Photo eligibility stays "not cancelled" (combined) rather than main's "scheduled only".

## Handoff

Open the PR feature/v2-combined into main; nothing to redeploy for functions or rules.
