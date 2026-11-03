# Work session

User: sandervonk
Date: 2026-11-03
Workstream: 02-accounts-profile
Agent: Claude Sonnet 5.5
Status: completed

## Summary

Made Google sign-in work in the Simulator against the deployed team05-dip project and fixed profile avatars.

## Changes

- project.yml: keychain-access-groups entitlement (generated ui/Config/DIP.entitlements is gitignored). Google Sign-In failed with `GIDSignIn code -2 keychain error` without it.
- Only the large Profile photo uses a real picture (stored photoURL, else the Google account photo). The small header and Home avatars stay the bundled colored character, which also fixes the unrounded Home avatar.

## Validation

- MemberProfileBridgeTests: 11 tests pass. Verified in the Simulator: sign-in with a CMU account reaches Home; Home and Profile avatars look right.
- Deployed to team05-dip this session: Firestore indexes, rules, resolveMembershipV1 (PR #24 lookup by companies.emailDomain). Both live companies had emailDomain set; the company that mapped arianneai.com and cmu.edu now keeps cmu.edu.
- Not done: the live `companyDomains` documents are not deleted yet.

## Decisions

- Local-only files created, never committed: ui/DIP/Support/GoogleService-Info.plist, ui/Config/Local.xcconfig.
- A Simulator App Check debug token was registered through the App Check API.

## Handoff

Delete the live companyDomains documents after confirming sign-in on other accounts. Release builds still need the App Attest setup noted in FirebaseBootstrap.
