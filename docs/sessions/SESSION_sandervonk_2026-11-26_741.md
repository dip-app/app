# Work session

User: sandervonk
Date: 2026-11-26
Workstream: admin-interaction-1
Agent: Claude (Opus), with Sonnet capture and Opus review subagents
Status: completed

## Summary

Admin portal interaction owner, wave 1 of 3: audit of interaction states, motion and perceived performance (written to
docs/design/polish-2026-11/admin-interaction.md with measured numbers), then the motion and state foundations: shared
motion tokens, one interaction-state recipe for every pressable kit element, dialog enter/exit, toast exit with the
stack closing the gap, a visible pending state for Button, skeleton-to-content reveal, and one global reduced-motion
rule. Also a mock-only `?latency=<ms>` parameter used for all timing measurements.

## Changes

- apps/admin/src/styles/_motion.scss (new): duration and easing tokens, global reduced motion.
- apps/admin/src/styles/interaction.scss (new, imported after pro.scss in app/layout.tsx): hover, pressed, focus,
  disabled, aria-disabled and pending states; dialog, toast, popup, disclosure and skeleton-reveal motion.
- apps/admin/src/styles/globals.scss: uses the tokens; the old transitions-only reduced-motion rule is replaced.
- apps/admin/src/lib/motion.ts (new): the same tokens for code, `motionMs()` returns 0 under reduced motion.
- kit/Button.tsx: `loading` shows a spinner over the kept label. Dialog.tsx: timed exit for Cancel/Escape, spinner
  instead of a disabled label swap, Cancel stays focusable while saving. Toast.tsx: leaving state and timed removal.
- Skeleton.tsx: a painted skeleton marks its parent for a 140 ms content reveal. Ui.tsx: Load more keeps focus.
- lib/loadingHold.ts: `?latency=` (mock only). Tests: Toast, Dialog, kit, new loadingHold test.

## Validation

- `npx vitest run` on Toast, Dialog, Skeleton, kit, kit.guard, formDrafts, ui.i18n, AddPersonDialog, a11y and
  loadingHold tests: all pass (83 tests).
- `npx tsc --noEmit`, `npx eslint src`, `npm run check:admin-i18n`: clean.
- `next build` static export in mock mode; Playwright (system Chrome) captures of computed states, frame sequences
  for dialog, toast, drawer, reduced motion, pending states in en and es. Before/after numbers in the area doc.
- Design review: one fresh Opus reviewer round, PASS (no P1); the P2 contrast issue it found on the focusable
  unavailable Cancel (about 2.3:1 from an older opacity rule) was fixed to 4.6:1.

## Decisions

- Plan critiqued by an independent Opus subagent before building; adopted: no press scale inside tables or on small
  buttons, CSS `@starting-style` dialog enter with a timed exit only on Cancel/Escape, no route fade, palette deferred.
- Exits are 140 ms (quicker than enters on purpose); reviewer noted it is under the 150 ms floor and accepted.
- Reduced motion uses 1 ms durations rather than none so end events still fire; code waits with `motionMs()`.

## Handoff

Wave 2 (data hooks: stale-while-revalidate cache, patch-from-response after actions, check-in optimism) and wave 3
(code splitting, shortcut help, focus after actions) follow in separate PRs with their own session logs. Structural
requests for the structure owner are listed in the area doc. Scratch scripts and screenshots stayed outside the repo.
