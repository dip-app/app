# Work session

User: sandervonk
Date: 2026-11-18
Workstream: static-nav
Agent: Claude (Sonnet 5.5)
Status: completed

## Summary

Admin portal app shell: the document no longer scrolls while the signed-in frame is shown, so the left nav sidebar (and the mobile top bar) cannot be pulled by a rubber-band or overscroll; `<main class="content">` is the only scroll container and keeps its native bounce.

## Changes

- apps/admin/src/styles/_nav.scss: `html:has(.app)` overflow hidden + overscroll-behavior none; `.app` is 100dvh with overflow clip; sidebar no longer sticky (grid cell, overscroll none); `.content` is the scroller (overflow-y auto, overscroll-behavior-y auto, scrollbar-gutter stable, position relative so absolutely positioned descendants cannot grow the document); mobile is a flex column with a static top bar; removed the mobile `.review-detail` top offset that compensated for the sticky bar.
- apps/admin/src/components/Shell.tsx: `data-nav-open` on `.app` replaces the body overflow lock; `<main>` ref resets scrollTop on route change and takes focus when nothing is focused (keyboard scrolling); skip link scrolls the container.
- apps/admin/src/components/Ideas.tsx: the "suggested card is on screen" check uses `<main>` bounds instead of `window.innerHeight`.
- apps/admin/src/components/__tests__/Shell.scroll.test.tsx: new.

## Validation

- vitest: Shell.scroll, UserSettings, Ideas.quick, a11y, OverviewRefresh, review.i18n, bugs.i18n, memberDetail.i18n, LanguageSettings all pass; `tsc --noEmit` and eslint on touched files clean.
- Headless browser, mock mode, 1440x900 and 390x844: document scrollHeight equals clientHeight on 4 pages; `<main>` scrolls; sidebar and top bar rects identical before and after scrolling to the bottom; window.scrollTo has no effect; PageDown scrolls without a click; route change via drawer link lands at scrollTop 0 with `<main>` focused; drawer opens and closes with the page behind it unmoved. Element rects of 4 pages compared with the old layout (injected old CSS): descendants identical on mobile, 1px width difference on desktop from scrollbar-gutter rounding.
- Not verified: real rubber-band or overscroll glow (cannot be produced in headless Chrome), Safari, iOS.

## Decisions

- Both desktop and mobile use the shell, so the mobile top bar is static too.
- `overflow: clip` on `.app` (not hidden) so focus or scrollIntoView cannot shift the shell.
- `:has(.app)` scopes the lock so login and boot screens still scroll the document.

## Handoff

Check on a real Mac Safari, iPhone Safari and Chrome that pulling past the top or bottom bounces only the content while the sidebar and top bar stay put, and note that iOS browser toolbars no longer collapse on scroll because the document does not scroll.

