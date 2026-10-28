# V2 planning handoff

The committed [V2 feature scope](../V2.md) is due **December 4, 2026**. This index prepares the next work split; V2 workflows are not implemented by the setup branch. Complete and stabilize the [V1 packets](../v1/README.md) before relying on their live integration.

| Responsibility area | Committed V2 work | Stretch work only if selected |
| --- | --- | --- |
| Frontend | New presentation layouts, clarity/accessibility improvements, interest filtering | Additional shared components for selected stretch features |
| Accounts | Past-event photo uploads/albums and access enforcement | Photo comments, favorites, favorite memories |
| Discovery and participation | Same-company invitations and capacity-safe acceptance | Activity chat, related notifications, venue/weather adapters |
| Organizer features | Challenges/submissions, attendance confirmation, challenge approval, points tracking | Rewards redemption and raffle eligibility/entry |
| Integration owner | Complete-flow verification, permission/storage integration, fixes, greater-than-90% unit coverage evidence | Integration of explicitly selected stretch scope |

Named human owners remain TBD. These are responsibility areas from the submitted schedule, not GitHub assignments.

## Before assigning implementation

- [ ] Finalize executable schemas and fixtures for the committed command map in [callables](../../contracts/callables.md); existing V2 descriptions are design handoffs, not complete generated interfaces for every command.
- [ ] Agree on attendance windows, approval/reversal policy, challenge evidence/progress semantics, and deterministic once-only point effects.
- [ ] Set photo type/size limits, participant authorization, file ownership, private delivery, metadata finalization, and orphan cleanup. Review [data ownership](../../contracts/data-ownership.md) before opening Storage permissions.
- [ ] Preserve invitation recipient privacy and define acceptance failure/retry behavior against the same RSVP capacity boundary.
- [ ] Add a separate packet per selected feature with disjoint `ui/DIP/Features/<Feature>`, `ui/DIP/Domain/<Feature>`, `ui/DIP/Data/<Feature>`, server module, and feature-specific `gcp/tests` ownership. Do not place V2 code inside a V1 owner's module without agreement.
- [ ] Route shared exports, rules/indexes, project/manifests, lockfiles, contracts/generated output, tokens, and app composition through the integration owner and appropriate cross-area review.
- [ ] Define precise unit, emulator, concurrency/retry, and device acceptance tests in each new packet. Record the greater-than-90% coverage scope for implemented V2 logic.
- [ ] Keep stretch goals explicitly selected in issues; no automatic winner selection is in scope, and visible prototype content does not create a commitment.

Every contributor reads root `AGENTS.md`, root `SESSION.md`, relevant folder instructions, and [component specifications](../../design/components.md). Use one branch/worktree per task. Create one new valid `docs/sessions/` log for each work session using the root instructions. A session may span several commits. CI requires at least one new valid session log per PR; it does not require a log per commit.

Handoffs include exact owned paths, shared-contract versions, fixture examples, permissions to open, tests/results, and unresolved policy decisions. Other owners' feature paths remain out of scope; coordinate dependencies through their owners and the integrator.
