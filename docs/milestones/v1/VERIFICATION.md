# V1 verification record

Evidence for [V1](../V1.md) acceptance, collected November 8, 2026 against the real project (`team05-dip`). Each row names the merged work and how it was checked. Rerun the automated parts with the commands at the end.

## Requirements

| ID | Feature | Merged work | Automated evidence | Manual evidence |
| --- | --- | --- | --- | --- |
| V1-01 | Google sign-in and company access | #4, #6, #9, #10, #11, #16, #20; domain index (main) | `resolveMembershipV1` unit + emulator tests; account rules tests; `AccountsTests`, `AccountsOnboardingTests` | Nov 3 and Nov 8: CMU Workspace account signs in on Simulator and iPhone; personal Gmail refused (ariaf7) |
| V1-02 | Basic profile and interests | #13, #18, #19, #21 | `ProfileTests`, `MemberProfileBridgeTests`, own-profile rules tests | Nov 3: edit all fields, save, relaunch on iPhone (ariaf7) |
| V1-03 | Event discovery | #42 | `MemberEventReadTests`, `MemberEventAppRepositoryTests`, `events-read` rules tests, seeded emulator-to-app test | Nov 8: organizer-created event appears in Home "Upcoming events" on iPhone (ariaf7) |
| V1-04 | Event details and attendees | #42, #45 | `EventListsTests`, `MemberParticipationTests` (attendee snapshots), `participation-read` rules tests | Nov 8: details show date/time, duration, place, price, places; attendee list shows the joined member (ariaf7) |
| V1-05 | Organizer event management | #31, #32, organizer callables/portal (sandervonk) | `organizer*` unit + emulator tests, `organizer-events` rules tests, admin live emulator tests | Production create/edit recorded by sandervonk (#44) |
| V1-06 | RSVP and cancellation | #37 → #43 (setRsvpV1, OmerGursoy04), #45 | `participation` unit tests (join, repeat, cancel, rejoin, capacity, closed), concurrent last-seat emulator test, client-write denial rules tests | Nov 8: Join, Leave, rejoin, relaunch keeps state on iPhone (ariaf7) |
| V1-07 | My Events | #45 | `MemberParticipationTests` (joined upcoming/past, joined past event fetched by ID), `participation-read` My Events rules tests | Nov 8: joined event listed in My Events, removed after Leave (ariaf7) |
| V1-08 | Default event imagery | e43fd2c (sandervonk) | `EventCoverTests` | Nov 8: category images on cards and details on iPhone (ariaf7) |
| V1-09 | Standard event sharing | `ShareLink` in event details | — | _Pending: iPhone share sheet shows title, date/time and place_ |
| V1-10 | Integration and usability | all of the above | UI flow tests in `ui/ComponentPreview/UITests` | _Pending: walkthrough Home → event → Join → My Events → Profile; loading/empty/error states; active tab_ |
| V1-11 | Verification | this record | see Coverage | _Pending: fresh-clone build on a second laptop (sandervonk)_ |

## Coverage

Target: at least 70% unit coverage of key V1 logic.

| Scope | Line coverage | How measured |
| --- | --- | --- |
| Backend functions (`gcp/functions/src`, excluding generated DTOs) — accounts, organizer, participation | **90.1%** (87 unit tests) | `npm run coverage:functions` (Node test runner coverage; fails below 70%) |
| iOS app logic: `ui/DIP/Domain` + `ui/DIP/Data`, excluding Firebase SDK adapters | **93.5%** (490/524) | `npm run coverage:ios` (Xcode coverage over the DIP app tests) |
| DIPAccounts package (session state machine, profile editor, interest catalog) | **95.3%** (241/253) | `npm run coverage:ios` (package suite via `swift test --enable-code-coverage`, own sources only) |
| DIPCore package (models, event lists/metadata, covers, mock repository) | **88.0%** (617/701) | same |

All key-logic scopes exceed the 70% target. iOS detail: the whole DIP app target measures 12.4% (1094/8849) because it is mostly SwiftUI screens; those are covered by the UI flow tests in `ui/ComponentPreview/UITests` and the manual device checks above, not by unit tests, and are outside the "key logic" scope. The thin Firebase SDK adapters (`FirebaseAccountsRepository` 20%, `FirebaseParticipationSource` 30%, `FirebaseEventReadSource` 0% in unit runs) are exercised against the deployed project on device and, for event reads, by the seeded emulator-to-app test.

Backend detail: application/domain logic is 95–100% per file. The Firestore adapters (`firestoreMembershipStore`, `firestoreOrganizerStore`, `firestoreParticipationStore`, 44–69% in unit runs) are exercised by the emulator integration suites (`npm run test:accounts:integration`, `test:organizer:integration`, `test:participation:integration`), which this unit figure does not count.

## Commands

```sh
npm run check                       # generated files, docs, contracts, backend build + unit tests
npm run test:rules                  # Firestore security rules (emulator)
npm run test:accounts:integration   # also: test:organizer:integration, test:participation:integration
npm run test:swift                  # Swift packages
npm run coverage:functions
npm run coverage:ios                # SIMULATOR="<name>" to pick an installed Simulator
```

## Physical device and second laptop

- Physical device: ariaf7's iPhone, free Personal Team Debug build, App Check debug provider, signed in with a CMU Workspace account (Nov 3, Nov 8). Each device must register its own App Check debug token before calling `resolveMembershipV1` or `setRsvpV1`.
- Second laptop: _pending (sandervonk): fresh clone, `npm ci`, `npm run ios:generate`, build and run in a Simulator following `ui/README.md`._
