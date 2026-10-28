# 0003 — Design-system foundations

Status: proposed (initial setup baseline)
Date: 2026-10-28
Owners: repository maintainers; assign real reviewers before implementation

## Context

The team needs multiple humans and agents to implement DIP in parallel without drifting contracts or overwriting shared files. V1 is due November 9, 2026; setup must enable work without pretending features are built.

## Decision

Use semantic tokens sourced from the inspected Figma Home frame, generated Swift constants in an independent package, and reviewed presentation-only component APIs. Preserve source/proposal distinction. UI foundations owns shared components while other workstreams own feature behavior.

## Consequences

Fonts are not bundled, dark mode and contrast are unresolved, and no component is implemented. Asset provenance/license/export metadata must accompany future assets. Do not claim Code Connect mappings exist.

## Validation and references

See [affected specification](../design/README.md), root PROVENANCE.md, and SESSION.md. Validate generated drift, cross-language fixtures, package builds, emulator security tests and session handoffs before accepting dependent feature PRs.
