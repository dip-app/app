# Work session

User: sandervonk
Date: 2026-11-28
Workstream: admin-dipbot-phone
Agent: Claude (Opus), Opus decision reviewer, Sonnet design reviewers
Status: completed

## Summary

Admin portal follow-ups from #377. Two owner decisions made from evidence and written up in
`docs/design/polish-2026-11/admin-structure.md` ("Follow-ups, November 28"): the Dipbot page order on phones and which
list-page subtitles phones keep. Plus the open review items from #377: Spanish search placeholders cut at 320 px, the
reporter name squeezed by its status chip in Bug reports, Audit's Export CSV on its own row at 320 px in Spanish, the
Challenges "Not open yet" box, Dipbot option names cut at 768 px, and one kit stepper for Import and the Dipbot wizard.

## Changes

- Kit `Stepper` (`components/kit/Stepper.tsx`): one hairline row of numbered steps, pressable (Dipbot) or informational
  (Import); phones show equal numbered cells and one "Step 2 of 4: Match columns" line. Replaces Import's boxed `.steps`
  and the Dipbot-only stepper styles; styles live in `structure.scss`.
- `PageHeader`/`Shell` `brief`: a one-line phone version of the subtitle. Used by Bug reports ("Only admins see these,
  including who sent them") and Dipbot ("Plan your next event with Dipbot").
- Audit log: the count line says "from the latest 100" once the log is that long (`AUDIT_WINDOW`, shared with the live
  adapter's query limit); the subtitle drops the window; Export CSV moves into `more` (one row at 320 px in Spanish).
- Dipbot on phones: Ideas for you stays first but compact (64 px square thumbnail, title and why on up to two lines each,
  day and fit chips, "Use this idea" and a short "Customize" on one row under both; header in two rows with Refresh beside
  "Updated"). Step headings keep their hint ("Pick up to 3") whole; Regenerate and Start over wrap as whole buttons. The page no longer
  scrolls itself on load (the suggested-card scroll waits for the admin to act; the stepper no longer scrolls into view).
- Dipbot interest cards at narrow card widths (768 px): the name takes the whole first row; the meter moves to the blurb row.
- Bug reports on phones (480 px and below): the status chip leads the facts line, so the name keeps the top line.
- Challenges: an upcoming week's action cell is empty (the note and "None yet" already say it); the phone card hides it.
- Search placeholders: "Name, email or title", "Title or place", "Who, what or why" (es "Nombre, correo o cargo",
  "Título o lugar", "Quién, qué o por qué", "Texto, autor o pantalla"); the labels keep the full wording. All fit at 320 px.
- Tests: kit `Stepper` and `PageHeader brief`; challenge row without "Not open yet"; Spanish and English
  `audit.showingOfLatest`.
- Docs: `admin-components.md` (Stepper, brief, phone list rules), `admin-structure.md` (evidence and decisions, A12, A13,
  A17 closed).

## Validation

Run in `apps/admin` unless noted:

- `npx tsc --noEmit`: pass.
- `npx eslint` on every touched ts/tsx file: pass.
- `npx vitest run` on kit, kit.guard, ChallengeRows, Ideas.credits, Ideas.cache, Ideas.quick, IdeasForYou, importer.i18n,
  Skeleton, membersAuditChallenges.i18n, bugs.i18n, aiStrings: 12 files, 104 tests pass. `IdeasForYou.test.tsx` "loads once
  and never again while moving between wizard steps" failed once while headless captures loaded the machine (also with
  `Ideas.tsx` from main) and passed in three later runs: timing-sensitive, not caused by this change.
- `npm run check:admin-i18n` (repo root): pass.
- Captures: mock mode, headless Chrome, viewport captures at 1440, 768, 390 and 320 px in en and es, before and after;
  DOM measurements of the Dipbot section positions and of every search placeholder's fit.

## Decisions

- Dipbot on phones: Ideas for you stays first, compact; the wizard is not moved above it (see admin-structure.md for the
  evidence). An Opus reviewer made the call independently from the before captures and measurements.
- Subtitles on phones: Bug reports gets a one-line brief (who can see reports and their senders); Audit log's 100-entry
  window goes in its count line; Dipbot gets a one-line brief; Events, Members and Challenges stay hidden. The Opus
  reviewer would have kept Bug reports hidden; kept here because organizers use the portal too and the note is the only
  place that says reporter identities are admin-only.
- Design review: round 1 (fresh Opus on the two decisions, fresh Sonnet on the rest) FAIL: "Customize" and the Spanish
  idea card clipped at 320 px (fixed: actions run under thumbnail and text), "Regenerate" broken inside the word (fixed),
  a blank capture (re-captured). Rejected: the collapsed chevron's gray box (hover state left by the capture script); an
  upcoming review card saying "No one joined" and "None yet" (different facts). Round 2 (fresh Opus) FAIL, no P1: idea
  title cut at 320 px (now two lines), "Elige hasta 3" split at 320 px Spanish (hint kept whole). Round 3 (fresh Sonnet)
  PASS. Accepted trade-off: at 768 px the interest blurbs truncate sooner so the names show in full (blurbs keep their
  full text in the title). P3s left: the "Dipbot suggests" bar on phones, three primaries at 1440 (two idea cards and
  Next), Audit's dangling separator dot (A18).

## Handoff

Still open: the Dipbot "Dipbot suggests" bar is about 140 px on phones (Refresh and Use suggestions wrap to two rows);
two "Use this idea" primaries plus Next on Dipbot at wide widths; A18 P3s; the timing-sensitive `IdeasForYou.test.tsx`
case. Nothing deployed. No backend, contract or iOS changes.
