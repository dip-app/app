# Notification categories and preferences (shared model)

Status: implemented in code (contract, rules, server helper, iOS mirror); nothing deployed. Owner: the push triggers workstream ([push triggers](push-triggers.md), issue #205). Consumers: push (router), [email](email.md) (outbox, unsubscribe, settings UI) and the in-app center. This page is the contract between those workstreams; change it only together with the code below.

## Categories

| Category id | Covers (kinds) | Per-event level gate | Push default | Email offered | Email default |
| --- | --- | --- | --- | --- | --- |
| `invites` | `invite`, `invite_answered` | none | on | yes | on |
| `event_updates` | `event_changed`, `event_cancelled` (gated), `attendee_added` (not gated) | `changes` (`all`, `changes`) | on | yes | on |
| `reminders` | `reminder` | `reminders` (`all`, `changes`, `reminders`) | on | yes | off |
| `chat` | `chat` | `all` | on | no | n/a |
| `challenges` | `challenge_approved`, `challenge_changes_requested`, `weekly_theme` | none | on | yes | on |
| `social` | comments and photos (no kind yet) | none | off | no | n/a |
| `discovery` | `event_interest` | none | off | yes | off |

Source of truth: `gcp/functions/src/modules/notifications/domain/categories.ts` (`NOTIFICATION_CATEGORIES`, `CHANNEL_CATEGORIES`, `DEFAULT_PREFERENCES`, `NOTIFICATION_KINDS`). iOS mirror: `DIPNotificationCategory` in `ui/Packages/DIPCore`. A unit test on each side pins the ids and defaults, so a drift fails CI.

## Stored document

`users/{uid}/settings/notifications`, contract type `NotificationPreferences`:

```json
{
  "contractVersion": 1,
  "push":  { "invites": true, "event_updates": true, "reminders": true, "chat": true, "challenges": true, "social": false, "discovery": false },
  "email": { "invites": true, "event_updates": true, "reminders": false, "challenges": true, "discovery": false },
  "updatedAt": "<server timestamp>"
}
```

- Both maps and every key are optional. A missing document, map or key means the registry default, resolved server-side on every read (changing a default needs no migration).
- Rules: the owner may get, create and update only this document; top-level keys `contractVersion` (must be 1), `push`, `email`, `updatedAt` (must equal `request.time`); `push` keys limited to the seven categories, `email` keys limited to the five offered ones, all values booleans. No list, no delete, no other user's document. Writes are direct (no callable), like per-event levels.
- The server may write the same shape through `FirestorePreferences.setCategory` (merge write), for example an email unsubscribe or a spam complaint.

## Precedence (one rule for every channel)

`evaluateDelivery({kind, channel, preferences, eventLevel, hasDestination})` in `domain/preferences.ts`:

1. The kind's category is on for the channel (`category_off` otherwise).
2. For event-scoped kinds, the member's per-event level allows it; a missing subscription document is `none` (`event_level` otherwise).
3. A destination exists: a device token for push, a deliverable unsuppressed address for email (`no_destination` otherwise).

All three must pass. With no preference document the behavior equals today's (defaults are on for every category that pushes today), so the per-event level stays authoritative for chat, changes and reminders.

## Server API for consumers

- `resolvePreferences(raw)`: tolerant parse plus defaults (unknown keys and non-booleans ignored). `DEFAULT_RESOLVED_PREFERENCES` is the no-document value.
- `PreferencesReader.preferencesFor(uids)`: batched read (`FirestorePreferences`, `getAll` in chunks of 100). Wrap it with `cachedPreferences(reader)` once per invocation so each uid is read once per trigger run.
- `PreferencesWriter.setCategory(uid, channel, category, enabled)`: server-side opt-out; rejects a category the channel does not offer.
- `channelOffers(channel, category)`, `isNotificationCategory`, `isNotificationKind`, `eventLevelsFor(kind)`.

The email outbox should call `evaluateDelivery` with `channel: "email"` and its own `hasDestination` (address present and not in `emailSuppressions`). The push-or-email policy (email only when push is off or there is no token, except `invites` and `event_updates`) lives in the router, not here.

## Compatibility

- Adding a category or kind is additive: new optional key, a default, and a mirror entry in iOS. Old apps ignore unknown keys; old servers ignore new keys.
- Renaming or removing a category id is a breaking wire change: new contract version plus a migration of stored documents.
- Changing a default changes behavior for members without an explicit choice; record it in Decisions.

## Decisions (defaults chosen while owner questions are open)

1. Category list and defaults as in the design doc recommendation (open question 1): `social` and `discovery` off, everything else on for push.
2. Reminder emails default off (open question 2); members without push can turn them on. Revisit if the owner wants them on.
3. `discovery` is offered for email (weekly digest at most), default off; `chat` and `social` are never emailed.
4. `attendee_added` is in `event_updates` but is not gated by the per-event level, because the subscription document may not exist yet when an admin adds someone.
5. `event_cancelled` keeps today's gate (`all` or `changes`), so a member who chose "Reminders only" for an activity is not pushed about its cancellation (recipients are the same as today).
6. No delete rule for the document: a member resets by writing the defaults. There is no account deletion flow yet; when one lands it must remove this document with the Admin SDK.
