# Admin portal quality audit (November 2026)

Scope: every signed-in route of `apps/admin` except the AI event ideas flow (`/ideas/`, `Ideas.tsx`, `lib/ideas*.ts`), which was still changing in another workstream. The login page was checked for accessibility only; its look is unchanged on purpose.

Method:
- Mock mode at 1440, 1280, 768 and 390 px, as admin and as organizer. The portal is light-only by design (README), so there is no dark mode to test.
- axe-core 4.14 run in the browser on all 17 routes (WCAG 2.0/2.1/2.2 A and AA plus best practice), before and after the fixes.
- Two code reviews: accessibility, UX and copy; security, gating, performance and correctness.
- `next build` output review.
- Before and after screenshots run past the shared design auditor. The notes were: desktop-first, professional, information-centric, compact tables, no big purple blocks, enterprise quality.

Result:
- **axe:** every route had serious color-contrast violations (white on the brand purple, 3.1:1), and there were label-in-name mismatches on four controls. After the fixes, axe reports zero violations on all 17 routes.

Severity: **High** means it blocks a task, is a WCAG AA failure across many pages, or is a security or correctness risk. **Medium** means it is a visible inconsistency, a single-page WCAG issue, or friction. **Low** means polish.

Status: **Fixed** (in this pass), **Partial**, or **Open** (handed off below).

## 1. Visual consistency

| # | Finding | Sev | Evidence | Status |
|---|---|---|---|---|
| V1 | White text on brand purple #7b88fa (3.11:1) on every primary button, avatar, badge, selected chip and segmented control | High | axe `color-contrast` on all routes (`.purple`, `.dark`, `.avatar`, `.nav-badge`) | Fixed: filled surfaces use `--primary` #5562dc (5.0:1), hover #4a56d6. The brand purple stays for decoration (chart, meters, login) |
| V2 | One-sided colored borders on rounded boxes: `.notice`, `.banner.error`, the active nav item, the selected queue row, toasts | Medium | `pro.scss`, `_admin.scss`, `globals.scss`, `_nav.scss` | Fixed: full 1px tinted borders and fills; the selected row uses an inset ring |
| V3 | Event thumbnails, event covers, theme art and evidence images were broken (root `/img/...` paths 404 under the `/admin` base path; they only worked on the combined hosted site) | High | `/events/` empty thumbnails; `naturalWidth 0` | Fixed: `lib/asset.ts`; every bundled image goes through `asset()` |
| V4 | The theme picker wrapped 8+1 at 1440 px | Low | `/themes/new/` screenshot | Fixed: all nine in one row; 3 columns on phones |
| V5 | Control borders #c4c8d6 were 1.67:1 (WCAG 1.4.11); the placeholder was 4.0:1; the toggle off-track was 2.0:1 | High | computed ratios | Fixed: #8a8fa5 (3.2:1); placeholder #646a80; hairlines kept for decorative dividers |
| V6 | Four disabled-button styles and 25 raw radii | Low | `pro.scss`, `globals.scss`, `_admin.scss` | Partial: radius variables (`$r-xs/$r-ctl/$r-box`) and one `--muted`. Dead base rules in `globals.scss` are still there (the login shares the file) |
| V7 | Tablet (768 px) tables wrapped dates over 3 to 4 lines | Medium | `/roster/` at 768 | Fixed: one-line cells that scroll inside a focusable table region |
| V8 | A red outline on every row's Remove button was noisy | Low | `/events/attendees/` | Fixed: neutral outline with a red label; red outline on hover and focus |
| V9 | Admin colors live in SCSS, not in `ui/DesignSystem/tokens.json` | Low | `pro.scss` | Open: `tokens.json` is a shared choke point and needs an integrator |

## 2. UX flows

| # | Finding | Sev | Evidence | Status |
|---|---|---|---|---|
| U1 | Filters, search, tabs and the selected item were only in React state (lost on reload and Back, not shareable) on events, themes, members, roster, audit, bug reports, review and attendees | High | page state hooks | Fixed: `useQueryState` keeps them in the URL (defaults left out, `id` kept) |
| U2 | No success feedback after saves, exports and actions; the members export failed silently | High | `members/page.tsx` `exportCsv` had no `catch` | Fixed: `Toast` (polite for success, alert for errors); Undo on check-in when the API allows it |
| U3 | Cancelling an event through the status field had no confirmation | High | `EventForm` | Fixed: a confirm dialog |
| U4 | Changing a member's role (including to admin) saved without confirmation | High | `members/detail` | Fixed: a dialog naming the old and new role; escalation to admin uses the danger style |
| U5 | Unsaved edits were lost silently | Medium | EventForm, ThemeForm, member edit, import | Partial: `beforeunload` guard and discard confirm on Cancel. In-app link navigation is not guarded |
| U6 | `/events/edit/` and `/challenges/review/` with no `?id` loaded forever | Medium | infinite skeleton | Fixed: a load error with a back link |
| U7 | Inconsistent loading, error, empty and "more" controls ("Load more" against "Show more (N left)") | Medium | per-page markup | Fixed: shared `LoadError`, `Loading`, `Empty`, `LoadMore`, `ResultCount`, `SearchBox` |
| U8 | `usePaged` bugs: a double "Load more" appended duplicates, a mutate during a load-more was lost, a query change left the button busy, and an export during a filter change returned a partial CSV | Medium | `usePaged.ts` | Fixed and covered by `usePaged.test.tsx` |
| U9 | Every debounced keystroke cleared the list to a skeleton | Low | members, roster | Fixed: previous rows stay with `aria-busy` |
| U10 | Power-user keyboard support | Low | review only | Fixed: `/` focuses search on list pages. The review page's J/K/A/R keys can now be turned off, are ignored in fields and dialogs, and the setting persists |
| U11 | No server pagination for events, themes, attendees or album photos; the challenges list makes one count request per theme | Medium | `events/page.tsx`, `challenges/page.tsx` | Open: needs backend paging or summary endpoints |
| U12 | No column sorting on any table; members and roster sort each page, not the whole list | Medium | `members/page.tsx` | Open |
| U13 | The live preview is hidden below a 1500 px viewport | Low | `globals.scss` | Open |
| U14 | Mixed time zones (UTC chart, Eastern weeks, local events) | Low | Overview, ThemeForm, EventForm | Open (labels only; no behavior change) |

## 3. Accessibility (WCAG 2.2 AA)

| # | Finding | Sev | Evidence | Status |
|---|---|---|---|---|
| A1 | Contrast | High | see V1, V5 | Fixed |
| A2 | Every page had the same document title | High | `document.title` | Fixed: "Page | DIP Admin" (`<title>` from `Shell`) |
| A3 | No skip link; `main` was not focusable | Medium | `Shell.tsx` | Fixed |
| A4 | Hard-coded `id="search"` gave duplicate ids (attendees renders two) | Medium | `Ui.tsx` | Fixed: `useId` |
| A5 | Filter "tabs" were toggle buttons; the cover and theme pickers were toggles | Medium | `aria-pressed` groups | Fixed: `Tabs` (tablist with roving tabindex and arrow, Home and End keys) and `RadioGrid` |
| A6 | Scrollable tables were not keyboard reachable | Medium | `.table-wrap overflow:auto` | Fixed: `TableRegion` (named region, `tabIndex=0`, `aria-busy`); row headers use `th scope="row"` |
| A7 | Label-in-name mismatches (photo tiles, evidence, screenshot, "Invite again") | Medium | axe `label-content-name-mismatch` | Fixed |
| A8 | Danger dialogs focused the first field; focus fell to `body` when the opener's row was removed | Medium | `Dialog.tsx` | Fixed: Cancel gets focus first; the fallback goes to `#main` |
| A9 | Loading states announced only through `aria-label` on an empty `role=status` | Low | `Ui.tsx` | Fixed |
| A10 | The nav badge count was not announced | Low | `Shell.tsx` | Fixed |
| A11 | Single-key shortcuts could not be turned off (2.1.4) | Medium | review page | Fixed (see U10) |
| A12 | Phone filters overflowed the 390 px viewport; short pages were vertically centered | Medium | `/members/`, `/audit/` at 390 | Fixed |
| A13 | `ResultCount` and `LoadMore` can both announce counts | Low | two polite regions | Open |
| A14 | Form error summaries do not link to the fields | Low | EventForm, ThemeForm | Open |

## 4. Performance

| # | Finding | Sev | Evidence | Status |
|---|---|---|---|---|
| P1 | The Firebase SDK was in every route's first load, including the login page and mock mode | Medium | static import in `AppProvider` | Fixed: the live adapter is loaded with `import()`. Mock build first load is now 132 to 150 kB per route (102 kB shared) |
| P2 | The immutable cache header matched `/_next/static/**`, but admin chunks are served at `/admin/_next/static/**` | Medium | `firebase.json` | Fixed |
| P3 | `<img>` elements had no intrinsic size (layout shift) | Low | Cover, ThemeArt | Fixed (width and height set) |
| P4 | Event photos are 250 to 300 KB JPEGs used as 56x40 thumbnails; album loads full-size blobs | Medium | `public/img/events/*.jpg`, `adminLive.ts` | Open: needs resized variants and thumbnail paths from the backend |
| P5 | Lighthouse was not run (no headless Chrome in this environment) | Low | | Open: run it on a preview channel |

## 5. Correctness and security (UI layer)

| # | Finding | Sev | Evidence | Status |
|---|---|---|---|---|
| S1 | Organizers could open the New theme and Edit theme forms and only failed on save (the backend allows admins only) | Medium | `themes/new`, `themes/edit`, `ThemeCard` | Fixed: `requires="themes.manage"`; Edit and New are hidden for organizers. Events pages pass `events.manage` |
| S2 | No error boundary or 404 page (a render error showed a blank page) | Medium | `src/app` | Fixed: `error.tsx`, `global-error.tsx`, `not-found.tsx` |
| S3 | A rejected `session()` left a blank page forever | Medium | `AppProvider.tsx` | Fixed: error state with Reload |
| S4 | No CSP or Permissions-Policy for the portal | Medium | `firebase.json` | Partial: `/admin{,/**}` sends `Content-Security-Policy-Report-Only` and `Permissions-Policy`. Enforce after checking sign-in, App Check and Storage on a preview channel. `'unsafe-inline'` scripts are required by the Next static export |
| S5 | A production build without the `NEXT_PUBLIC_FIREBASE_*` variables silently becomes the mock with persona sign-in | Medium | `AppProvider` | Open: fail the deploy build unless mock is explicit |
| S6 | A deactivated admin keeps the portal UI until calls fail | Low | `firebaseAdapter.ts` session | Open |
| S7 | Reopening or cancelling a completed event with photos needs an admin `statusReason` that the form cannot send | Low | `organizerCommands.ts` | Open |
| S8 | User text rendering and CSV export | n/a | no `dangerouslySetInnerHTML`; CSV formula neutralization exists | No action needed |
| S9 | Secrets in the client bundle | n/a | grep of `out/` for keys | None found |

## 6. Copy

| # | Finding | Sev | Status |
|---|---|---|---|
| C1 | En and em dashes in user-facing text ("1–200 characters", date ranges, "—" placeholders) | Medium | Fixed in audited files ("1 to 200", "Nov 16 to Nov 22", "Not set") |
| C2 | Internal jargon ("isn't part of V1", "kept by the server", "stored in UTC") | Medium | Fixed |
| C3 | British "Cancelled" in labels; Title Case page titles ("New Event") | Low | Fixed: display labels say "Canceled" and "Changes requested"; stored values are unchanged |
| C4 | Generic busy and error text ("Working…", "That didn't go through") | Low | Fixed: specific busy labels and actionable errors |
| C5 | Inconsistent review terms ("Send back", "Sent back", "Request changes") | Low | Fixed: "Request changes" and "Changes requested" |

## 7. Tests added

Run with vitest, using jsdom per file:
- `TableRegion`, `Tabs` (keyboard and ARIA), `Toast`, `Dialog` (reason gating, focus).
- `useQueryState`, `usePaged` (double load, mutate during load, stale generation).
- `a11y.test.tsx`: axe on `Tabs`, a table in `TableRegion`, `SearchBox`, `ResultCount`, `LoadMore`, `RadioGrid`, `Dialog`, `Empty`, `LoadError`, `Loading` and the toaster, with zero violations. `color-contrast` and `region` are skipped because jsdom cannot compute them; the browser axe run covers both.

## Not covered

- **The ideas flow:** not audited by request. It uses the shared button and avatar classes, so it picks up the contrast fix. Re-run axe on `/ideas/` once that work lands.
- **Volume:**
  - Tested empty states (audit, insights `?insights=empty`) and the mock's 20 to 30 rows.
  - Member, roster and bug lists page from the server (25 rows plus Load more), so the DOM stays bounded.
  - Events, themes and attendees are unpaged (U11). A 500-row data set was not generated.
