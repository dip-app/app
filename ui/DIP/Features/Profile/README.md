# Profile presentation fixture

DIPProfileScreen renders the supplied Figma Profile frame 76:4016 at the original
402 × 874 viewport. It composes the shared font/resource loader and selected Profile
navigation variant; all photography, curves and icon assets come from the source
frame. Asset names use the profile_ prefix in the design-system resource catalog.

The screen accepts a DIPProfile, async onSave(ProfileEdit), onSelectTab and onMemory callbacks. Memory activation passes a stable event ID to open its album. The edit action
opens a native form for department, city and interest tags. The OAuth display name is read-only under accepted ADR0007.

Only unsaved drafts are view state. Successful edits flow through the repository and remain observed across screen recreation for the adapter lifetime. No Firebase
adapter, membership/role change, photo upload, account save or persistence is
implemented. The native edit form is supporting fixture UI; no original Figma edit
frame was supplied for it.

Reference visual checks must use the initial identical fixtures. Review Home's
comparison instructions in ui/ComponentPreview/Review before changing typography,
photo transforms, mosaic geometry, navigation or the original mock content.

## Catalog interests and account exit

Profile's Add interests entry opens a searchable, native multi-select sheet. Explicit Save persists through the repository callback; an inner picker in Edit profile stages changes until the outer Save. Cancel isolates that picker draft. Choices are limited to ten, errors retain selection for retry, and display labels may change without changing selected IDs. See [the existing V1 mapping](../../../../docs/contracts/profile-interests.md). The preview catalog is synthetic; the live aggregate profile/tag adapter remains pending.

Selected interests scroll within the original hero; large text uses an adaptive header and memory widths follow the viewport. The optional Sign out callback is supplied by the actual account composition root, delegates to AccountsSession, and returns to the Google entry flow. Standalone fixture hosts without an account session do not show a fake sign-out action.
