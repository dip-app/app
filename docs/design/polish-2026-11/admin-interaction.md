# Admin portal: interaction, motion and perceived performance

Owner area: motion and interaction styling, interaction behavior of the kit, data hooks and caching (`src/lib`,
`components/useLoad.ts`, `usePaged.ts`), toasts and dialogs, keyboard, performance. Page layout, information
architecture and kit component structure belong to the admin structure and content owner; structural requests are
listed at the end.

## How this was measured

- Static export (`next build`), mock mode, served locally, headless Chrome through Playwright with 4x CPU throttling.
- `?latency=300` (new, mock only, `src/lib/loadingHold.ts`) makes every data call answer after 300 ms, like a real
  backend round trip. Without it the mock answers instantly and no loading state is ever visible.
- "Click to content" is the time from a sidebar click to the first animation frame where `<main>` shows the page and no
  skeleton. Web vitals come from `PerformanceObserver` (LCP, CLS, long tasks) and the Event Timing API (interaction
  latency, the INP input).
- Interaction states: computed styles (background, color, shadow, transform, transition) at default, hover, pressed
  and keyboard focus for each kit element; motion: 12-frame screenshot sequences with per-frame opacity and transform.
- Scripts and raw results live outside the repository (session scratchpad); numbers below are copied from them.

## Baseline (before), ranked findings

P1 = clearly hurts how the portal feels on every visit; P2 = inconsistent or missing state; P3 = polish.

| # | Rank | Finding | Measured |
| --- | --- | --- | --- |
| 1 | P1 | Every revisit of a page refetches from scratch and shows the skeleton again: the data hooks keep nothing between routes (each page mounts its own `Shell`, so all state is dropped on navigation). | Revisit Events, Overview, Members: 546 to 643 ms click to content, skeleton shown on 7 of 7 navigations (4 of them revisits). |
| 2 | P1 | Every action waits for the server and then reloads the whole list (`attendees.reload()` after a check-in, etc.). Nothing changes on screen until the round trip ends, then the table flashes busy. | Check-in, approve/reject, role and team saves, email switches: no visual change for the full round trip (300 ms at test latency, more in production). |
| 3 | P1 | No pressed state anywhere in the content area: `.content .pill-btn:active { transform: none }` removes the only press feedback, and pressed equals hover for every element measured. | 12 of 12 elements: pressed styles identical to hover. |
| 4 | P2 | Chips (`ChipToggle`), switches (`Toggle`), member rows and inputs have no hover state and no transition at all; buttons animate only `transform`/`opacity` (so the hover color snaps). | Chip, switch, row: hover = default. Transition durations in use: 0 s, 0.12 s, 0.15 s, 0.2 s, all plain `ease`. No shared motion tokens. |
| 5 | P2 | Dialogs appear and disappear in one frame; the backdrop snaps. | Dialog present at full opacity in frame 1 (9 ms); removed in under 1 ms. |
| 6 | P2 | Toasts slide in (185 ms) but vanish in one frame on dismiss or timeout; the stack below jumps. | Toast exit: 0 ms. |
| 7 | P2 | `Button loading` only sets `aria-busy`: there is no visual pending state, so a slow save looks like an ignored click. Dialog confirm swaps its label to "Saving…" (width changes). | No spinner, no style change while busy. |
| 8 | P2 | Layout shift on load: Account (settings sections fill in one by one), Roster (tabs and search move when counts arrive), Ideas. | CLS 0.094 Account, 0.046 Roster, 0.017 Ideas (target < 0.01 for an admin tool; 0.1 is the "poor" line). |
| 9 | P2 | Skeleton minimum time adds wait: once shown (after 150 ms) it stays at least 300 ms, so data that arrives at 310 ms is held until about 450 ms. | Click to content about 560 to 660 ms with 300 ms latency. |
| 10 | P2 | Mock-mode routes `/account` and `/ideas/suggested` pull the whole Firebase SDK (auth, Firestore, Functions, Storage) through a static import in `suggestionsApi.ts`, even in mock mode. | First-load JS 506 KB gzip vs 283 to 308 KB for other routes. |
| 11 | P2 | Every live-mode page downloads the mock backend and its fixtures (`api.ts` statically imports `adminMock.ts`), and both language catalogs. | Shared layout JS 268 KB gzip. |
| 12 | P3 | Route changes swap content in one frame; nothing tells the eye the page changed. | `#main` opacity 1 in every frame. |
| 13 | P3 | Keyboard: `/` focuses search on list pages and the review queue has J/K/A/R; there is no way to jump between pages, no shortcut help, and focus after an action that removes a row falls back to `<main>`. | |
| 14 | P3 | Reduced motion: transitions are cut globally (`* { transition: none !important }`), but keyframe animations are handled one by one (skeleton, spinner, toast, login); any new animation would ignore it. | |

What is already good and stays: the 150 ms skeleton delay (fast loads never flash a skeleton), the drawer slide (230 ms
decelerating), the toast entrance, focus rings on every element measured, the review queue shortcuts with an off
switch (WCAG 2.1.4), interaction latency on the pages measured (tab switch 48 ms, typing in search 48 ms at 4x CPU).

## Plan

Revised after an independent Opus critique of the first draft: the cache is scoped to the signed-in user, role, company
and language with namespaced keys; background refresh errors never replace a page that has data; writes mark every
cached entry stale instead of guessing which keys they touch; optimistic updates only where the server cannot change
the outcome (results the server computes, such as points awarded, wait for the answer); dialogs use a CSS
`@starting-style` enter and a timed exit only for Cancel and Escape; no press scale inside tables; no route fade (it
would delay cached content); the command palette is deferred in favor of `?` shortcut help.

### Wave 1: motion and state foundations (kit first)
- Motion tokens: `src/styles/_motion.scss` (CSS custom properties) and `src/lib/motion.ts` (the same numbers for JS).
  Durations: instant 80 ms (press), fast 140 ms (hover, color), base 200 ms (enter, small moves), slow 280 ms (dialogs,
  drawers, large moves). Easings: standard `cubic-bezier(.2, 0, 0, 1)`, enter (decelerate) `cubic-bezier(0, 0, 0, 1)`,
  exit (accelerate) `cubic-bezier(.3, 0, 1, 1)`. Reduced motion sets every duration token to 0 and stops all
  animations in one global rule.
- One interaction-state recipe for every pressable kit element (Button variants, ChipToggle, SegmentedControl, Tabs,
  Toggle, nav items, table rows, toast buttons, DipbotAction): hover (wash or darker fill, `fast`), pressed (one step
  darker plus `scale(.98)` on buttons, `instant`), focus-visible (existing rings), selected, disabled (existing
  look plus the reason), loading (spinner that keeps the width).
- Dialog: backdrop fade and panel fade + 8 px rise with a slight scale on open (`slow`, enter easing), a shorter
  accelerate on Cancel/Escape (`fast`); the confirm button shows the spinner instead of swapping its label.
- Toasts: exit animation (fade + slide, `fast`) on dismiss and timeout; the stack moves smoothly.
- Route change: the page content fades in (`base`) when a new page mounts; skeleton to content crossfades.
- Number changes: a small `useAnimatedNumber` for counts that change after an action (chips, totals), off under reduced
  motion.

### Wave 2: data hooks, caching and optimistic updates
- Stale-while-revalidate in `useLoad` and `usePaged`: a session-scoped in-memory cache keyed by the hook key (and the
  signed-in user). A revisit renders the cached data at once and refreshes in the background; the page never shows a
  skeleton for data it already has. Writes invalidate by key prefix. Sign-out and company switches clear the cache.
- Prefetch on intent: hovering or focusing a sidebar item warms that page's main read (a small registry from route to
  loader), on top of Next's route prefetch.
- `useOptimistic`-style helper: apply the change locally, send the request, keep it on success, roll back with an error
  toast on failure. Applied to attendance check-in and undo, approve/reject in the review queue, member role/team
  saves, email switches, bug report triage, roster resend/revoke.
- Inline confirmation instead of a modal where the action is reversible; undo toasts where the backend can reverse it
  (check-in before points are awarded already has one).
- Skeleton timing: keep the 150 ms delay; shorten the hold so arriving data is not delayed more than needed.

### Wave 3: keyboard and performance
- Command palette (Ctrl/Cmd+K): go to any page the role can open, plus the main create actions; shortcut help on `?`.
  Single-key shortcuts follow the review queue's rule (never while typing, can be switched off).
- Focus after actions: when a row disappears, focus moves to the next row (or the list heading), never to `<main>`.
- Code splitting: lazy Firebase in `suggestionsApi.ts`, mock backend loaded only in mock mode, measured before and
  after with the same harness.

## Motion system (shipped in wave 1)

| Token | Value | Use |
| --- | --- | --- |
| `--dur-press` | 0 ms | a press lands at once; the release eases back over `fast` |
| `--dur-fast` | 140 ms | hover, color, focus, exits (leaving is quicker than arriving) |
| `--dur-base` | 200 ms | enters, small moves, dialogs, the toast gap closing |
| `--dur-slow` | 240 ms | the phone drawer and scrim |
| `--ease-standard` | `cubic-bezier(.2, 0, 0, 1)` | moves that start and end on screen, color |
| `--ease-enter` | `cubic-bezier(0, 0, 0, 1)` | arrivals (decelerate) |
| `--ease-exit` | `cubic-bezier(.3, 0, 1, 1)` | departures (accelerate) |

- CSS: `src/styles/_motion.scss` (tokens, reduced motion), `src/styles/interaction.scss` (states and motion, loaded
  after `pro.scss`). Code that waits for a motion uses `motionMs()` from `src/lib/motion.ts` (0 under reduced motion),
  never `transitionend` alone.
- Reduced motion: one global rule makes every transition and animation 1 ms (end events still fire) and stops loops.
- States recipe for everything pressable: hover = wash on white or one step darker on fills; pressed = one step darker
  again at once; medium buttons outside tables also sink to 98 % (small buttons, chips and anything in a table only
  darken, because scaling small text blurs it); focus = the existing rings; disabled = flat gray, no hover;
  `aria-disabled` (focusable but unavailable, like a dialog's Cancel while it saves) = the same flat gray at 4.6:1;
  pending (`Button loading`) = a spinner over the label, which stays as the accessible name and keeps the width.
- Enter and exit patterns: dialog panel fades and rises 4 px from 98 % (200 ms enter) with the backdrop, Cancel and
  Escape play a 140 ms exit, a confirmed dialog closes at once (its result is the feedback); toasts rise in (200 ms),
  fade and slide out (140 ms), then the stack closes the gap (200 ms); address suggestions drop in 4 px (140 ms);
  an opened disclosure fades in; a skeleton that was painted hands over with a 140 ms fade (a load that finished
  before the skeleton appeared shows content at once).
- Mock review helper: `?latency=<ms>` delays every mock data call (with `?loading=1` and `?fail=` for other states).

## Structural requests for the structure and content owner
- Tab panels (`Tabs` + `tabPanelProps`): if the panel element were keyed by the selected tab, the shared reveal could
  fade the new panel in; today the same element is reused, so switching tabs swaps content in one frame.
- The member row link (`a.person`) has only an underline on hover; a row-level hover target would match the tables.

## Results

### Wave 1: motion and state foundations (PR "Admin motion tokens and interaction states")
| Measure | Before | After |
| --- | --- | --- |
| Pressable elements whose pressed state differs from hover (7 captured pressed) | 0 of 7 | 7 of 7 (the switch presses by stretching its knob) |
| Chips, switches, inputs with a hover state | 0 of 4 | 4 of 4 |
| Distinct transition durations / easings in use | 0, 120, 150, 200 ms / `ease` | tokens: 0, 140, 200, 240 ms / three shared curves |
| Dialog open | appears in 1 frame | 200 ms fade + rise, decelerate (measured about 215 ms) |
| Dialog Cancel / Escape | gone in under 1 ms | 140 ms accelerate, then unmount |
| Toast exit | gone in 1 frame, stack jumps | 140 ms fade, gap closes by about 340 ms |
| Pending confirm / Load more | label swap ("Saving…"), button disabled, focus dropped to the page | spinner, width unchanged, focus kept, presses ignored |
| Reduced motion | transitions off, animations handled one by one | every transition and animation 1 ms, dialog and toast exits immediate |

Review: one fresh Opus reviewer round, PASS with no P1. Fixed from it: the focusable-but-unavailable Cancel rendered
at about 2.3:1 (an older `opacity: .55` rule); now 4.6:1. Accepted as designed: 140 ms exits (quicker than the
150 ms floor on purpose), small buttons not scaling on press (documented above). Not changed: the tab focus ring
(unchanged from before, owned with the tab layout).
