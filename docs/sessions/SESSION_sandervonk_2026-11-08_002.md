# Work session

User: sandervonk
Date: 2026-11-08
Workstream: One clear Join action on the event page; iOS sign-in fix
Agent: Claude Code
Status: handoff

## Summary

Fixed the local iOS Simulator sign-in problem and changed the event page so the bottom bar is the one Join action (V1-10).

Sign-in: the Simulator build I made earlier used `CODE_SIGNING_ALLOWED=NO`, which drops the keychain entitlement Google Sign-In needs, and a fresh install generates a new App Check debug token that callables reject until it is registered. Building with signing on and registering the new token restored sign-in; the app reopened signed in and showed the live Lunch & Learn event with its Cooking cover.

Event page: the old row button "Join Activity" (chat icon) duplicated the bottom Join. The row slot now shows Directions (Apple Maps for the venue) before joining and a plain text "Leave Activity" after joining. The bottom navigation action gets an optional icon: joined/"Activity Chat" shows a white circle with the chat icon that springs in. The "Places" row is removed from the details card; capacity now shows beside "Who's Attending" ("2 of 15", or "Full") so it is not repeated. The description no longer forces a blank minimum height, and "Who's Attending" plus the buttons sit above the When/Where/Price/Places card.

## Changes

- ui/DIP/Features/EventDetails/DIPEventDetailsScreen.swift: reorder (people/actions above the details card), drop the 126pt minimum description height, row uses `joinInRow: false` with `directionsURL`; standalone bottom bar mirrors the icon circle.
- ui/DIP/Features/Shared/DIPDetailComponents.swift: `DIPDetailPeopleRow` gets an optional `capacity` caption; `DIPDetailActionRow` gets `joinInRow`, `directionsURL`, `directionsTitle`; Leave is a text-only button; challenge page keeps its row Join (it has no bottom bar).
- ui/Packages/DIPDesignSystem/.../DIPMotion.swift, DIPHomeComponents.swift: `DIPBottomBarAction.icon` and `DIPMotion.affordance` (spring; opacity only with Reduce Motion); icon circle rendered in the action overlay.
- DIPHomeComponents.swift also hides the "N Attending" tag (and empty avatar stack) on Home event cards when nobody has joined; its accessibility label drops the count too.
- ui/DIP/Features/Prototype/DIPPrototypeApp.swift: joined event and participants actions pass the chat icon.
- ui/Packages/DIPCore/.../DIPEventMetadata.swift: `mapsURL` (venue name and address for Apple Maps), with a unit test.
- ui/ComponentPreview/UITests: ScreenFlowTests and MemberEventsFlowTests updated for the single Join action.

## Validation

- `swift test --package-path ui/Packages/DIPCore`: passes, including the new maps URL test.
- Xcode builds of the DIP and Preview schemes for the iPhone 17 Pro Simulator succeed.
- Simulator, mock event: joined state shows "Leave Activity" as a text button and the bottom bar "Activity Chat" with the icon circle. Venue-backed fixture: Directions and Share sit under Who's Attending, above the details card, no blank gap.
- UI tests (Preview scheme, iPhone 17 Pro Simulator): MemberEventsFlowTests passes (Directions present, no row Join, no attendee tag at zero); ScreenFlowTests join/chat flow and My Events/memories pass. `testProfileEditsAndMemoryNavigation` fails, as it did before this change (profile department text "DesignHuman Resources" vs "Design"); not touched here.
- Not run: physical device; the bar's pop-in animation was checked by screenshot, not recorded.

## Decisions

- The challenge page keeps its row Join because it has no bottom Join action.
- When an event has no venue data, the Directions slot is empty and Share fills the row.
- The icon is a generic optional field on `DIPBottomBarAction` so other action states can use it.
- Sign-in fix is local setup (signed build plus a registered debug token), not a code change. The debug token was registered through the App Check API for the DIP iOS app.

## Handoff

- Confirm the Directions label/icon and the bar animation feel right on a device.
- The mock event "Puppy Yoga" has no venue metadata, so the Directions slot is empty there.
