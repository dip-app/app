# Admin portal usability study, November 2026: script

Study of the DIP admin portal (`apps/admin`, mock mode) with **simulated participants**: one language-model agent per
persona, driving a real headless Chrome through a small driver (`driver/`) that only exposes what a person at a
screen has (screenshots, visible controls by role and name, clicks, typing, keys, scrolling, Back). Participants never
see the repository, docs, tests or this script's success criteria.

## Honesty note (read first)

Simulated participants are an approximation. They are useful for finding where labels, layout, flow and feedback
fail to explain themselves, because the agent has to act from what is on screen. They are weak at:

- real prior experience (no habits from HR tools, no muscle memory, no real stakes or time pressure);
- emotion, trust and fatigue, which they can only role-play;
- perception: they see downscaled screenshots and a text list of controls, not a live screen; a misread pixel is not
  a human misread, and a text list can make a hidden control easier (or harder) to find than it is;
- language: the "non-native English speaker" is a model reading Spanish, not a native speaker;
- assistive technology: the "screen reader" persona reads an accessibility snapshot and moves focus with keys; it is
  not VoiceOver or NVDA and cannot judge speech verbosity or announcement timing.

Findings are hypotheses to confirm with 5 real admins before large investments. Times are agent wall-clock and steps
are driver commands; compare them between rounds of this study only, never with human benchmarks.

## Goals

1. Find where a first-time or occasional admin cannot complete core jobs without help.
2. Find wording, structure and feedback problems in the most used flows (Overview, Events, Dipbot, Review, Roster,
   Audit log, Your settings).
3. Check the Spanish UI, the 390 px phone layout and keyboard-only use on the same tasks.
4. Produce a severity-ranked issue list that is concrete enough to fix, then re-test the fixes.

Out of scope: visual taste, backend correctness (the mock enforces the callable rules), features not in the build.

## Setup

- Build: `main` at the study commit, `apps/admin` in mock mode (`next dev`), Chrome headless, reduced motion, time
  zone America/New_York.
- Each participant has its own browser context (the mock keeps data in that browser's localStorage), so participants
  do not see each other's changes. `reset` restores the seeded data.
- The moderator (the orchestrating agent) gives each task as a short scenario plus a **start page**, the way a
  moderator prepares the screen before a task. Start pages with a `?` scenario only set up a state the participant
  could meet in real life (no office saved yet, a service failure).
- Participants sign in with the mock's "Sign in as admin" button unless the task says otherwise.

## Personas

| Id | Persona | Experience | Setup | Lens |
| --- | --- | --- | --- | --- |
| P1 `new-hr` | Dana, HR generalist at a 250-person logistics company, just made DIP admin. Has never seen the tool. Uses Workday and Slack daily. | None with DIP | 1440x900, English | Discoverability, first-run meaning of terms |
| P2 `office-mgr` | Marcus, office manager at a 60-person design studio. Uses the portal weekly to post events; impatient, skims. | Weekly (told: "you have used it for a few months, mostly Events") | 1440x900, English | Efficiency, scanning, defaults |
| P3 `es-speaker` | Lucía, people-ops coordinator in Monterrey, reads English slowly and prefers Spanish. | Occasional | 1440x900, browser language es-MX (portal opens in Spanish) | Translation clarity, terms, layout with longer strings |
| P4 `keyboard-sr` | Sam, low-vision admin who uses the keyboard and a screen reader; does not use a mouse. | Occasional | 1440x900, English; may only use `tree`, `list`, `focus`, `press`, `keys`, `type` (no screenshots, no clicking by number) | Focus order, names, announcements, keyboard traps |
| P5 `phone-first` | Priya, operations lead at a retail chain; does admin work from her phone between store visits. | Occasional | 390x844 touch, English | Small-screen layout, tap targets, hidden navigation |
| P6 `power-user` | Tom, skeptical IT-adjacent admin who has used many SaaS consoles; wants speed and control and distrusts AI features. | Has used similar tools a lot | 1440x900, English | Shortcuts, information density, trust in Dipbot, audit detail |

## Tasks

Each task: scenario read to the participant, start page, success criteria (moderator only), think-aloud prompts.
Time limit: 25 driver commands or until the participant gives up.

| # | Task | Start | Success criteria (moderator only) | Personas |
| --- | --- | --- | --- | --- |
| T1 | "Your manager asks how people are engaging with DIP this week. Find out and tell me in two sentences." | `/overview/` | Names at least two of: active members, RSVPs, this week's theme participation or completion, submissions to review. Partial: one figure. | P1 P2 P3 P5 P6 |
| T2 | "Create a social event for next Friday at 5 PM, a board-game night in the office, 30 spots, and publish it so people can see it." | `/events/` | Event saved with a title, a future start, a place and capacity 30, and it shows in Upcoming. Partial: saved with errors left or wrong time. | P1 P2 P3 P4 P5 |
| T3 | "You're out of ideas for next month. Use the assistant in the portal to get event ideas, pick one you like and turn it into a draft event." | `/overview/` | Reaches Dipbot, generates ideas, opens one in the event editor with fields filled. Partial: ideas seen but no draft. | P1 P3 P5 P6 |
| T4 | "Your company hasn't told the portal where the office is. Set the office to 600 Grant Street, Pittsburgh, then find a nearby venue for a team lunch." | `/events/new/?office=unset` | Office saved and one venue picked into the event's place fields. Partial: office saved only. | P1 P2 P4 P6 |
| T5 | "There are weekly challenge submissions waiting. Review one: approve it if it fits the theme, or ask for changes with a short note." | `/overview/` | One submission approved, or changes requested with a note. Partial: found the queue but did not act. | P2 P3 P4 P5 |
| T6 | "A new coworker, Jordan Lee (jordan.lee@example.com), starts Monday. Add Jordan so they can join, then resend the invite to someone who was invited but hasn't joined yet." | `/overview/` | A roster entry for Jordan exists and a resend is recorded for an invited, not joined person. Partial: one of the two. | P1 P2 P5 P6 |
| T7 | "Something changed on an event yesterday and nobody remembers who did it. Find out who last changed an event, and when." | `/overview/` | Opens the Audit log and names an actor and time of an event change. Partial: finds Audit log but cannot narrow it. | P3 P4 P6 |
| T8 | "You'd like the weekly ideas email on Tuesdays instead, and you want to see what it looks like in your own inbox now." | `/overview/` | Schedule saved to Tuesday and a test email sent (or the participant correctly explains why it can't be sent). Partial: one of the two. | P1 P2 P4 P6 |
| T9 | "Switch the portal to the other language (Spanish, or English if it's already in Spanish), then switch it back." | `/overview/` | Language changed and changed back. | P1 P3 P4 P5 |
| T10 | "You were asking the assistant for ideas and something went wrong. Try to get your ideas anyway." | `/ideas/?step=results&ai=error` | Understands it failed, tries again or chooses another path, and can say what happened. Partial: retries without understanding. Failure: thinks they did something wrong or is stuck. | P2 P3 P5 P6 |

Each persona does 6 or 7 tasks (about 40 minutes for a person), every task has 4 or 5 participants.

## Moderator guide

Before: "Thanks for helping. We are testing the website, not you. There are no wrong answers. Please think aloud:
say what you are looking at, what you expect to happen and what you are unsure about. If you would give up in real
life, say so; that is useful."

Per task: read the scenario once, set the start page, then stay silent. Neutral prompts only, when the participant
stalls for several steps:

- "What are you looking for right now?"
- "What do you expect to happen if you do that?"
- "What would you do next if I weren't here?"
- "What does that word mean to you?"

Never: name a control, confirm or deny a path ("yes, that's right"), say "click", "try the X menu", or praise.
After each task: "How did that go?", then the questionnaire.

Post-task questionnaire: ease (SEQ 1 to 7, 7 = very easy), confidence that it worked (1 to 7), what was confusing,
what you would change. After all tasks: the one thing that annoyed you most, the one thing you liked.

## Coding scheme

Per task per participant (from the think-aloud log and the driver's `commands.jsonl`):

- **Outcome:** S success, P partial, F failure (gave up, wrong result believed correct, or limit reached).
  Wrong result believed correct is coded F and flagged "false success".
- **Time on task:** wall-clock from the first to the last driver command; **steps:** driver commands that act or
  look (`shot`, `list`, `read`, `tree` count; failed commands count).
- **Confusion events:** H hesitation (says unsure, re-reads, goes back), M misclick or wrong path, E expectation not
  met (did something, result differed), L label misunderstood, D did not notice feedback, X dead end.
- Each confusion event gets the screen (address), a quote and the screenshot path.

## Severity scale

| Level | Meaning |
| --- | --- |
| 4 Critical | Blocks the task for most participants, or a false success with real consequences (wrong data published, wrong person changed). |
| 3 High | Blocks or causes failure for some, or costs most participants a lot of time; no easy workaround they found. |
| 2 Medium | Noticeable hesitation or wrong path, recovered without help. |
| 1 Low | Cosmetic or wording friction, one participant, no effect on outcome. |

Frequency (how many personas) and impact (outcome effect) together set the level; a single-persona issue can still be
High when it blocks that persona's whole lens (for example a keyboard trap).

## Analysis plan

Per-task success rate and median time/steps; issue list with evidence (persona, quote, screenshot); clusters by
theme; root-cause hypotheses. High and Medium issues plus quick wins go to a design review (decisions.md) before any
fix; accepted fixes are rebuilt and the affected tasks are re-run with fresh participants of the same personas.

## Running it again

1. Start the portal in mock mode on a free port: `cd apps/admin && npx next dev -p 3317`.
2. Install the driver's one dependency outside the repo: `npm i playwright-core@1.49.1` in a scratch folder (it drives
   the installed Google Chrome; no browser download).
3. Start one driver per persona: `PW_CORE_DIR=<scratch>/node_modules driver/start-all.sh <scratch> r1` (ports 4401
   to 4406; screenshots and `commands.jsonl` go to `<scratch>/r1/<persona>/`).
4. Give each participant agent its persona, the tasks (scenario and start page, never the success criteria) and the
   driver usage from `driver/drive.mjs`; forbid reading anything but its brief and its screenshots.
5. Stop the drivers: `node driver/drive.mjs <port> quit` for each port, then the dev server.

Session logs are in [sessions/](sessions/); screenshot paths in them point to the scratch folder (`scratch/...`),
which is not committed.
