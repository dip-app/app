# Work session

User: sandervonk
Date: 2026-11-17
Workstream: admin-challenges-rows
Agent: Codex
Status: completed

## Summary

Admin Challenges list redesigned as a real table with theme art tiles and hairline row dividers. Review submissions page got the theme tile in its header, a uniform-radius queue list and shortcut hint chips.

## Changes

- apps/admin/src/components/ChallengeRows.tsx (new): ChallengeTable, ChallengeRow, sortChallenges (this week, upcoming, past).
- apps/admin/src/app/challenges/page.tsx: uses the table; upcoming weeks are listed with no review action.
- apps/admin/src/app/challenges/review/page.tsx: ThemeArt tile in the header; shortcut hints are a list of key-cap chips.
- apps/admin/src/styles/pro.scss, _admin.scss: challenge table and phone card styles, queue item radius (8px list, 6px items, 3px inset, full 1px selected ring), key-hint chips.
- apps/admin/src/lib/api.ts, AppProvider.tsx: mock showcase themes (outdoors upcoming; food, music, learning past) only in the hosted preview, off in unit tests.
- apps/admin/src/components/__tests__/ChallengeRows.test.tsx (new).
- Weekly themes list already shows art tiles and dividers; no change.

## Validation

- `npx vitest run` in apps/admin: 239 passed, 2 skipped. `npx tsc --noEmit` and `npx eslint src` clean.
- Screenshots at 1440 and 390 in mock mode; fresh auditor round (notes as requested) found desktop list passing; its phone polish items for "Not open yet" and queue inset were applied. Not re-screenshotted after the last two small CSS tweaks.

## Decisions

- Pending count and Dates/Goal/Joined are columns; the title line carries the phase chip only.
- Shortcut chips stay visible on phones (wrap) per request.

## Handoff

None.
