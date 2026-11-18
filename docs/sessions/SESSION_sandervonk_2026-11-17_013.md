# Work session

User: sandervonk
Date: 2026-11-17
Workstream: admin-chart-tooltip
Agent: Claude
Status: completed

## Summary

Activity chart hover tooltip (hover, keyboard, tap), one Disclosure component replacing the native details/summary.

## Changes

apps/admin/src/components/{Overview,Chevron,Disclosure}.tsx, components/__tests__/ActivityChart.test.tsx, lib/insights.ts (tooltipDay, placeTooltip, stepDay), styles/_overview.scss, styles/pro.scss. The chart's was the only native details in apps/admin.

## Validation

npx vitest run (apps/admin, 245+ tests pass), tsc --noEmit, eslint src. Manual 1440 and 390 in mock mode; auditor round 1 flagged tooltip occluding bars, fixed by anchoring at the plot top; no second round.

## Decisions

Hand-rolled SVG kept; tooltip anchored to the column, flips at the right edge; live region announces keyboard/tap days only.

## Handoff

