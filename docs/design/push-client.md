# Push client (device-unverified)

Status: built on `feature/v2-remaining`, behind a feature flag, unit-tested with fakes. **Not tested on a device**: real delivery needs the paid Apple Developer team's APNs key and the `aps-environment` entitlement, neither of which exists yet.

## What the client does

- **Flag.** `PushFeature.isEnabled` is true only when Info.plist `DIPPushEnabled` is `YES` (build setting `DIP_PUSH_ENABLED`, default `NO` in `ui/Config/Base.xcconfig`) or the app is launched with `--push-enabled`. With the flag off, no push code runs: no permission prompt, no registration, no delegates.
- **Registration.** `PushRegistrar` registers the device through `registerDeviceV1` (`{contractVersion: 1, token, platform: "ios", appVersion}`) when a member session is ready and notifications are already authorized, again when FCM refreshes the token, and calls `unregisterDeviceV1` before sign-out (best effort, never blocks sign-out). A token already registered is not sent twice; failures are retried at the next launch or token refresh.
- **Permission priming.** Never at launch. After the member's first accepted RSVP, once, and only while the system status is undetermined, the app shows its own dialog ("Get updates for activities you join?"). "Turn on notifications" shows the system prompt; "Not now" is remembered and never asked again (Settings still works).
- **Deep links.** A tapped notification carries `deepLink` (`dip://events/{id}` or `dip://events/{id}/chat`, written by the notifications module). It goes through the same `DIPShareLink` parser and `EventLinkInbox` as share links, so the shell opens the event; `/chat` also opens the chat when the member is going and the event is not over.
- **Notification settings.** The per-event All / Changes / Reminders / None menu in the chat screen (bell, top left) is the setting; there is no separate settings page.

## To make it work on a device

1. Join the paid Apple Developer team; create an APNs auth key and upload it to Firebase Cloud Messaging.
2. Add `aps-environment` (and Push Notifications capability) to the DIP target's entitlements and set the bundle ID/team in `Local.xcconfig`.
3. Set `DIP_PUSH_ENABLED = YES` in `Local.xcconfig`.
4. Deploy the C1 notification functions if they are not deployed (registerDeviceV1/unregisterDeviceV1 are in the notifications module).

## Not covered

Background/silent pushes, badge counts, notification categories/actions, and any server change. A rich notification service extension is out of scope.
