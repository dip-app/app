# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Mock-member launch mode
Agent: Claude Code
Status: complete

## Summary

Debug-only mock launch mode for the real DIP app: `--mock-member` / `DIP_MOCK_MEMBER=1` boots the signed-in member shell on in-memory repositories; `--mock-onboarding` starts signed out for the first-run flow. No Firebase, App Check, keychain or network.

## Changes

- ui/DIP/App/MockLaunch.swift (new, #if DEBUG; Release stub returns nil)
- ui/DIP/App/DIPApp.swift (skip Firebase configure in mock mode, mock repository, mock snapshot)
- ui/DIP/Features/Accounts/DIPMemberHome.swift (optional mockSnapshot init parameter; seed(base:))
- ui/project.yml (new DIPUITests target and scheme entry)
- ui/DIPUITests/MockMemberLaunchUITests.swift (new)
- ui/README.md (usage)

## Validation

- xcodegen generate; xcodebuild build generic iOS Simulator: succeeded.
- xcodebuild test -only-testing:DIPUITests on Claude-DIP simulator: 2 tests passed (4 tabs; event opens with venue address).
- Manual launch screenshot confirmed real Home shell with dated events. Default text size only.

## Decisions

- Reused PreviewAccountsRepository (member Sam Rivera, company-demo) and DIPMockFixtures.v1Events (venue and address).
- `--mock-role=admin` skipped: the member shell reads no role.

## Handoff

None pending. npm checks were not rerun (no contract/token changes).
