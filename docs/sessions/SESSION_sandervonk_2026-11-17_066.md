# Work session

User: sandervonk
Date: 2026-11-17
Workstream: admin-quality-audit
Agent: Claude (Opus 5.5 lead, Sonnet subagents for reviews, fixes and tests)
Status: handoff

## Summary

Ran a quality audit of the admin portal: every route except the AI ideas flow, which another workstream is still changing. The login page's look was left as is. The audit covered:
- Visual consistency, UX flows, WCAG 2.2 AA, performance, UI-layer security and copy.
- Breakpoints 1440, 1280, 768 and 390, in mock mode, as admin and as organizer.

The fixes below went into one PR. Before the fixes, axe found serious color-contrast violations on every route. After them, it reports zero violations on all 17 routes. Findings, severities and what is still open are in `docs/quality/admin-audit-2026-11.md`.

## Changes

- **Foundation:** `styles/pro.scss`, `_nav.scss`, `_admin.scss`, `globals.scss`, `Shell`, `Ui`, `Dialog`, `AppProvider`, `lib/asset.ts`, and new `error.tsx`, `global-error.tsx` and `not-found.tsx`.
  - Accessible `--primary` (#5562dc) for filled purple surfaces, 3:1 control borders and the focus ring.
  - No one-sided borders, fixed image base paths, the theme picker on one row, and phone and tablet layout fixes.
  - Skip link and page titles.
  - Error boundaries, an error state at boot, and the Firebase SDK loaded lazily.
- **Flows:** `useQueryState`, `Tabs`, `RadioGrid`, `TableRegion`, `Toast`, `useUnsavedGuard`, `useSlashFocus`, the `usePaged`/`useLoad` fixes, `_flows.scss`, and every list and form page.
  - Filters are kept in the URL, with toasts and Undo, plus confirmations for canceling an event, changing a role and stopping an import.
  - `requires` gating on the theme and event forms, and a toggle for the review keyboard shortcuts.
  - US English copy.
- **Lead fixes:**
  - The `<title>` comes from `Shell`, and the root metadata title is removed so it no longer overrides it.
  - Label-in-name fixes and tablet table scrolling.
  - Neutral destructive buttons in rows, and the toast stripe is removed.
  - `firebase.json` for `/admin/**`: `Content-Security-Policy-Report-Only`, `Permissions-Policy`, and an immutable cache for `/admin/_next/static/**` (the existing rule never matched admin chunks).
- **Tests:** `src/components/__tests__/{TableRegion,Tabs,Toast,Dialog,a11y}.test.tsx` and `src/lib/__tests__/{useQueryState,usePaged}.test.tsx`. New dev dependencies: jsdom, @testing-library/react, @testing-library/dom, axe-core (`apps/admin/package.json` and its lock), plus `vitest.config.ts`.
- **Docs:** `docs/quality/admin-audit-2026-11.md` (new) and the "UI conventions" section of `apps/admin/README.md`.

## Validation

- **axe-core 4.14 in the browser** (WCAG 2.0/2.1/2.2 A and AA plus best practice) on 17 routes, before and after. After: 0 violations.
- **apps/admin, targeted checks:**
  - `npx tsc --noEmit` and `npx eslint src`: clean.
  - `npx vitest run` on themes, api, insights and submissions: pass.
  - The flows subagent ran the component and hook tests (80 passed). The only 2 failures were the known date-dependent ones in `adminTools.test.ts`, which fail the same way on main.
- **`npx next build`** (mock): 23 static pages, first load JS 132 to 150 kB per route, 102 kB shared. A grep of `out/` for secrets found nothing.
- **Visual checks:** screenshots at 1440, 1280, 768 and 390, plus the shared design auditor. Round 1 failed, and the blocking items were fixed. Round 2 passed after three alignment fixes: the orphan phone filter, card label baselines and tablet cell wrapping.
- `python3 scripts/check-docs.py`: OK.
- No full suites were run (targeted tests only).

## Decisions

- **Colors** live in admin SCSS custom properties, not in `ui/DesignSystem/tokens.json`. That file is a shared choke point and needs an integrator.
- **CSP** ships as Report-Only, because live Google sign-in, App Check and Storage cannot be verified from here. `'unsafe-inline'` scripts are required by the Next static export.
- **Undo** exists only where the API has a true inverse (check-in). Removal is confirmed instead.
- **Theme management** is gated to admins in the UI, matching `challenge.manage` on the backend.

## Handoff

Open items are in the doc's tables, marked Open or Partial:
- Server paging for events, themes, attendees and albums, and a summary endpoint for pending submission counts.
- Column sorting.
- Thumbnail-size event images.
- Enforcing the CSP after a preview-channel check.
- Failing deploy builds that lack the live config.
- Treating a deactivated admin as signed out.
- Guarding in-app navigation for unsaved changes.
- Moving the colors into `tokens.json`.
- Re-running axe on `/ideas/` once that work lands.
