# V2 remaining features: triage (integration branch `feature/v2-remaining`)

Created Nov 11, 2026. This branch collects the held and not-yet-built V2 frontend features. **It is not merged to `main`** until the owner says so. Feature work lands here through PRs whose base is `feature/v2-remaining`; each PR runs the quality rounds below before merging into the branch.

## Triage

| Feature | Value | Effort | Blockers | Decision |
| --- | --- | --- | --- | --- |
| Event change history (button + sheet from `Event.changeLog`) | High: transparency when organizers change details | S-M | none (backend deployed) | Build now (Stream A) |
| Event reward points shown on cards and details (`Event.pointsValue`) | Medium | S | confirm the field is populated; hide at 0 | Build now (Stream A) |
| Weekly-theme page polish to match the event page | Medium | S | none | Build now (Stream A) |
| Push registration, permission priming, deep links (client side) | High but device-gated | M | Paid Apple team APNs key and `aps-environment` for real delivery | Build behind a feature flag, unit-tested with fakes; mark device-unverified (Stream A) |
| Live event photo albums: upload, grid, viewer, comments backed by Firebase | High (core social loop) | L | Storage rules, `finalizeEventPhotoV1`, limits: needs backend slice | Build (Stream B): backend slice first, then iOS |
| Shake-to-report bug screen | Medium (testing feedback) | M | design exists (Figma + scratchpad spec) | Build (Stream C) |
| Interest filtering on Home (F1, V2-06) | Medium | M | none (client-side) | Build now (Stream D) |
| Points balance display (F2, V2-04) | Medium | S | reads `pointsBalance`; server awards are separate | Build now (Stream D) |
| Challenge submissions (F3, V2-02) | High | L | needs `submitChallengeV1`, Storage rules, review flow | Defer: next wave after albums (backend dependency) |
| Coworker invitations (F4, V2-01) | Medium | L | `sendInviteV1`/`respondToInviteV1`, coworker list approach | Defer |
| TestFlight / release (F8) | High | S-M | paid Apple team approval pending | Blocked |
| Apple Team ID / Universal Links | Medium | S | Apple account approval pending | Blocked (owner todo) |
| Older failing UI tests repair (F7) | Medium | S-M | none | Include as a hardening task at the end |

## Streams (one agent each, no tiny agents)

- **A: Event and theme pages.** Change history, event points display, theme page polish, push client behind a flag.
- **B: Live albums.** Storage rules and a finalize callable (backend), then upload/viewer/comments on iOS.
- **C: Shake to report.** Implementation of the designed screen.
- **D: Home and points.** Interest filter and points balance display.

## Quality rounds (required before each PR merges into this branch)

1. **Build round:** implement, compile DIP and Preview, unit tests for new logic.
2. **Self-review round:** the author reads its own diff against the acceptance criteria and the owner's design rules (outline = informational, solid = pressable; consistent empty states; app-assigned avatar; haptics: actions felt, navigation silent; no large-text work).
3. **Design audit round(s):** screenshots to the shared design auditor; apply required edits; re-audit until PASS or two rounds.
4. **Independent code review round:** a separate reviewer agent reads the diff (correctness, security/rules, concurrency/idempotency, tenant isolation, error handling) and returns findings; the author fixes confirmed ones.
5. **Verification round:** relevant unit tests, rules/emulator tests for backend changes, UI tests for the new flows on the shared simulator under the lock, and a final screenshot set. Report what could not be verified without a device.

Nothing here deploys backend changes to production without the owner's approval (the owner approved only the items already deployed).
