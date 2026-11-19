# Admin portal components

Shared building blocks for `apps/admin`. Reach for these before writing markup with the underlying classes. They emit the portal's existing class names, so the look is defined once in `src/styles` (mainly `pro.scss`) and a page never styles a button, notice or chip itself.

- Kit: `apps/admin/src/components/kit/` (import from `@/components/kit`). It is `kit/`, not `ui/`, because `components/Ui.tsx` already exists and the two names collide on case-insensitive file systems (macOS).
- Dipbot actions: `apps/admin/src/components/DipbotAction.tsx`.
- Guard: `src/components/__tests__/kit.guard.test.ts` fails when a page writes `className="pill-btn`, `info-pill`, a `chip` button, or a new `banner error` by hand.

## Which one to use

| Need | Use | Variants |
| --- | --- | --- |
| Anything pressable | `Button` | `primary` (the one main action), `outline` (default), `danger` (outlined; solid only in its confirm dialog), `plain` (inherits context, for use inside a banner). Sizes `md`, `sm`. `loading`, `href` (a link that looks the same). |
| Anything that asks Dipbot to do something | `DipbotAction` | `outline`, `solid`, `ghost`, `link`. Sizes `sm`, `md`. See below. |
| The credit price on its own | `CreditCost` | `divider`, `showFree`. |
| A status, count or category label (not pressable) | `Chip` | tone `ok`, `warn`; `full` for the brighter card outline. `Info` in `Ui.tsx` is the same component. |
| A filter or choice that toggles | `ChipToggle` | `pressed`, optional `count` and `icon`. |
| A message that stays on the page | `InlineNotice` | tone `info`, `success`, `warn`, `error` (the error alert: icon, optional `title`, `action` slot, `announce`, `ref`). |
| A form's list of what to fix after a submit | `ErrorSummary` | `title`, `items` (`target` id, `label`, `message`; an empty label when the message already names the field), `ref`. The error alert with one link per field; the form focuses it on submit (not a live region). Field messages stay under each field, and editing a field clears its line. Used by the event editor. |
| Anything that was thrown | `ErrorNotice` (inline), `toastError` (toast), `describe` / `userErrorMessage` (text) | See "Errors" below. Never render `error.message`. `ErrorNotice` takes `dipbot` on Dipbot surfaces ("Dipbot is busy"). |
| A titled section card | `Panel` | `title`, `description`, `actions`, `loading`, `empty`, `error`, `headingLevel`. |
| Nothing here yet | `EmptyState` | `title`, `body`, one `action`, optional `art`. `Empty` in `Ui.tsx` is the same component. |
| The page title row | `PageHeader` | `title`, `description`, `actions`. `Shell` renders it. |
| The header row of a Dipbot section | `SectionHeader` | `title`, `headingLevel`, `updated` (muted "Updated 3 hours ago"), `staleHint` (compact inline "New data available" beside it, only when stale), optional `toggle` (collapse), `hint`, `end` (actions). Used by "Ideas for you" and the wizard's per-step suggestions. |
| One choice out of a few, always visible | `SegmentedControl` | `tabs` (underlined views), `pill` (compact, AM/PM), `icon` (grid or list). |

`Tabs` (a real tablist with arrow keys) stays for switching whole pages of content; `SegmentedControl` is for switching how the same data is shown.

## DipbotAction

`[mark] Label | 1 credit`. The cost is data (`credits`), never part of a label string in `aiStrings.ts`.

| Prop | Meaning |
| --- | --- |
| `label` | The action without its price ("Let Dipbot choose"). |
| `credits` | Cost in credits. Omitted or 0: no cost shown (a free action). `showFree` shows "Free". Singular and plural come from `creditCostLabel`. |
| `variant` | `outline` (secondary, default), `solid` (the main call to action, purple), `ghost` (no border), `link` (inline, label underlined). |
| `size` | `md` (36 px, 44 px on touch and phones) or `sm` (28 px, 36 px on touch). |
| `loading`, `loadingLabel` | Spinner replaces the mark, `aria-busy`, presses ignored, width kept. |
| `disabled`, `disabledReason` | The reason is a tooltip and is read by screen readers ("Not enough credits"). |
| `icon`, `iconOnly`, `shortLabel` | Replace or remove the mark; collapse to the icon (`true`, or `"narrow"` on phones); show a shorter label on phones ("Suggest"). |
| `hint` | Extra context, for example the tooltip and screen reader text of "Use suggestions". The disabled reason wins while disabled. |
| `href` | Renders a link with the same look. Forwards a ref. |

The accessible name is "Label, N credits", also when collapsed. Do not add a second price to the page next to it.

## Errors

People never see a status code, an SDK code or a reason key. The Firebase JS SDK appends the HTTP status to every
callable error ("Invalid request. [400]"), reports a request that got no answer as "internal [0]", and transport
errors carry codes such as `functions/unavailable` or `auth/network-request-failed`. Everything shown goes through
`userError()` in `src/lib/userError.ts`, which returns `{ title?, message, retryable, kind, generic? }`:

1. A reason with its own copy (`AI_VENUES_DISABLED`, the Dipbot `limit.*` reasons without numbers) wins.
2. A server typed message (`details.messageKey`) in the active language, unless it is vague ("Invalid request.").
3. A sentence of ours: an `ApiError` message that passes `presentable()` (status suffix stripped), or a plain `Error`
   whose text is an exact catalog message (`new Error(t("roster.message.copyFailed"))`).
4. Otherwise the code's plain copy (`failure.*`, en and es), or the surface's `fallback` for an unknown failure.

| Kind | From | Copy | Retry |
| --- | --- | --- | --- |
| network | `internal [0]` (no answer), fetch `TypeError`, `auth/network-request-failed`, `navigator.onLine === false` | Can’t reach DIP. Check your connection and try again. | yes |
| busy | `unavailable`, `deadline-exceeded` (the server answered) | DIP is busy right now. Try again in a moment. (Dipbot surfaces, `dipbot: true`: Dipbot is busy right now. …) | yes |
| signedOut | `unauthenticated` | Your session ended. Sign in again to continue. (Sign in link) | no |
| permission | `permission-denied` | You don’t have access to do this. Ask a company admin if you need it. | no |
| rateLimit | `resource-exhausted` | Too many tries. Wait a minute and try again. | yes |
| validation | `invalid-argument` | With a flagged field: Some details need fixing. Check them and try again. (a vague field error becomes "Check this field."). Without: DIP couldn’t accept these changes. Check them and try again; if it keeps happening, contact support. | no |
| notFound | `not-found` | This no longer exists. It may have been deleted. (or the surface's `notFound`) | no |
| conflict | `aborted`, `already-exists` | Someone else changed this since you opened it. Reload the latest version (your edits here will be lost). A form with Reload latest appends "Reloading the latest version drops your edits here." to a server sentence (`saveFailureMessage`). | yes |
| unavailable | `failed-precondition` | This can’t be done right now. Reload the page and try again. | yes |
| unknown | `internal`, anything else | Something went wrong. Try again. (or the surface's `fallback`) | yes |

A specific sentence is retryable only when its kind is network, busy, rateLimit or unknown.

Where each surface shows it (decided with the design auditor, see the session log):

| Surface | Presentation |
| --- | --- |
| Page or section load failure | `LoadError` / `ErrorNotice`: the alert with Try again (Go back when the item is gone, Sign in when signed out). The title "Couldn’t load this" shows only over generic copy. |
| Form save failure | One alert at the top, title "Couldn’t save", Reload latest on a conflict. Without field errors it takes focus (`ref`, `announce={false}`); with field errors focus goes to the first invalid field. Client validation shows "Fix N fields" as a plain alert. |
| Field errors, widget status lines | Red text (`--error`) with the error mark (CSS on `.error` text inside `.content`), no box. |
| Result of a row or button action | Toast. Error toasts use the alert look (tint, `--error-ink`, mark), stay until dismissed, and a repeat replaces the earlier one. |
| Confirm dialog | The alert inside the dialog, above the buttons; the dialog stays open. A rejected request without fields reads "DIP couldn’t do this. Try again; if it keeps happening, contact support." |
| Dipbot wizard | The alert, with the wizard's own Back to choices / Try again row under it. |

The alert: background `#fff4f9`, 1px `#f0a8c9` border, text `--error-ink` `#9c0f52` (7.5:1 on the tint), 16 px
circle-exclamation mark (decorative, `aria-hidden`), 14/20 px type, `$r-ctl` radius, 10/12 px padding, the action
on the right; on phones it drops under the text, lined up with it, at 44 px. Long text wraps, never truncates. No
dismiss on alerts (they clear on retry, edit or close). No "Details" disclosure and no reference id: there is no
server request id to correlate yet, and details would bring codes back.

Mock mode can force each state for review: `?fail=offline` (reads fail with status 0), `save` ("Invalid request.
[400]"), `conflict`, `long` (the longest typed server message), `busy` ("unavailable [503]") for writes, and
`&failAfter=N` lets the first N calls of each method succeed (`src/lib/mockFailures.ts`).

Guardrails: `src/lib/__tests__/userError.test.ts` (every callable code and reason case in en and es, and no catalog
message in either language contains a bracketed status, a reason key or SDK wording) and the kit guard
(`{error.message}` in JSX, `toast(error.message)` and `instanceof Error ? e.message` fail).

## Autosaved drafts

New event and New theme keep what the admin typed in this browser and offer it back on the next visit. The pieces are
`DraftOffer` (the calm restore banner, built on `InlineNotice`: one outlined Restore draft, one quiet Start fresh, 44 px
on phones) and `DraftStatusLine` (a polite `role="status"` line under the form buttons that stays silent until the first
save) in `components/DraftUi.tsx`, driven by the `useFormDraft` hook. Use them for any other long create form; do not
build a second banner. After a restore the form shows an `InlineNotice` (info, or warn when a date or week was reset), and
focus moves to the first field. Rules, storage and edge cases: [admin-drafts.md](admin-drafts.md).

## Do and don't

- Do give each screen one `primary`/`solid` action. Everything else is `outline`.
- Do use `Chip` for facts and `ChipToggle` for choices; a chip you can press must not look like a fact.
- Do use `ErrorNotice` (or `LoadError`) with `onRetry` for a load failure; use `toastError` for the result of an action.
- Don't render `error.message`, `failure.message` or a reason key; the kit guard and `userError.test.ts` fail.
- Don't write `<button className="pill-btn ...">`, `<span className="info-pill">` or `<div className="banner error">`; the guard test fails.
- Don't put cost text in a label ("Refresh, 1 credit"); pass `credits`.
- Don't use colour alone: states keep their text (`Invited`, `Revoked`).

## Accessibility

- `Button` and `DipbotAction` are native `button` or `a` elements with a visible focus ring; loading sets `aria-busy` and ignores presses instead of disabling (focus stays).
- `InlineNotice` errors are `role="alert"` (or, with `announce={false}`, a focus target with `tabIndex=-1`); the others `role="status"`. Error toasts sit in the toaster's alert region. The error mark is decorative: every error has words.
- `SegmentedControl` is a labelled group of `aria-pressed` buttons; icon items carry the name in `aria-label` and a tooltip.
- `Panel` is a `section` labelled by its heading; `loading` sets `aria-busy`.
- Touch targets are 44 px on phones. Reduced motion turns off spinners and shimmer.

## Migrated and still to migrate

Migrated: every `pill-btn` button and link (`dark` is now `primary`, the same look), the `info-pill` chips, filter chips (events, themes, members, when presets), the single-line error banners and notices, panels with a plain heading, empty states, the Overview view toggle, the weekly email preview switches, AM/PM, and the page header.

Also migrated: the multi-line error banners in `EventForm`, `ThemeForm` and `members/detail`, the dialog error, error toasts, and every place that printed a caught error's text.

Not yet: the form submit `big-pill` buttons, the import page's file-picker label, and skeletons (they mirror the real markup on purpose). The daily "Ideas for you" row uses `DipbotAction` once it lands.
