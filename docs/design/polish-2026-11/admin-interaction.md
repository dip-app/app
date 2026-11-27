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
- Layout shift on load (measured CLS, unchanged by these waves): Account 0.094 (settings sections fill in one by one;
  each section's loading state should reserve its final height), Roster 0.046 (the tabs and search row move when the
  counts arrive; reserve the count width or render the tabs with placeholders).
- Bundle: both language catalogs ship on every page (about 68 KB gzip together); loading Spanish only for Spanish
  readers needs an async language switch (i18n owner). The cover library's alt text rides into every page through
  `contract.ts` -> `catalog.ts` -> `covers.ts` (about 55 KB gzip with the tag catalog); a lighter tag-id module for
  `contract.ts` would keep it on the editor pages only.

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

### Wave 2: data cache and optimistic updates (PR "Admin data cache and optimistic check-in")

How the cache works (`src/lib/queryCache.ts`, used by `useLoad` and `usePaged`):
- Stale-while-revalidate in memory for the session. A screen seen before renders its last answer at once and
  refreshes behind it (`refreshing`, never `loading`, so tables are not dimmed). Readers of one key mounted together
  share one request; answers younger than 4 s are not fetched again.
- Scope: user, company, role and language. Any change empties it; sign-out empties it; an answer that lands after the
  scope changed, after a write, or after a newer request for the same key is never stored.
- Keys: the hook key plus the loader's source text. A key must name everything the loader reads (ids included).
- Writes: every successful write (the api is wrapped once in `AppProvider`) drops entries no screen is showing, so a
  just-saved edit never shows its old version on the next page, and marks the ones on screen stale.
- Failures: a refused refresh (`permission-denied`, `unauthenticated`) clears the data and shows the load error; any
  other failed refresh keeps the data and shows one error toast. A failed first load is the page's load error as before.
- `reload()` now refreshes in place (data stays, no dim); `setData` and `mutate` write through to the cache.

Optimistic updates: attendance check-in and its Undo change the row at once (a pending value beside the data, so an
older refresh can't flip it back), the button shows the spinner and keeps focus, one refresh follows the last request,
and a refused request rolls the row back with the error. The toast still waits for the server, which decides whether
points were awarded. Approve and reject already removed the row from the server's answer and moved focus to the next
person; role and team saves stay server-confirmed (the server enforces last-admin rules), and email switches were
already optimistic. Removing an attendee removes the row at once and moves focus to the next row's Remove (or the
search box). Skeleton minimum hold: 300 to 200 ms (the 140 ms reveal makes a shorter hold read as calm).

| Measure (mock backend answering in 300 ms, 4x CPU) | Before | After |
| --- | --- | --- |
| Revisit Events / Overview / Members / Events (click to content) | 530 / 537 / 537 / 514 ms, skeleton every time | 68 / 82 / 82 / 67 ms, no skeleton |
| First visit Events / Members / Themes | 575 / 530 / 530 ms | 511 / 445 / 437 ms |
| Check-in: row shows the new state (1 s backend) | after the round trip and a full reload (over 1.3 s) | first frame captured, about 40 ms |
| Focus after check-in / after removing an attendee | dropped to the page (button disabled) / the page | stays on the row's button / next row's Remove |

Review: three fresh Opus rounds. Round 1 FAIL (queued Load more paged from the old cursor; an older refresh could
flip an overlapping check-in back; a just-saved edit showed its old version on the list; silent refresh failures,
including refused ones). Round 2 FAIL (paged lists kept rows after a refused refresh; a failed final refresh dropped
pending values; reads in flight during a write could store old data). Round 3 FAIL with one P1 (a paged answer landing
after sign-out could be stored for the next person), fixed with a test; its remaining notes are accepted or open:
the table columns are 11 to 20 px wider than before because the attendance button now has one width for both labels
(steady during check-in, measured within the same build); a pending value whose final refresh failed shows until the
next refresh; the check-in button changes from filled to outlined under its spinner; screen readers hear the toast,
not the badge change; the `generations` map is not pruned during a session.

Open, deferred on purpose: prefetch on hover (a route-to-loader registry would duplicate the inline loaders; Next
already prefetches route code), inline confirmation instead of a modal (page structure, the structure owner's call).

### Wave 3: code splitting and keyboard (PR "Admin code splitting and keyboard shortcuts")

- `suggestionsApi.ts` loads the Firebase SDK and the live adapter on the first live call instead of statically, so
  Your settings and the suggested-idea page no longer download the whole SDK in mock mode, and the SDK leaves the
  pages Next prefetches from the sidebar.
- `AppProvider` loads the mock backend and its fixtures only in mock mode (dynamic import); `browserStore` moved to
  its own module so the import page doesn't pull the mock in. Live pages never download the mock.
- Keyboard: `g` then a letter goes to any page in the sidebar the role can open (O, E, I, T, C, M, R, P, B, A, S),
  `?` or Ctrl/Cmd+/ lists every shortcut, `/` still focuses a page's search, the review queue keeps J/K/A/R. One live
  setting (`lib/shortcuts.ts`, the review queue's old storage key so an existing choice carries over) turns every
  single-key shortcut off at once (WCAG 2.1.4), including `/`; Ctrl/Cmd+/ still opens the list. Shortcuts never fire
  while typing, composing (IME), with another dialog or the phone menu open; the letter after `g` is always consumed
  so a page shortcut can't fire with it. The list starts focus on its title and returns focus on close.

| Measure | Before | After |
| --- | --- | --- |
| First-load JS, gzip (build manifest) | 268 KB shared; 283 to 308 KB per page; 503 to 506 KB on Your settings and a suggested idea | 231 KB shared; 249 to 281 KB per page; 253 to 255 KB on those two |
| JS transferred on a cold load incl. sidebar prefetch (10 Mbps, 40 ms RTT, gzip, mean of 2 runs) | 584 to 619 KB | 379 to 417 KB |
| Real content on screen after a cold load (same conditions, 300 ms mock backend) | 982 to 1350 ms | 919 to 1290 ms (60 to 260 ms earlier on every route) |

Honest caveats: these runs are mock mode. Mock mode now fetches the mock backend as its own chunk before the session
loads, so first paint was 10 to 50 ms later on 8 of 10 routes (and LCP 60 to 80 ms later on Overview and Events) in
the throttled runs, and noisier in one unthrottled run; live mode never downloads that chunk and was not measured
(no deploys). Two runs per side.

Review: three fresh Opus rounds. Round 1 FAIL (the off switch was shared only through storage, so switches disagreed
until a reload; "g a" could also open the review queue's Approve; cramped 320 px list; first paint later than claimed).
Round 2 FAIL (a letter after "g" that goes nowhere still reached the review queue; "/" ignored the off switch; "?"
opened over the phone menu). Round 3 PASS. Fixed from round 3: Shift and Caps Lock no longer cancel a pending "g";
Tab and Escape cancel it and keep their job. Open P3s: `⌘` read by screen readers as a symbol, a failed chunk download
reaches `userError` as a network error rather than an `ApiError` (copy is still plain), the 320 px switch card wraps,
the `g` hint can cover content for 1.5 s, two literal hairline colors match the existing files rather than tokens.

## Remaining gaps (after wave 3)
- Prefetch on intent (hover/focus warming a page's data) is not built; revisits are instant, first visits still load.
- Inline confirmation instead of a modal, and undo toasts beyond check-in, need backend support or page structure.
- Command palette: deferred; the `g` shortcuts and the list cover navigation for an occasional-use admin tool.
- CLS on Account and Roster and the catalog/cover bundle split are requests above.
- Live-mode LCP/INP were not measured (no deploys); interaction latency in mock mode stayed at 16 to 48 ms at 4x CPU.

