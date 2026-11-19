# Work session

User: sandervonk
Date: 2026-11-18
Workstream: admin-usability-study
Agent: Claude (Opus 5.5), participants Sonnet 5.5
Status: completed

## Summary

Simulated usability study of the admin portal (mock mode): study script with six personas and ten tasks, a browser
driver that exposes only what a person at a screen has, six participant agents in round 1, findings, a design
review of candidate fixes, and a round 2 re-test of the fixes (fixes are in their own PR, branch
fix/admin-usability-round1, session log SESSION_sandervonk_2026-11-18_919.md). Participants are model agents, not
people; the script and findings say what that limits.

## Changes

- docs/research/admin-usability-study-2026-11/script.md: goals, honesty note, personas, tasks with success criteria,
  moderator guide, coding scheme, severity scale, how to run it again.
- driver/: server.mjs (one headless Chrome context per participant; screenshot, numbered controls by role and name,
  click, type, keys, scroll, back, viewport, reset, accessibility tree; command log), drive.mjs, start-all.sh,
  metrics.py (task split by start page; unreliable in practice, see findings).
- sessions/: six round 1 logs and four round 2 logs written by the participant agents (screenshot paths point to an
  uncommitted scratch folder).
- findings.md (per-task results, ranked issues with evidence, artifacts, themes), decisions.md (auditor decisions per
  fix), retest.md (round 2 comparison, coverage gaps, open issues), img/ (nine small before/after JPEGs).

## Validation

- Round 1: 41 task attempts across six personas, coded against the script criteria.
- Round 2: 13 task attempts across four personas on the fix branch.
- Design audit of the built fixes: round 1 FAIL (four items), round 2 PASS.
- `python3 scripts/session-log.py check --base origin/main`: run after committing.
- No product code in this PR; app checks are listed in the fix PR's log.

## Decisions

- Participants get a start page per task (moderator setup) and never the success criteria or the repository.
- Times are not reported (parallel agents on one dev server); steps are participants' own counts.
- Round 2 changed one scenario detail (T6 work email on the company domain) because round 1's address was an artifact.

## Handoff

- Five participant runs were stopped by an API safety filter (false positives on role-play briefs): office-mgr and
  phone-first in round 2 entirely, keyboard-sr after T2, plus two round 1 restarts. Review focus, weekly email and
  phone covers were therefore not re-tested with participants.
- Confirm the top findings with five real admins before larger changes (draft state, Members add link, retry feedback).
