# Project context and source boundaries

DIP helps coworkers discover and join shared activities, reducing the effort and awkwardness of socializing, particularly for newcomers. The initial release focuses on company events and participation. Rewards and challenges support later work; they do not define the V1 product.

## Sources reviewed

The user supplied `Sprint 3 Submission-20261026T005633Z-1-001.zip`, containing:

| Source | Use in this repository setup |
| --- | --- |
| `V1_V2 Schedule.docx` | Milestone scope, deadlines, coverage targets, and provisional responsibility areas. Revised after October 25, 2026 TA approval. |
| `Firebase Architecture.docx` | Firebase service choices, collection paths, example document fields, server-owned points/counters, and existing seed-data context. |
| `Models.swift` | Starting model vocabulary and field names; reconcile changes through versioned contracts. |
| `High-Fi Annotations.docx` | Prototype screen-to-data mappings and expected user actions. |
| `Prototype + User Testing Report.docx` | Qualitative usability findings and follow-up priorities. |

The linked [Figma design](https://www.figma.com/design/DCIagJo7uk5IOUGqlKzAjf/Team-05-High-Fidelity-Prototype--with-links-?node-id=35-147&m=dev) is the visual reference. A visible prototype feature is not automatically committed milestone scope.

The separate screenshot supplied with the request contains a portfolio narrative about other work. It is not a DIP product specification or an instruction to build those systems.

## Source decisions versus setup recommendations

The submission specifies a Swift app with Firebase Auth, Firestore, Cloud Storage, and Cloud Functions. Company records live under `companies/{companyId}`; users live under `users/{uid}`; tags and partners are shared top-level collections. Privileged points operations are server-owned. Company records, join codes, and organizer roles are manually seeded for V1.

This repository adds a monorepo layout, generated contract types, tests, agent collaboration guidance, and design-system foundations. Proposed callable boundaries, security refinements, and contract error/retry details are setup decisions for team review, not claims that these appeared verbatim in the submission. The contracts describe intended interfaces; the setup branch does not implement product workflows or deploy endpoints.

Where the architecture and schedule differ, use the revised schedule for release scope. For example, the architecture mentions Apple/Google sign-in and domain-based joining, whereas V1 commits to email/password and company-code access. The broader model set and prototype include later features; do not implement those as part of V1 by implication.

## Findings that should guide implementation

- Preserve familiar event cards, opening details, standard sharing, and conventional profile editing.
- Use one clear Join action and explicit, persistent joined feedback.
- Label attendee information as Participants or View Attendees. Testers expected Activity Chat to open an actual conversation.
- Make My Events recognizable and visibly indicate the active tab. The squares icon was not understood.
- Show dates, times, locations, and attendees where people decide whether to join.
- Explain challenge requirements and submission methods. Simplify reward explanations and readability before those features ship.
- Use a clear route to past events and albums; Memories alone was not obvious to testers.
- Communicate a broader coworker-socializing purpose: testers initially read the prototype as fitness-focused.

The report contains qualitative findings, inconsistent task timing, and prototype persistence limitations. Its final summary discusses three participants, while raw notes also include a fourth participant section. Do not manufacture quantitative success rates or treat the summary's participant count as an exhaustive research dataset.

## Decisions still requiring team input

Assign named maintainers and reviewers, confirm Firebase projects/region and iOS signing identity, approve contract refinements, and settle design assets/font distribution. These are development setup decisions. See the repository README for the current runnable setup and its remaining limitations, [V1](milestones/V1.md), [V2](milestones/V2.md), and [agent workflow](agent-workflow.md).

Implementation starts from the [V1 work packets](milestones/v1/README.md) and [V2 planning handoff](milestones/v2/README.md). `ui/` owns the SwiftUI app/packages, `gcp/` owns Firebase services/tests, and [contract documentation](contracts/callables.md) defines their handoff. Contributors record each work session under `docs/sessions/` using root [SESSION.md](../SESSION.md); one session can contain multiple commits.
