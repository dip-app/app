# Work session

User: sandervonk
Date: 2026-11-01
Workstream: 01-ui-foundations
Agent: Codex with independent OAuth/configuration review
Status: active

## Summary

Auditing current main and reconciling PR3 after the accounts/OAuth merges. PR3 is not superseded: main still launches a placeholder, while the native prototype and component library remain unique to PR3.

## Changes

- Combine current main OAuth contracts, GoogleSignIn/FirebaseCore/DIPAccounts, local xcconfig and redirect handling with DIPCore/native preview packages.
- Preserve both accounts integration and native UI CI gates; Markdown remains excluded from app resources.
- Prototype profile editing cannot alter OAuth-owned display names. Configured/Release builds do not silently substitute mock company data.
- Independently identified existing-profile membership-resolution bypass and Google callback-scheme crash risk; fixes tracked with session006 before merge.

## Validation

- Previous PR3 head has five green CI checks. Current main e2c41e7 has six green checks. All merged/superseded PR relationships were audited.
- Updated DIPCore profile ownership tests pass15/15. Combined app, package, repository and UI checks are pending before publication/merge.

## Decisions

- Keep and merge PR3 after resolving main conflicts; it is not a duplicate. Preserve accepted ADR0007 over obsolete email/password/join-code behavior.
- Keep source/main readiness distinct from deployment and live Google/device validation. Next helpful UI area is the Google-only entry/company-resolution gate.

## Handoff

Finish combined tests and OAuth/configuration fixes, update PR3, merge only the verified head, then branch the next UI work from actual merged main. Do not reintroduce closed email/password onboarding or silently show fixture data as an authenticated company.
