# Work session

User: sandervonk
Date: 2026-11-26
Workstream: admin-interaction-3
Agent: Claude (Opus), with Opus review subagents
Status: completed

## Summary

Admin interaction owner, wave 3 of 3: code splitting (Firebase SDK on the first live call only, mock backend only in
mock mode) and portal-wide keyboard shortcuts (g then a letter, a shortcut list on ? or Ctrl/Cmd+/, one live setting
that turns every single-key shortcut off). First-load JS fell from 283 to 308 KB gzip per page to 249 to 281 KB, and
from 506 to 253 KB on Your settings; cold-load JS transfer fell by about a third in mock-mode measurements.

## Changes

- apps/admin/src/lib/suggestionsApi.ts: dynamic imports of firebase/app, firebase/functions and the adapter.
- components/AppProvider.tsx: the mock backend is a dynamic import; lib/browserStore.ts (new, re-exported by api.ts);
  app/import/page.tsx imports it directly.
- components/KeyboardShortcuts.tsx (new, mounted in Shell), lib/shortcuts.ts (new: shared live setting, go keys,
  pending state), lib/useSlashFocus.ts and app/challenges/review/page.tsx follow the shared setting; en/es strings in
  shell.ts; list and hint styles in styles/interaction.scss.
- Tests: KeyboardShortcuts.test.tsx (7).

## Validation

- `npx vitest run src/components/__tests__` plus related lib tests: 54 files, 467 tests pass.
- `npx tsc --noEmit`, `npx eslint src`, `npm run check:admin-i18n`, `next build`.
- Bundle sizes from the build manifest before and after; cold loads at 10 Mbps / 40 ms RTT with gzip, 4x CPU, two
  runs per side; shortcut list captured at 1440 (en, es), 390 and 320 with no horizontal scroll, focus kept inside,
  Escape closing.
- Review: three fresh Opus rounds (FAIL, FAIL, PASS). Fixed: one shared live setting, the letter after g always
  consumed, / follows the setting, no shortcuts behind the phone menu, stacked rows on phones, IME and Caps Lock.

## Decisions

- Kept the review queue's storage key for the shared setting so an existing "off" choice carries over.
- Command palette deferred: g shortcuts plus the list cover navigation for an occasional-use admin tool.
- Mock mode pays one extra chunk before the session loads (first paint 10 to 50 ms later in mock runs); live mode
  never downloads it. Live mode was not measured (no deploys); this is stated in the area doc.

## Handoff

Remaining gaps and the structural requests (CLS on Account and Roster, catalog and cover library splitting, tab panel
keys) are listed in docs/design/polish-2026-11/admin-interaction.md. Stacked on admin-interaction-2 (PR #358), which is
stacked on #356.
