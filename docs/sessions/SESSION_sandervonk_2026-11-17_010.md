# Work session

User: sandervonk
Date: 2026-11-17
Workstream: members-google-photos
Agent: Claude
Status: completed

## Summary

Members now show their Google profile photo in the admin portal. resolveMembershipV1 stores the Firebase Auth `picture` claim as `users/{uid}.photoURL` (first sign-in, and later sign-ins only while the stored value is empty). A dry-run-by-default backfill fills existing members from Firebase Auth. The portal has a shared Avatar with a photo, mascot, initials fallback chain, and the CSP allows Google image hosts.

## Changes

- Backend: `gcp/functions/src/modules/accounts/domain/photoUrl.ts` (strict validation and size-suffix stripping), `domain/membership.ts` (picture on identity, fill-if-empty decision), `application/{ports,resolveMembership}.ts` (`fillPhotoURL`), `infrastructure/firestoreMembershipStore.ts`, `transport/resolveMembershipV1.ts` (reads the `picture` claim).
- Backfill: `gcp/functions/src/modules/accounts/application/backfillPhotos.ts`, `gcp/scripts/backfill-member-photos.ts`.
- Admin portal: `apps/admin/src/components/Avatar.tsx` (re-exported from `Ui.tsx`), Member type/adapter/mock gain `photoURL`, members list, member detail and attendee picker use it, `styles/pro.scss`, mock photos in `public/img/mock-photos/`, mock storage key bumped to v4.
- `firebase.json`: report-only CSP `img-src` adds `https://*.ggpht.com` (`*.googleusercontent.com` was already allowed).
- Docs: `docs/contracts/admin.md`, `apps/admin/README.md`, privacy page wording.
- Tests: `gcp/tests/unit/accounts-google-photo.test.ts`, `accounts-resolve-membership.test.ts` (fake store), `apps/admin/src/components/__tests__/Avatar.test.tsx`.

## Validation

- `node --import tsx --test gcp/tests/unit/accounts-*.test.ts gcp/tests/unit/admin-*.test.ts`: 234 pass.
- `npm run build` (functions tsc): ok. In apps/admin: `tsc --noEmit`, `eslint src`, `vitest run` (193 pass, 2 skipped).
- Screenshots at 1440 and 390 in mock mode (photos, mascots, initials), reviewed by a design auditor; contrast and ring feedback applied.
- Not run: rules tests (rules unchanged), full suites, anything against production.

## Decisions

- Firestore rules unchanged: the field is written by the Admin SDK only; clients could already edit their own `photoURL` (allowlisted), and a non-empty value is never overwritten.
- Stored form is size-less; clients append `=s96-c` (portal uses `=s192-c` at 64 px).
- The backfill follows the dry-run/`--apply`/`--yes-owner-approved` convention of `backfill-tag-stats.ts`; it prints counts only.
- A profile reset clears `photoURL`; the next sign-in refills it from Google.

## Handoff

Deploy functions (resolveMembershipV1) and hosting (admin + firebase.json headers), then run the backfill dry run and apply with owner approval. Roster rows, attendee list and overview top members still show initials (their data has no photo yet). The iOS app still shows the OAuth photo locally and does not depend on this field.
