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
| A message that stays on the page | `InlineNotice` | tone `info`, `success`, `warn`, `error` (alert banner with an `action` slot). |
| A titled section card | `Panel` | `title`, `description`, `actions`, `loading`, `empty`, `error`, `headingLevel`. |
| Nothing here yet | `EmptyState` | `title`, `body`, one `action`, optional `art`. `Empty` in `Ui.tsx` is the same component. |
| The page title row | `PageHeader` | `title`, `description`, `actions`. `Shell` renders it. |
| The header row of a Dipbot section | `SectionHeader` | `title`, `headingLevel`, `updated` (muted "Updated 3 hours ago"), optional `toggle` (collapse), `hint`, `end` (actions). Used by "Ideas for you" and the wizard's per-step suggestions. |
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

## Do and don't

- Do give each screen one `primary`/`solid` action. Everything else is `outline`.
- Do use `Chip` for facts and `ChipToggle` for choices; a chip you can press must not look like a fact.
- Do use `InlineNotice tone="error"` with a "Try again" action for a load failure; use toasts for the result of an action.
- Don't write `<button className="pill-btn ...">`, `<span className="info-pill">` or `<div className="banner error">`; the guard test fails.
- Don't put cost text in a label ("Refresh, 1 credit"); pass `credits`.
- Don't use colour alone: states keep their text (`Invited`, `Revoked`).

## Accessibility

- `Button` and `DipbotAction` are native `button` or `a` elements with a visible focus ring; loading sets `aria-busy` and ignores presses instead of disabling (focus stays).
- `InlineNotice` errors are `role="alert"`; the others `role="status"`.
- `SegmentedControl` is a labelled group of `aria-pressed` buttons; icon items carry the name in `aria-label` and a tooltip.
- `Panel` is a `section` labelled by its heading; `loading` sets `aria-busy`.
- Touch targets are 44 px on phones. Reduced motion turns off spinners and shimmer.

## Migrated and still to migrate

Migrated: every `pill-btn` button and link (`dark` is now `primary`, the same look), the `info-pill` chips, filter chips (events, themes, members, when presets), the single-line error banners and notices, panels with a plain heading, empty states, the Overview view toggle, the weekly email preview switches, AM/PM, and the page header.

Not yet: the multi-line error banners in `EventForm`, `ThemeForm`, `members/detail` and `import` (listed in the guard test), the form submit `big-pill` buttons, the import page's file-picker label, and skeletons (they mirror the real markup on purpose). The daily "Ideas for you" row uses `DipbotAction` once it lands.
