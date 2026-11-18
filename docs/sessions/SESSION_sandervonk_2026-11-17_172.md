# Work session

User: sandervonk
Date: 2026-11-17
Workstream: admin-art-polish
Agent: Claude
Status: completed

## Summary
Admin art polish: tag -> art resolver and blurbs, image-led Dipbot option cards, Dipbot banner centering, non-draggable images, pure black replaced by ink in web art.

## Changes
- apps/admin/src/lib/tagArt.ts (+test), ideaArt.ts, catalog.ts (Tag.description, LIVE_TAG_NAMES), api.ts (?tags=live mock), firebaseAdapter.ts (description passthrough)
- apps/admin/src/components/Ideas.tsx, src/styles/_ideas.scss, globals.scss; draggable={false} on shared image components and pages
- public/img avatars, themes/fitness.png, email/ideas/fitness.png, og-admin.jpg: #000 -> #1E212B; scripts/export-admin-avatars.py maps black to ink
- README and docs/design/theme-art.md

## Validation
- npx vitest run (tagArt, generatedAvatar, ideas); npx tsc --noEmit; manual screenshots at 1440, 1024, 390 in mock (?step=1&ai=nodata&tags=live)
- Design auditor: art PASS; cards minor findings addressed (container-based columns)

## Decisions
- Theme and spot SVGs already used ink, so only PNG/WebP rasters changed; cards use container-width columns 4/3/2/1.

## Handoff
- iOS Home.xcassets (Mascot, CoworkerProfilePicture*, AvatarPink/Red/Teal) still have black; same remap needed.


