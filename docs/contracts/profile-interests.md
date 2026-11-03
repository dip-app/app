# Profile interests: existing V1 contract and UI mapping

The authoritative existing sources are [Tag and AppUser schemas](../../contracts/v1/models.schema.json), [data ownership](data-ownership.md), and [account profile validation](accounts-integration.md). This document clarifies the frontend mapping; it introduces no callable, stored field, or wire version.

- Catalog: shared `tags/{tagId}` documents. Tag fields are `name`, `icon`, and `sortOrder`; its ID is Firestore snapshot metadata. Catalog writes remain trusted seed/admin operations. This is not a free-text tag-creation feature.
- Selection: `users/{uid}.interestTagIds`, at most ten nonempty strings, each at most 120 characters. Profile edits remain own-user allowlisted updates; OAuth identity, membership, roles and balances stay server-owned.
- UI: `DIPInterest` carries stable ID, display name, icon and order. `DIPProfile.interestTagIDs` and `ProfileEdit.interestTagIDs` contain IDs. Display names are resolved from the catalog, searched locally and never sent as IDs. Catalog order controls rendering and saved selection order.
- Adapter: map snapshot IDs to `DIPInterest.id`, and `AppUser.interestTagIds` to `DIPProfile.interestTagIDs`. Map the profile command back to the existing account write boundary, preserving other observed editable fields. No per-keystroke write; explicit Save submits once and only observation changes the displayed profile. Sign-out disposes the signed-in UI/repository lifetime.
- Missing/renamed catalog entries: renaming a label does not change selection. Existing missing IDs remain visible as “Unavailable interest” and may be retained or removed; a new unknown ID cannot be selected through this UI. Do not silently erase stored selections when catalog loading fails.
- Empty selection is valid. Cancel discards only the picker draft. A picker inside Edit profile stages selection; only the outer profile Save persists it. Failed writes retain selections and support retry. The repository enforces the same maximum as the picker.

## Readiness

The signed-in app now uses `DIPMemberHome` to bridge observed membership profile data and the account interest catalog into Profile. It constructs `ProfileEditor` and `InterestCatalog` with the same account-repository instance used by the app session. Explicit profile saves use the editor's UID-bound account write boundary; `MemberProfileBridge` preserves unrelated editable fields, and command acknowledgement does not replace observed profile data. Catalog loading, failure and retry are explicit. Retired or temporarily missing tag IDs remain retainable/removable; loading failure must not erase them.

The member host is keyed by UID; sign-out removes it and clears its profile/editor/catalog and prototype lifetime. With Firebase configured, profile/catalog reads and saves use the existing Firebase account adapter. Debug preview accounts and standalone fixture hosts remain in-memory. The preview catalog is explicitly synthetic and is not production seed data.

This is a profile/catalog bridge, not a live adapter for all Home data: events, chat, galleries and other prototype experience still use `DIPMockRepository`. No catalog data or cloud resources are deployed by this change. Current rules bound string arrays; they do not validate every referenced catalog document's existence. Stronger server-side reference validation would be a separate reviewed backend change.
