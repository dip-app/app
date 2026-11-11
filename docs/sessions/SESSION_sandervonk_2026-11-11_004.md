# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Pill outline/solid rule
Agent: Claude Code
Status: active

## Summary

Pill rule: solid means pressable, outline means informational. Shared DIPActionPill with solid and outline styles; Goal/Reward on the challenge page are outline pills; Home/My Events header title pill is outlined; the event page calendar pill is solid.

## Changes

- ui/DIP/Features/Shared/DIPActionPill.swift (new), DIPDetailComponents.swift (action row uses the shared pill; calendar pill solid), Challenge/DIPChallengeDetailsScreen.swift, DIPDesignSystem DIPHomeComponents.swift and DIPHeader.swift (outlined title pill), ui/ComponentPreview/UITests/PillRuleTests.swift, docs/design/components.md (rule note).

## Validation

- One Preview UI run (PillRuleTests, 2 tests) passed with captures; no other suites by owner request.

## Decisions

- Outline pill colour is the action primary token; identifiers unchanged.

## Handoff

Possible rule violations left as is: white filled informational chips (hero tags, "N Attending", "+ N others participating"); onboarding step pill not touched.
