# Work session

User: sandervonk
Date: 2026-11-11
Workstream: Share links and universal links
Agent: Claude Code
Status: complete

## Summary
Event share links `https://team05-dip.web.app/e/<eventId>`, app routing for them and `dip://events/<id>`, hosting AASA and landing page (not deployed). Design: docs/design/share-links.md.

## Changes
- DIPCore: DIPShareLink (+tests), shareText link param. App: EventLinkInbox, DIPApp, DIPMemberHome, DIPPrototypeApp, DIPDetailComponents, DIPEventDetailsScreen.
- project.yml: dip URL scheme, entitlements now via DIP_ENTITLEMENTS (tracked Config/DIP.entitlements, Config/DIP-Paid.entitlements); Base.xcconfig, Local.example.xcconfig, .gitignore.
- Hosting: firebase.json (2 rewrites, 1 header), apps/admin/public/aasa, apps/admin/public/share; scripts/tests/test_hosting_share_links.py; docs and FRONTEND_PLAN rows.

## Validation
- swift test DIPCore --filter DIPShareLinkTests (7) and EventMetadataTests pass; python3 -m unittest scripts/tests/test_hosting_share_links.py passes; xcodebuild DIP generic iOS Simulator build succeeded.
- Simulator spot check: dip:// URL prompts to open DIP; with the onboarding tour showing the link stays queued. Universal Links untestable without paid team.

## Decisions
- ShareLink item is the URL with the text as message (avoids a duplicated link); cancelled events share no link.
- Free-team safe: Associated Domains only in DIP-Paid.entitlements, selected via Local.xcconfig.

## Handoff
Owner steps in docs/design/share-links.md: paid team, Team ID, App Store ID, approved hosting deploy.

