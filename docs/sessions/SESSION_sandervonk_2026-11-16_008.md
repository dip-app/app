# Work session

User: sandervonk
Date: 2026-11-16
Workstream: v2-stretch-goals
Agent: Claude
Status: completed

## Summary

Researched and documented the owner's five stretch goals (calendar conflicts, AI event ideas, tag interest counts, push triggers with category settings, emails) as V2 stretch items. Docs and project-board work only: no app or server code, no deploys.

## Changes

- `docs/milestones/v2/STRETCH_GOALS.md`: index, dependencies, build order, what the repo already has, filter instructions.
- `docs/design/stretch/calendar.md`, `ai-event-creation.md`, `tag-interest-counts.md`, `push-triggers.md`, `email.md`: goal and stories, repo findings with paths, options with recommendations, data model and contract sketches, security and privacy, testing, rollout, risks, open questions, sub-item tables, sources.
- `docs/milestones/v2/FRONTEND_PLAN.md` and `docs/milestones/v2/README.md`: pointer to the stretch doc.
- GitHub (after this PR merges, so design-doc links resolve): labels `stretch`, `calendar`, `ai`, `tags`, `push`, `email`; one parent issue per item with sub-issues generated from the work-breakdown tables; all added to the DIP V2 project with Status Todo. The final counts and links are in the PR description and the agent report.

## Validation

- `npm run test:docs` (local Markdown link check) and `npm run test:sessions` run before the PR.
- Web research used official docs; every doc ends with a Sources section and marks unverified claims (Apple developer pages returned only titles to the fetch tool; `github.com/mvtime/mvtt-server` returned 404).
- No product code ran. Pending items are plans, not shipped behavior.

## Decisions

- Tag counts per company (`companies/{c}/tagStats/{tagId}`), not on the globally readable `tags/{tagId}` document, to avoid cross-tenant leakage (needs owner confirmation).
- Calendar conflicts read EventKit full access on device only, opt-in, with a DIP-only phase first; Google freebusy, service accounts and ICS-from-shared-address were evaluated and not recommended as the primary path.
- One shared notification category and preference model (owned by the push doc) and one delivery router for push and email.
- Email through a provider API behind a port (Postmark recommended), not the Firebase extension; react-email templates.
- AI: server callables with Anthropic structured output (Haiku 5.5 default, Sonnet 5.5 option), aggregates only, per-company metering, catalog art first.

## Handoff

Open owner questions are listed at the end of each design doc and summarized in `STRETCH_GOALS.md`. Next steps: owner answers, then pick slices to schedule (smallest valuable: TAG-1 and TAG-2, CAL-1, PUSH-1 and PUSH-7, EML-1). Long lead items for the owner: provider choice, DNS and mailboxes for `letsdip.work`, paid Apple team and APNs key.
