# Profile presentation fixture

DIPProfileScreen renders the supplied Figma Profile frame 76:4016 at the original
402 × 874 viewport. It composes the shared font/resource loader and selected Profile
navigation variant; all photography, curves and icon assets come from the source
frame. Asset names use the profile_ prefix in the design-system resource catalog.

The screen accepts a DIPProfile, async onSave(ProfileEdit), onSelectTab and onMemory callbacks. Memory activation passes a stable event ID to open its album. The edit action
opens a native form for department, city and interest tags; account-backed profiles also edit job title, availability (`AvailabilityOption` ids) and travel radius, and show them in an About section. Fixture profiles carry no account details, so their layout and reference captures are unchanged. Commands leave omitted details untouched (nil in `ProfileEdit`). The OAuth display name is read-only under accepted ADR0007.

Only unsaved drafts are view state. Successful edits flow through the repository and remain observed across screen recreation for the adapter lifetime. In the signed-in app, DIPMemberHome bridges account-owned profile/catalog data and UID-bound saves through the same AccountsRepository instance used by AccountsSession. Membership observation remains the displayed source after acknowledgement. Event/social content and standalone fixture-profile hosts remain mock-backed; this does not implement membership/role changes or photo uploads. The native edit form is supporting fixture UI; no original Figma edit
frame was supplied for it.

Reference visual checks must use the initial identical fixtures. Review Home's
comparison instructions in ui/ComponentPreview/Review before changing typography,
photo transforms, mosaic geometry, navigation or the original mock content.

## Catalog interests and account exit

Profile's Add interests entry opens a searchable, native multi-select sheet. Explicit Save persists through the repository callback; an inner picker in Edit profile stages changes until the outer Save. Cancel isolates that picker draft. Choices are limited to ten, errors retain selection for retry, and display labels may change without changing selected IDs. See [the existing V1 mapping](../../../../docs/contracts/profile-interests.md). The configured signed-in app loads the existing account tag catalog and saves via ProfileEditor; loading/error/retry states are explicit and missing or retired selected IDs are preserved. The preview catalog is synthetic. This profile bridge does not make the aggregate event/social repository live.

Selected interests scroll within the original hero; large text uses an adaptive header and memory widths follow the viewport. The optional Sign out callback is supplied by the actual account composition root, delegates to AccountsSession, and returns to the Google entry flow. The member host is keyed by UID, so sign-out clears its editor, catalog and prototype lifetime. Standalone fixture hosts without an account session do not show a fake sign-out action.

## Redesign (November 2026)

The header (`ProfileHeaderCard`) is a flat brand-periwinkle card with solid tints and a unioned clover silhouette; it holds avatar, name, department and city, the About rows (icon plus value, no captions: job title, availability, "Events within N miles") for account-backed profiles, and the interest pills with an Add action. Favorite memories are a two-column grid of tiles; each tile opens the event's album, where a photo opens the comment viewer. With no memories the shared `DIPEmptyState` (`empty.profile-memories`) is shown. Review states: `--profile-state=account|account-empty|fixture-empty` in the Preview app; captures live in `ui/ComponentPreview/Review/Profile`.
