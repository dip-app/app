# Work session

User: sandervonk
Date: 2026-11-18
Workstream: admin-ideas-venues-fixes
Agent: Claude Code
Status: completed

## Summary

Two owner-reported admin portal bugs. (1) The "Ideas for you" cards had a fixed height, so wrapped chip rows clipped the "Customize with Dipbot" link and the image. (2) The Dipbot venues block in the event editor Where section vanished after "Find venues" failed in production, where the venue flags are still off.

## Changes

- apps/admin/src/styles/_ideas.scss: `.ifu-card` uses `min-height` (160 desktop, 190 phone) instead of `height`; list items stretch to equal heights; thumb stretches with the card; why text and the customize link wrap instead of overflowing.
- apps/admin/src/components/DipbotVenues.tsx: root cause was the `AI_VENUES_DISABLED` branch calling `setDisabled(true)`, which made the component return null. Removed that state. Every failure now sets an `error` phase rendered with the kit `InlineNotice` (plus a kit `Button` "Try again" where a retry makes sense). `venueFailure` maps AI_VENUES_DISABLED/PLACES_DISABLED, credit and daily limits, resource-exhausted, unauthenticated, permission-denied and network/unknown errors. When the office is unset and address search is unavailable, a note replaces the empty space.
- apps/admin/src/components/AddressCombobox.tsx and WhereSection.tsx: on PLACES_DISABLED the combobox stays mounted as a plain field with a small note, instead of the parent swapping to a different input (which dropped focus mid-typing). Typed text is kept.
- apps/admin/src/lib/aiStrings.ts, src/styles/_where.scss: new strings and notice styling.
- apps/admin/src/components/__tests__/Where.test.tsx: failure cases per code (block stays, fields kept, retry works), office-unset note, Places-disabled typing.

## Validation

- Server check (read only, no change): gcp/functions findVenues.ts runs authorize, the rate limiter, then the `!deps.enabled || !deps.places` check (AI_VENUES_DISABLED) before the ledger transaction that charges credits, so a disabled search never charges.
- `npx vitest run` on Where, AddressCombobox and IdeasForYou tests: 57 passed. `npx tsc --noEmit` and `npx eslint src/components src/lib`: clean.
- Mock-mode screenshots at 1440, 1024, 768, 390, and 200%/300% zoom, plus collapsed state: a fresh auditor subagent returned PASS for every card crop. It flagged the Credits line above the section overflowing at about 341 CSS px (300% zoom of 1024); not changed here.
- Full suites not run (targeted tests only).

## Decisions

- The ctx.enabled probe (Dipbot off for the company) still hides the block; only a failed search keeps it visible.
- AI_VENUES_DISABLED shows a warn-tone notice with retry, copy says no credit was charged (true per the server order above).

## Handoff

- Not deployed. Backend flags PLACES_ENABLED and AI_VENUES_ENABLED stay off in production until the owner turns them on.
- Optional follow-up: let the Credits meter line wrap at very large zoom.
