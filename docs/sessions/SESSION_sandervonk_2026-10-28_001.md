# Repository setup session

User: sandervonk
Date: 2026-10-28
Workstream: setup-and-integration
Agent: Codex with design-system, project-docs and Firebase setup subagents
Status: handoff

## Summary

Prepared the setup branch for coordinated human and agent development. Read the Sprint 3 archive, inspected Figma Home through MCP and indexed the Final page metadata. The user clarified setup only, requested gcp/contracts/ui/docs boundaries, independent workstreams, provenance, ADRs and session handoffs.

## Changes

Created Firebase Functions scaffolding, emulator rules/tests, guarded synthetic sample data; Swift workspace generation and dependency-free contracts/design-token packages; shared schemas/fixtures and specified callable/data ownership contracts; five V1 work packets and V2 scope; design component contracts; AGENTS.md, SESSION.md, PROVENANCE.md, ADRs, CI and contribution templates. No product endpoints, screens or workflows were implemented beyond a bootstrap app placeholder. Actual clone is /Users/sander/Documents.nosync/dip-app; the earlier requested path was superseded by the user's clone.

## Validation

- npm ci from committed lockfile succeeds on Node24.22.1.
- Generated contract/token drift checks and session-validator positive/negative checks pass.
- 13 contract/sample-data checks pass, including unsafe seed-destination refusal cases.
- Backend builds on Node24 and Node22.19.0; its seven feature tests remain explicit TODOs and do not establish product coverage.
- Real Firestore and Storage emulators: 8 deny-all baseline checks pass with finalized dependencies.
- Auth/Firestore seed run twice: each restores 2 synthetic users and 7 documents; both runs exit successfully.
- Swift packages: 1 shared-fixture round-trip test and 3 design-token/accessibility tests pass.
- XcodeGen creates the iOS project. Full iOS app SDK resolution, simulator build and device tests were not run; this is setup only.
- All local Markdown links resolve; five V1 work packets exist.
- Production Functions dependency audit reports 0 vulnerabilities. Root developer tooling retains 5 moderate advisories; details in docs/maintenance.md. No high/critical advisories remain in the setup lockfile.
- Initial GitHub CI passed all five jobs on 011e379, including the real session gate, Node22 build, Swift foundations, security rules and repeat seed. Branch protections remain a maintainer handoff.
- Final review aligned backend module ownership guidance and allowed same-session log updates for push checks; PRs continue requiring a newly added session log.

## Decisions

Use Firebase callables for privileged V1 commands and Firestore live reads. Propose transaction-based RSVP instead of a client write plus async counter trigger, Event.revision for organizer conflicts, and private company-code lookup instead of public joinCode. These cross-team decisions remain proposed ADRs. Local test tooling requires Node24.12+; deployed functions remain Node22. One session log covers a working session across multiple commits, with a PR-level new-log check instead of a per-commit gate.

## Handoff

Assign the five V1 packets and actual review owners. Confirm proposed architecture/security contracts, project IDs/region, bundle ID/minimum OS, and design gaps before dependent implementation. Keep rules deny-all until feature-specific policies and adversarial tests land. Product functions, repositories, screens, coverage thresholds and V2 implementations are future work. Configure real CODEOWNERS and GitHub branch protections; checked-in CI alone does not make checks mandatory. This was an empty remote, so setup was the first content branch. The repository owner then authorized merging to main; main is being established from the accepted setup and selected as default. No history is overwritten.
