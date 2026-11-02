# 0002 — Firebase callable contracts

Status: proposed (initial setup baseline)
Date: 2026-10-28
Owners: repository maintainers; assign real reviewers before implementation

## Context

The team needs multiple humans and agents to implement DIP in parallel without drifting contracts or overwriting shared files. V1 is due November 9, 2026; setup must enable work without pretending features are built.

## Decision

Use Firebase native callables for membership, RSVP and organizer mutations, with Firestore live reads. Schema-generated Swift and TypeScript DTOs avoid independently invented endpoints. Keep tenant membership and privileged fields server-owned. Move company join codes to private lookup and add Event.revision for concurrent edits. (Join codes were later replaced by email-domain membership; see [ADR 0007](0007-oauth-domain-based-sign-in.md).)

## Consequences

This deliberately changes the source direct-RSVP-plus-counter-trigger approach. Functions must implement transactions, idempotency and authorization; rules remain deny-all until reviewed policies arrive. Existing seeds need explicit migration. No endpoint is implemented here.

## Validation and references

See [affected specification](../contracts/callables.md), root PROVENANCE.md, and SESSION.md. Validate generated drift, cross-language fixtures, package builds, emulator security tests and session handoffs before accepting dependent feature PRs.
