# Profile presentation fixture

DIPProfileScreen renders the supplied Figma Profile frame 76:4016 at the original
402 × 874 viewport. It composes the shared font/resource loader and selected Profile
navigation variant; all photography, curves and icon assets come from the source
frame. Asset names use the profile_ prefix in the design-system resource catalog.

The screen accepts onSelectTab and onMemory callbacks. Memory activation passes
its original asset name so the preview shell can open an album. The edit action
opens a native form for display name, department, city and interest tags, validating
a nonempty display name before Save.

Edits are local view state and reset when this fixture is recreated. No Firebase
adapter, membership/role change, photo upload, account save or persistence is
implemented. The native edit form is supporting fixture UI; no original Figma edit
frame was supplied for it.

Reference visual checks must use the initial identical fixtures. Review Home's
comparison instructions in ui/ComponentPreview/Review before changing typography,
photo transforms, mosaic geometry, navigation or the original mock content.
