# Work session

User: sandervonk
Date: 2026-11-26
Workstream: admin-interaction-2
Agent: Claude (Opus), with Opus review subagents
Status: completed

## Summary

Admin interaction owner, wave 2 of 3: a session-scoped stale-while-revalidate cache for the data hooks so revisits
render at once, write-aware invalidation, refused-refresh handling, optimistic attendance check-in with rollback, and
focus that follows removed rows. Measured on the mock-mode static export: revisits went from about 530 ms with a
skeleton every time to 67 to 82 ms with none (300 ms backend, 4x CPU).

## Changes

- apps/admin/src/lib/queryCache.ts (new): scope, keys, dedupe, generations, drop-or-stale on writes, `staleOnWrite`.
- components/useLoad.ts and usePaged.ts: cached first render, background `refreshing`, `refreshError`, refused refresh
  clears data, write-through `setData` / `mutate`, queued Load more during a refresh, changes during a refresh survive.
- components/AppProvider.tsx: wraps the api with `staleOnWrite`, empties the cache on sign-out.
- app/events/page.tsx and app/themes/page.tsx: lists read through `useLoad` (same copy for load errors).
- app/events/attendees/page.tsx: optimistic check-in and Undo (pending overlay, one refresh after the last request,
  rollback), row removed at once with focus to the next row; lib/focus.ts (new).
- lib/skeletonLayout.ts: skeleton minimum hold 300 to 200 ms. styles/interaction.scss: one width for the attendance
  button. vitest.config.ts + test/resetCache.ts: the cache is emptied after every test.
- Tests: dataCache.test.tsx (9), attendanceOptimistic.test.tsx (2).

## Validation

- `npx vitest run src/components/__tests__ src/lib/__tests__/loadingHold.test.ts`: 49 files, 362 tests pass (run
  because every page reads through the changed hooks).
- `npx tsc --noEmit`, `npx eslint src`, `npm run check:admin-i18n`: clean. `next build` static export.
- Playwright on the static export with `?latency=300` and 4x CPU: before/after navigation timings, revisit filmstrip,
  check-in filmstrip with a 1 s backend (numbers in the area doc).
- Review: three fresh Opus rounds (FAIL, FAIL, FAIL with one P1); every P1 and P2 from rounds 1 and 2 and the round 3
  P1 fixed with tests; remaining round 3 notes recorded as accepted or open in the area doc.

## Decisions

- Writes drop entries no screen shows (instead of only marking them stale), so a saved edit never shows its old
  version on the next page; on-screen entries are marked stale and their page refreshes.
- Refused refreshes clear data; other refresh failures keep data and toast (identical toasts replace each other).
- Optimistic only where the server cannot change the outcome shown: check-in state (the points toast waits for the
  server). Role and team saves stay server-confirmed. Prefetch on hover deferred (loader duplication).

## Handoff

Wave 3 (code splitting, shortcut help, measured bundle sizes) follows in its own PR. Open notes from review round 3 are
listed in docs/design/polish-2026-11/admin-interaction.md. This branch is stacked on admin-interaction-1 (PR #356).
