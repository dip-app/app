# Work session

User: sandervonk
Date: 2026-11-17
Workstream: cover-library
Agent: Claude (Opus lead, Sonnet subagents)
Status: active

## Summary

Event cover library: a labeled manifest of hosted covers (`catalog://cover/<key>`), import/validate/index tooling with a Pexels fetcher waiting on the owner's key, server allow-list and Jev-based cover picking (pickEventCoverV1 and Dipbot drafts), share-page mapping, iOS remote resolution, and an admin CoverPicker with search, theme filters and "Let Dipbot choose".

## Changes

- Catalog and tooling: `apps/admin/public/img/covers/` (manifest + 14 seed covers, 1.1 MB), `scripts/covers/` (seed, import, validate, generate-index, fetch-pexels, query-plan.json, tests), `docs/design/cover-library.md`, root `covers:*` scripts, `sharp` as an explicit admin devDependency.
- Contract (additive): `PickEventCoverRequest`/`PickEventCoverResponse`; `GeneratedEventDraft.coverImageURL` accepts `catalog://cover/<key>`; docs/contracts updated.
- Server: `gcp/functions/src/modules/covers/` (generated index, allow-list, broad shortlist, Jev Choice step `coverPick`, `pickEventCoverV1`, `aiCoverPicks` request doc); organizer/ai/suggestions/share use `isApprovedCoverURL`; Dipbot drafts pick covers inside the existing per-draft decision call with batch exclusion.
- iOS: `DIPEventCover` maps `catalog://cover/<key>` to the hosted WebP via `MediaReference.remoteCover` with the bundled tag cover as placeholder/fallback; debug-only `--cover-library` mock flag.
- Admin: `CoverPicker` in the event editor and Dipbot draft cards (PR 2).

## Validation

- `npm run check:generated`, `npm run test:contracts` (57 pass), `npm run build`, `npm run covers:validate`, `npm run test:covers` (13 pass), targeted gcp unit files covers/ai/share/organizer/suggestions/email (434 pass), `npm run test:docs`.
- `swift test --package-path ui/Packages/DIPCore --filter EventCover` (9 pass); one Debug simulator build with `--mock-member --cover-library` (shows the bundled fallback because the hosted files are not deployed yet).

## Decisions

- Legacy `catalog://default/*` stays canonical for the five original photos (old app builds keep bundled images); new covers use `catalog://cover/<key>`.
- WebP for app/admin; a 960 px JPEG per cover for email and og:image (Outlook and some unfurlers lack WebP).
- Owner decisions: Jev Choice over a broad, non-eager candidate set (all eligible covers up to 60, two-call theme-group split above the per-call limit), deterministic fallback; request doc logs provider, shortlist size and whether the pick was outside the top lexical ranks.
- Seed limited to images already public on the site plus repo theme art; prototype photos are flagged `prototype-unconfirmed` for replacement.
- Credits (rebased on #277): `coverPick` costs 1 credit (`CREDIT_COSTS`, `creditCost.coverPick`), charged before the model call per `requestId`, refunded when no model answered; no credits means `AI_CREDITS_EXHAUSTED`. Dipbot draft covers are free (inside the per-draft draftCheck).

## Handoff

- Owner: add `PEXELS_API_KEY` to the dip-app/secrets repo, then run the workflow in docs/design/cover-library.md to import ~170 covers.
- Deploy: hosting (new image files) and functions (index, `pickEventCoverV1`); optional TTL policy on `aiCoverPicks.expireAt`.
- Admin UI may show `creditCost.coverPick` on "Let Dipbot choose" and handle `AI_CREDITS_EXHAUSTED`; hand-written admin types do not yet list `coverPick`.
