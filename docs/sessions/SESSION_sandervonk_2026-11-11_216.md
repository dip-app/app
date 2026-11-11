# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Admin roster shows everyone
Agent: Claude (admin portal UI)
Status: active

## Summary

Roster screen reworked per the owner clarification: no roster-only mode, everyone with the company email domain can join, and the roster lists pre-imported (Invited) people together with every member who joined (Active, Deactivated) plus Revoked entries.

## Changes

- `apps/admin/src/app/roster/page.tsx`: default filter is Everyone; filters Everyone, Invited, Active, Deactivated, Revoked; copy no longer says "not signed up" or implies roster-only; revoke stays for Invited, member link for joined people.
- `apps/admin/src/app/import/page.tsx`: import rules copy ("appear on the roster as Invited").
- `apps/admin/src/styles/_admin.scss`: white text on purple fills (pressed chip, avatar), matching d1fb9dc9.
- `apps/admin/README.md`: roster row. No membership-mode setting existed in the portal.

## Validation

- tsc, eslint and the build pass; roster checked in the built-in browser in mock mode. Full suites not run.

## Decisions

- The live adapter already merges roster entries with `listMembersV1` and hides claimed entries behind their member, so it works whether or not the backend writes a roster entry for every joiner.

## Handoff

- `docs/contracts/admin.md` still describes `membershipMode`/`rosterOnly`; the backend owner is changing that.
