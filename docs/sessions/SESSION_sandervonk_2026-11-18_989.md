# Work session

User: sandervonk
Date: 2026-11-18
Workstream: friendly-errors
Agent: Claude (Opus 5.5)
Status: completed

## Summary

Admin portal errors no longer show raw technical text ("Invalid request. [400]", "internal [0]", "[401]", SDK code
prefixes, reason keys). Root cause: the Firebase JS SDK appends " [httpStatus]" to every callable error message
(`_errorForResponse`), a request with no answer becomes `internal` / "internal [0]", and several surfaces printed
`error.message` of any thrown value. One mapper (`userError`) now turns any thrown value into plain copy in en and es,
and one alert design (decided with a design auditor, two rounds, PASS) is used for inline errors, dialogs and toasts.

Where raw text could leak before this change:

- `apiErrorFrom` kept the SDK status suffix in every `ApiError.message` and field error, shown by `LoadError`
  (`Ui.tsx`), `describe()` (`useLoad.ts`: roster, bug triage, attendees, import, member detail), the list errors in
  Members, Roster and Bug reports (`list.error.message`), the save banners in `EventForm`, `ThemeForm` and Member detail
  (`failure.message` / `error.message`), the Dipbot wizard (`failureMessage` fell back to `error.message`), the note
  field error in the wizard, the weekly ideas email page (`manageFailureMessage`) and the ThemeForm overlap fallback.
- `Dialog` printed `failure.message` of any Error: non-API codes (`internal`, `unavailable`, `deadline-exceeded`,
  `cancelled`, `unknown`) stay plain FirebaseErrors, so confirm dialogs could show "internal [0]" or "unavailable [503]".
- The server's bare "Invalid request." (VALIDATION_FAILED) was shown as is, also under fields.
- Import result rows carried the server row message unchecked (now only when presentable; they also go to the CSV).
- Reason keys were already mapped where they were handled (DipbotVenues, CoverPicker, Ideas `limit.*`); an unknown
  reason fell back to the server message. They now fall back to plain copy.

iOS (read-only audit, no change in this PR): no member-facing raw codes found. Every Firebase mapper
(`FirebaseAccountsRepository`, `FirebaseSubmissionSource`, `FirebaseParticipationSource`, `FirebasePhotoAlbumSource`,
`FirebaseInvitesRepository`, `FirebaseBugReportSubmitter`, chat/event/challenge/notification read mappers) maps domain
and code to string-free failure cases with localized copy; the server `message` is never read. Follow-ups proposed:
(1) replace `DIPRepositoryError.invalidInput(String)` with a typed failure so a future adapter cannot pass raw text
(`AlbumUploadQueue.swift:235`, `DIPPrototypeApp.swift:958`, `DIPPhotoCommentsScreen.swift:404`,
`DIPActivityChatScreen.swift:220` show its string); (2) make "\(notice) is not connected yet." in
`DIPPrototypeApp.swift:378` one localized format string; (3) localize the English mock strings in
`DIPMockRepository.swift` (mock builds only).

## Changes

- `apps/admin/src/lib/userError.ts` (new): `userError()` -> `{ title?, message, retryable, kind, generic? }`,
  `userErrorMessage`, `saveFailureMessage`, `fieldMessage`, `presentable`, `stripStatus`, `LEAK_PATTERNS`.
- `apps/admin/src/lib/i18n/catalog/{en,es}/failure.ts` (new area `failure.*`), registered in both catalog indexes;
  `isCatalogText()` in `src/lib/i18n/index.ts`.
- `apps/admin/src/lib/firebaseAdapter.ts`: strips the status suffix; vague field errors become "Check this field."
- Kit: `InlineNotice` error variant (icon, `title`, `announce`, `ref`), new `ErrorNotice` and `ErrorIcon`
  (`src/components/kit/InlineNotice.tsx`, `index.ts`).
- `src/components/Toast.tsx`: `toastError()`, error toasts stay until dismissed, a repeat replaces the earlier toast,
  error mark.
- Styles: `--error-ink` (`globals.scss`), the alert block and the field/widget error mark (`pro.scss`), light error
  toast (`_flows.scss`).
- Migrated: `Ui.tsx` (LoadError), `useLoad.ts` (`describe`), `Dialog.tsx`, `EventForm.tsx`, `ThemeForm.tsx`,
  `Ideas.tsx`, `lib/suggestions.ts`, `app/members/page.tsx`, `app/members/detail/page.tsx`, `app/roster/page.tsx`,
  `app/bug-reports/page.tsx`, `app/events/attendees/page.tsx`, `app/import/page.tsx`.
- Mock-only review hook: `src/lib/mockFailures.ts` (`?fail=offline|save|conflict|long|busy`, `&failAfter=N`), wired in
  `AppProvider.tsx` for mock mode only; the adapter is imported lazily so the mock bundle stays SDK-free otherwise.
- Tests: `src/lib/__tests__/userError.test.ts` (new), `kit.test.tsx`, `kit.guard.test.ts` (guard for
  `{error.message}`, `toast(e.message)`, `instanceof Error ? e.message`; the "banner error" pending list is now empty),
  `Toast.test.tsx`, `Dialog.test.tsx`, `backendMessages.test.ts` (field text expectation).
- Docs: `docs/design/admin-components.md` (Errors section), `docs/design/admin-i18n.md` (area list).

## Validation

- `npx tsc --noEmit` (apps/admin): pass.
- `npx eslint src` (apps/admin): pass.
- Targeted vitest, 26 files / 213 tests pass: userError, backendMessages, kit, kit.guard, Toast, Dialog, a11y,
  themeForm/editor/memberDetail/roster/importer/bugs/ui/attendeesAlbum/membersAuditChallenges i18n, Ideas quick/
  credits/cache, CoverPicker, Where, suggestions, usePaged, i18n, OverviewRefresh, LanguageSettings. Full suite not run
  (targeted tests only, per owner preference).
- `npm run check:admin-i18n` equivalent (`tsx scripts/admin-i18n/check.ts`): OK, 2015 keys. `test:admin-i18n`: 12 pass.
  `check:backend-i18n`: OK.
- Mock-mode screenshots (headless Chrome over CDP, 1440 and 390): load failure, form invalid, form conflict, long
  message in en and es, error toast (members export), Dipbot wizard error, confirm dialog error. Not committed.
- Not run: the root `npm run check` as a whole (no root install in this worktree), rules and Swift tests (no backend or
  iOS change), live/emulator checks.

## Decisions

Design auditor (fresh subagent), round 1 FAIL with 4 fixes, round 2 PASS. Changes from the owner's initial idea:

- Not a chip: a full-width alert box keeps the red tint and red text, because a pill does not hold 2-3 line or
  Spanish messages at 390 px. Text is a darker red `--error-ink` #9c0f52 (7.5:1 on #fff4f9) instead of `--error`.
- Error toasts switch from solid dark wine to the same light alert look and stay until dismissed.
- Titles only on page load (over generic copy) and form save failures; no dismiss on alerts.
- No "Details" disclosure and no reference id: no server request id exists to correlate, and details bring codes back.
- Field and widget errors stay box-free red text with the same mark.
- Round 1 fixes: "busy" (unavailable/deadline-exceeded) is not "check your connection"; Dipbot surfaces say "Dipbot is
  busy"; validation with no flagged field says "DIP couldn’t accept these changes…" (dialogs: "DIP couldn’t do this…");
  conflicts state that reloading drops the edits; desktop alert row centered with the icon on the first text line.
- A plain `Error` shows its text only when it is an exact catalog message in the active language; keyless server
  sentences still show (status stripped, rejected if technical).
- Accepted deviations: no field links in the form summary (focus moves to the first invalid field), the wizard keeps
  its own Back/Try again row.

## Handoff

- iOS follow-up proposed above (typed failure instead of `invalidInput(String)`, one localized "not connected"
  sentence, localized mock strings); not done here so the iPhone experience is unchanged.
- Spanish copy for `failure.*` is a draft like the rest of `es`.
- When the server returns a request id, add a muted "Error ID" line with copy, as the auditor suggested.
