# 0001 — Monorepo boundaries

Status: proposed (initial setup baseline)
Date: 2026-10-28
Owners: repository maintainers; assign real reviewers before implementation

## Context

The team needs multiple humans and agents to implement DIP in parallel without drifting contracts or overwriting shared files. V1 is due November 9, 2026; setup must enable work without pretending features are built.

## Decision

Use gcp/ for all Firebase backend artifacts and sample data, ui/ for the Swift workspace and design foundations, contracts/ for machine-readable schemas/fixtures, docs/contracts for human handoffs, docs/design for visual-system specs, and docs/milestones/v1 for independently owned workstreams. XcodeGen avoids project-file merge conflicts.

## Consequences

Shared manifests, index exports, rules, contracts and tokens still need one integrator. Independent branches/worktrees are required for parallel agents.

## Validation and references

See [affected specification](../milestones/v1/README.md), root PROVENANCE.md, and SESSION.md. Validate generated drift, cross-language fixtures, package builds, emulator security tests and session handoffs before accepting dependent feature PRs.
