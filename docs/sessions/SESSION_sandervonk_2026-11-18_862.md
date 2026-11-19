# Work session

User: sandervonk
Date: 2026-11-18
Workstream: opt-border
Agent: Codex
Status: completed

## Summary

Selected Dipbot option cards: the second border pixel was an inset box-shadow painted under the option art, so the image covered it. It is now an overlay (::after) above the contents.

## Changes

- apps/admin/src/styles/_ideas.scss: checked .opt-body draws its inner border with ::after.

## Validation

- CI admin build compiles the SCSS; visual check after deploy.

## Decisions

- Overlay instead of border widening so card geometry does not shift.

## Handoff

No pending work; deploy the admin site after merge.

