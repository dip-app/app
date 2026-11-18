# Work session

User: sandervonk
Date: 2026-11-18
Workstream: cover-pick-400
Agent: claude
Status: completed

## Summary

"Let Dipbot choose" for a cover failed with "Invalid request. [400]" in the event editor opened from a Dipbot draft. pickEventCoverV1 validated its optional hints with a strict schema (any duplicate or malformed tag id, unknown theme, over-long text or malformed excluded URL rejected the whole request), and the 400 carried no field in the logs. The server now relaxes the optional hints before validating, the client builds a schema-safe request, and failures show a friendly message. Nothing deployed. The exact production payload could not be inspected (logs carry no payload), so the fix covers the whole class rather than one field.

## Changes

- `gcp/functions/src/modules/covers/application/pickCover.ts`: additive `relaxPickCoverRequest` (drops null/empty/invalid optional hints, de-duplicates and filters tag ids, caps text, trims title) run before the strict schema; invalid requests log `ai.cover_pick_invalid` with field names only.
- `apps/admin/src/lib/covers.ts`: `buildPickRequest` (schema-safe request builder); `components/CoverPicker.tsx` uses it, shows "Dipbot couldn't pick a cover this time. Try again or choose one yourself." and logs the reason class to the console only. Form state is never touched on failure.
- Tests: `gcp/tests/unit/covers.test.ts`, `apps/admin/src/lib/__tests__/covers.test.ts`, `apps/admin/src/components/__tests__/CoverPicker.test.tsx`.

## Validation

- `node --import tsx --test gcp/tests/unit/covers.test.ts`: 55 pass.
- `npx vitest run` CoverPicker and covers tests in apps/admin: 26 pass.
- `tsc --noEmit` in apps/admin and gcp/functions: clean.
- Not run (targeted-tests preference): full suites.

## Decisions

- Optional hints are forgiving server-side; required fields (contract version, company, request id, title, unknown keys) stay strict.
- "Change cover" on Dipbot draft cards and the new-event form share the same CoverPicker and request builder, so both get the fix.

## Handoff

Another agent edits pickEventCoverV1 for the Pixabay fallback; this change only touches the parse step and adds a helper. Deploy functions for the server half to take effect.
