# 0004 — Session handoffs

Status: accepted (workflow requested by repository owner)
Date: 2026-10-28
Owners: repository maintainers; assign real reviewers before implementation

## Context

The team needs multiple humans and agents to implement DIP in parallel without drifting contracts or overwriting shared files. V1 is due November 9, 2026; setup must enable work without pretending features are built.

## Decision

Maintain one session log per person/agent work session spanning multiple commits. Require at least one newly added valid log per PR, with content validation in CI. Commit messages continue describing individual changes.

## Consequences

No per-commit log requirement or forced large commits. CI validates presence/structure, not truth. GitHub branch protection must make session-handoff check required for enforcement.

## Validation and references

See [affected specification](../../SESSION.md), root PROVENANCE.md, and SESSION.md. Validate generated drift, cross-language fixtures, package builds, emulator security tests and session handoffs before accepting dependent feature PRs.
