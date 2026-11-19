# Admin autosaved drafts

Owner request: "it would be nice if drafts were saved, not just thrown away on page exit." The usability study
([findings I2](../research/admin-usability-study-2026-11/findings.md)) also showed that "draft" language promised a save
state the product did not have. This page records what the New event and New theme forms now keep, where, for how long,
and why the drafts are not stored on the server yet.

Scope: the New event form (`EventForm`, create mode) and the New theme form (`ThemeForm`, create mode). Editing a saved
event or theme has no draft (its saved revision is the draft; the existing leave-page dialog still applies). Roster,
Your settings and other forms are out of scope.

## What is stored, and where

| Item | Value |
| --- | --- |
| Place | This browser's `localStorage` only. Never sent anywhere. |
| Key | `dip.admin.draft.v1.<kind>.<companyId>.<uid>` (URL-encoded parts), `kind` is `event` or `theme`. One slot per admin, company and kind. Another admin on the same browser, or another company, never sees it. |
| Envelope | `{ v: 1, savedAt: <ms>, data: <snapshot> }`. `v` is the envelope version; a draft written by another version is ignored and removed, never migrated. |
| Lifetime | 30 days from the last save (`DRAFT_TTL_MS`). Older, malformed, future-dated or unparsable drafts are deleted when read. |
| Size cap | 64 Ki characters serialized (`DRAFT_MAX_CHARS`). A larger draft is not written; the status line says so and the leave-page dialog protects the typing. |
| Write timing | 800 ms after the last change (debounced), and at once when the tab is hidden or closed (`pagehide`, `beforeunload`, `visibilitychange`) and when the form unmounts (back, forward, in-app navigation). |

Event snapshot (`EventSnapshot`): title, description, tag ids, cover URL and whether Dipbot picked it, start and end
(RFC 3339 UTC), the Where section (venue name, street address, city or area, the picked place's `placeId`), the Outdoor
flag, the price as typed, the price note and capacity. The map position (latitude, longitude) is not stored: it is
derived from the address and is looked up again when the event is created, so it can never go stale. There is no
recurrence on the form today. Theme snapshot (`ThemeSnapshot`): all fields (title, description, tags, theme art, goal,
unit, points, first and last week).

Never stored: tokens, credentials, the request id (a new one is made per page), user profile data, server responses,
Dipbot credit balances or suggestions. Each stored draft is rebuilt field by field from an allow-list and every string is
length-capped, so a hand-edited or corrupted entry cannot inject anything the form would not accept.

## Behavior

- **Untouched or empty forms never write.** "Touched" means the admin changed something; defaults the page fills in (the
  next free hour, the first free week, the default theme and tag) do not count. A form emptied again deletes the draft it
  wrote. A change to times alone, or the default capacity, is not worth keeping.
- **Restore banner.** A draft found on page open shows a calm banner above the form: "You have an unfinished event draft,
  saved 5 minutes ago." with Restore draft and Start fresh. The draft stays until the admin answers. Restore fills every
  field, moves focus to the first field and shows a short status note. Start fresh asks "Discard the saved draft?"
  because it deletes something the admin wrote; it then focuses the first field.
- **Dates are re-validated on restore.** A start time that has passed (or unreadable times) is replaced by the next free
  hour and the note says so. Themes: a first week that is no longer open, a window that overlaps a theme that exists now
  or one that has passed is replaced by the first free week and flagged. Cover URLs no longer in the library are
  dropped; tags are kept only if the loaded tag catalog still has them.
- **Saved line.** A quiet "Draft saved on this device" (`role="status"`, `aria-live="polite"`) sits under the form
  buttons. It is empty until the first save and its text then stays the same, so a screen reader hears it once, not on
  every keystroke. If storage is blocked or full, or the draft is too large, it says "Draft not saved", turns the
  warning color, and the browser's leave-page dialog is enabled for that case only.
- **No leave-page dialog while the draft is saved.** The browser's "Leave site?" prompt only appears when content exists
  that no draft holds (the write failed). Editing a saved event or theme keeps the previous prompt.
- **Cancel.** With real content, Cancel asks "Discard this draft?" and deletes the draft; with nothing worth keeping it
  just leaves. Leaving by any other route (nav link, back, closing the tab) keeps the draft. Cancel never deletes a
  draft the admin has not yet answered (the banner's draft), because leaving the page is not an answer.
- **Publish clears it.** A successful create deletes the draft and stops saving; the unmount flush cannot bring it back.
  A failed create keeps the draft.
- **Dipbot hand-off.** A Dipbot draft opened with `?from=ai` fills the form as before and wins over an older autosaved
  draft. The older draft is not overwritten silently: its banner reads "You also have an older draft, saved ...
  Restoring it replaces what is on this page." with Restore draft (asks before replacing) and Delete old draft (asks).
  The existing "form kept while visiting Dipbot" stash (`sessionStorage`, same tab) also still works and also counts as
  content.
- **Other tabs.** `storage` events keep tabs honest without locking. A tab that has not been edited shows a draft another
  tab saved as its banner, and drops the banner if the other tab clears it. A tab with edits keeps its own content, says
  "Edited in another tab. Your next change replaces that draft." and the next write wins (last write wins).
- **Storage unavailable** (private mode, blocked, quota): reads return nothing, writes report `unavailable`, nothing
  throws and the form works as before with the leave-page dialog.
- **Language.** All text is in the `drafts` catalog area (en and es). The age is formatted with `Intl.RelativeTimeFormat`
  in the portal's language.

## Code map

| Path | Role |
| --- | --- |
| `src/lib/formDraft.ts` | Pure storage helpers: key, envelope, TTL, size cap, read/write/clear, relative age |
| `src/lib/formDraftSnapshots.ts` | What each form stores, untrusted-input parsing, "meaningful" rules, restore with date and cover re-validation |
| `src/lib/useFormDraft.ts` | The hook: debounce, flush on hide and unmount, offer, other-tab events, status |
| `src/components/DraftUi.tsx` | `DraftOffer` (the banner) and `DraftStatusLine` |

The hook's interface (`offer`, `acceptOffer`, `declineOffer`, `status`, `unsaved`, `clear`, `flush`) does not mention
`localStorage`, so a server-backed implementation can replace `formDraft.ts` without touching the forms.

## Server-side drafts: evaluated, proposed, not built

Question: can an event with a draft status, visible only to its author, be stored without a breaking wire change?

Findings from the contracts:

1. `Event.status` is a free string in the schema but the product enum is `scheduled | cancelled`. Members read the
   `events` collection directly (Firestore rules open it to the company), iOS lists and Home queries filter on start time
   and status, notification and email triggers fire on event writes. A third status in that collection would make
   half-finished events visible to members or trigger notifications unless every reader, rule, trigger and index were
   changed together. That is a breaking, cross-surface change.
2. `createEventV1` validates a complete event (title, description, venue name, address and city, a cover, a future start,
   valid tags). A draft is incomplete by definition, so it cannot go through it, and the deduplication receipt would
   record every autosave as a creation.
3. Client direct writes to `events` are denied by design (clients cannot set status, counts or ledger entries).

What is feasible and additive (no change to the existing wire): a separate, author-only draft store.

- New collection `companies/{companyId}/eventDrafts/{uid}_{slot}` (and `themeDrafts`), readable and writable only by the
  author through new callables `saveEventDraftV1`, `getEventDraftV1` and `deleteEventDraftV1` (or direct reads with a
  rule `request.auth.uid == resource.data.authorUid`, writes by callable only), carrying the same snapshot as above plus
  `contractVersion`, `updatedAt` and a server `expiresAt` TTL field (Firestore TTL policy).
- Optimistic concurrency with the existing `revision` pattern; last write wins is not acceptable across devices.
- Schema entries in `contracts/v1/models.schema.json`, rules and indexes, emulator tests for auth denial, tenant isolation
  and field ownership, a rate limit (autosave is chatty: batch at most one write per 5 s per draft) and App Check like the
  other organizer callables. Estimated at a feature-sized PR touching `contracts/**`, rules and `gcp/functions`, which are
  shared choke points needing an integrator, so it is not part of this change.

Benefits over `localStorage`: the draft follows the admin across devices and browsers and survives cleared site data.
Costs: server writes per edit, a retention and privacy decision (drafts hold unpublished plans), and new failure states
for the form. Recommendation: ship the browser draft now (it covers the reported pain: leaving the page and coming back),
and revisit the server store if admins start on one device and finish on another.

The usability study's other draft finding (the Dipbot banner wording that promised a save) is unchanged by this work.
