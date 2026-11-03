# 0005 — Observable repositories for the SwiftUI app

Status: proposed
Date: 2026-10-29

## Context

The Figma prototype needs exact fixture content while backend features are developed independently. Inline screen arrays and successful-looking local writes would require replacing screen logic when Firebase arrives. The human explicitly requires interchangeable mock and backend adapters.

## Decision

Use the local DIPCore package for Foundation-only read models and DIPRepository. DIPPresentation contains the observable, main-actor DIPAppViewModel. DIPMockData is a separate in-memory actor implementing the protocol. Only the app composition root selects a concrete implementation; feature screens take values and callbacks.

The repository exposes an asynchronous snapshot stream and throwing commands. A successful command acknowledgement never directly assigns rendered state; observation supplies committed changes. The mock publishes through that stream too. UI drafts, navigation, picker presentation and animation remain local UI state. Stable IDs drive navigation, independent of display titles and asset names. MediaReference supports bundled assets, URLs and picker bytes; the presentation media adapter renders them without Firebase SDK types.

DIPAppSnapshot is an app read projection, not a wire schema or a tenant-wide fetch API. A future Firebase adapter must merge authorized queries/listeners, implement listener cleanup and error mapping, and split observation by feature/pagination when data volume warrants it. Authenticated user/company scope belongs in that adapter's construction. Views cannot choose another identity or set roles, balances or counts.

## Backend handoff

See [repository mapping](../contracts/ui-repositories.md). Existing versioned callable and Firestore contracts remain authoritative. Chat and photo imports expose preview seams only; their V2 wire contracts and authorization still need implementation. No Firebase adapter, backend endpoint or cloud deployment is delivered here.

## Consequences and verification

The backend integration replaces the injected repository and supplies SDK-to-domain mappings without replacing screen layouts or interaction callbacks. Authentication lifecycle, query pagination and production media handling remain adapter work. Read projections can evolve without silently changing stored DTOs.

Tests use both the in-memory mock and an independent controlled repository to verify command acknowledgement versus listener state, failures, reconnects and idempotent mock RSVP. Simulator tests protect the original screens and interactions. Fixture inconsistency (Home Puppy Yoga count 7, detail count 16, Participants 17) is retained as supplied design evidence, not asserted as production data consistency.
