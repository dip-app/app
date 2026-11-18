# Work session

User: sandervonk
Date: 2026-11-18
Workstream: card-image-stretch
Agent: Claude
Status: completed

## Summary

Dipbot option cards: the art tile did not fill the card height when row heights differed. Root cause: `.opt-body` kept `align-content: center`, so the single grid row sized to the content (50.8 px) and sat centered in a taller card (white bands, 14 px top and bottom).


## Changes

- apps/admin/src/styles/_ideas.scss: `.opt-grid` gets `grid-auto-rows: 1fr`; image-led `.opt-body` gets `grid-template-rows: 1fr; align-content: stretch`; `.opt-art` gets `align-self: stretch; height: 100%`. Option is the only card component and `.opt-art` is its one shared class (Overview Interests is a table, not cards).


## Validation

Browser (mock, admin) with getBoundingClientRect: art and img height equal card inner height (under 1 px) and left/top flush, all cards in a row equal height, at 1440, 1024, 768 and 390 px on Dipbot steps 1-4, tags=live (17 fallback mascot cards), a long name and a selected card. Before: art 50.8 px in 79 px cards. Independent design audit: PASS. Targeted checks only.


## Decisions


## Handoff

