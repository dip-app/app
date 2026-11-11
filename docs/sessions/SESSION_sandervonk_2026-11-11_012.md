# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Fixed tab header
Agent: Claude Code
Status: completed

## Summary

The Home / Rewards / My Events header (outlined title pill plus bell and avatar capsule) no longer slides with the page. The shell draws it once, fixed; only the title text changes (blur-replace) while the outlined pill animates to the new label width (DIPMotion.marker). On Profile, which has its own header card, the fixed header fades and lifts away and keeps its last label, then returns when another tab is selected.

## Changes

- ui/Packages/DIPDesignSystem/.../DIPHomeComponents.swift: environment value `dipHeaderHosted`; DIPHomeHeader renders only a same-height spacer when hosted (page layout is unchanged) and otherwise animates a changed title (blurReplace, opacity only under Reduce Motion) with the pill width animated.
- ui/DIP/Features/Prototype/DIPPrototypeApp.swift: `fixedHeader` overlay on the root of the NavigationStack (so pushed screens such as the event page keep covering it with their own headers); tab pages get `dipHeaderHosted` except Profile; `headerTab` keeps the last non-Profile label.
- Captures: ui/ComponentPreview/Review/Header/header-rewards.png, header-profile.png.

## Validation

- Preview scheme build succeeded. Spot check: tapping Rewards shows the same header with "Rewards"; Profile shows no header, only its own card. No test suites run (owner: one compile and one capture).

## Decisions

- Pages are switched by the bottom bar only (the page-view scroll is disabled), so there is no interactive page swipe to interpolate against; the label changes when the tab changes and the page slide plays at the same time.
- Skipped the optional avatar travel between the header capsule and the profile badge: the Profile page lives in a separate UIHostingController from the shell overlay, so matchedGeometryEffect cannot span them, and a manual cross-controller animation risked glitches when a slide is interrupted. The header avatar simply fades with the header.

## Handoff

If the avatar travel is wanted later, host the header and Profile badge in one SwiftUI hierarchy (or drive a shared overlay from the page-slide progress). Mid-transition frames were not captured.
