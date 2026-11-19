# Shared design review protocol

Every UI change without a Figma frame (admin portal, emails, iOS screens built from the design system) is reviewed by a fresh design-reviewer subagent before it ships. Authors do not grade their own work. The owner's rule: screenshots plus reviewer rounds until PASS.

## When
- Any new or changed screen, component, state, email template or empty/loading/error state.
- Skip only for copy-free refactors with a pixel-identical before/after check.

## How an author runs a round
1. Capture screenshots (mock mode for the admin portal; the real renderer for emails; simulator for iOS) at 1440, 768, 390 and 320 CSS px, in English and Spanish, plus the pseudo-locale where the portal has one, covering default, hover/focus, loading, empty, error, long-text and disabled states. Add a before image when changing an existing screen.
2. Spawn a fresh subagent (a new one each round; Sonnet by default, Opus for a hard judgment call). Give it the screenshots, the task the screen supports, and the rubric below. Do not give it your rationale or tell it what you expect.
3. It returns a verdict: PASS or FAIL, then a list of findings ranked P1 (broken or unusable), P2 (clearly wrong or inconsistent), P3 (polish), each naming the screenshot and what it saw.
4. Fix every P1 and P2, re-capture, and run a new round. Maximum three rounds per screen; report anything still failing.
5. Record the decisions that changed because of the review (accepted, rejected and why) in the session log or the PR description.

## Rubric
- **Hierarchy and purpose:** the primary action is obvious, one primary per view, labels say what happens.
- **Consistency:** uses the kit (`components/kit`, `DipbotAction`, `SectionHeader`, `ErrorNotice`) and tokens; no one-off styles where a shared component exists; same pattern looks the same everywhere.
- **Layout:** alignment, spacing rhythm, no clipping, no overlap, no horizontal page scroll, equal-height rows, wrapping that stays tidy; judge by measured ratios and sizes, never by comparing screenshots at different scales.
- **Content:** plain language, no raw status codes or reason keys, no provider names, US spelling, Spanish reads naturally and is not truncated.
- **States:** loading, empty, error, disabled and success are designed and consistent; errors use the shared alert.
- **Accessibility:** text contrast AA (4.5:1, 3:1 for large text and icons), visible focus, touch targets of at least 44 px on phones, meaning never carried by color alone, correct roles and names.
- **Emails:** shared header, body card and footer unchanged; renders in the plain-text part; the main action is one button; dates, times and zone are clear.

## Reviewer brief template
"You are an independent design reviewer. You have not seen this work before. Look at every attached screenshot (open them, do not guess). The screen supports this task: <task>. Judge it against the rubric in docs/design/design-review.md. Return PASS or FAIL and a ranked P1/P2/P3 list, each with the screenshot and the exact thing you saw. Compare sizes by measured ratios, not by eye across different scales. Say what you could not judge."
