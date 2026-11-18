# Work session

User: sandervonk
Date: 2026-11-18
Workstream: ideas-card-image
Agent: Claude
Status: completed

## Summary

"Ideas for you" cards: wider card, extra width given to the image, image area at least as wide as it is tall wherever the width allows. CSS only.

## Changes

- apps/admin/src/styles/_ideas.scss: card 440px wide (2-up from 900px container width), image column clamp(120px, 46%, 220px). The image no longer sets the card height (the img used its intrinsic ratio and made cards 276px tall); it is height 0 with min-height 100%, so the text sets a 188px minimum and the image fills it (220x186 at desktop, about 200x194 at tablet). Phones (container under 480px) stack: full-width 124px image on top, text below (card 315x292); skeleton cards use the same geometry.

## Validation

- Mock dev server, measured and screenshotted at 1440, 1024, 768, 720 (200% zoom), 520 and 390, collapsed and expanded, 1, 3 and 5 cards, skeleton state, horizontal scroll and snap on phone. Cards equal height, skeleton and real card sizes identical, nothing clipped.
- Fresh design auditor: PASS after one round (first FAIL came from comparing differently scaled screenshots).
- IdeasForYou vitest (18 passed), tsc and eslint on touched files clean.

## Decisions

- Phone widths stack the image above the text, since a side image cannot be as wide as a 290px card is tall.
- Pixel-exact square is not guaranteed if a card gets three chip rows at about 440px card width (the card grows a little taller than the image is wide).

## Handoff

Nothing pending. Not deployed.
