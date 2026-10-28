# Agent task brief

Use this template in the task issue or agent prompt; fill the fields before assigning work. Existing V1 packets already contain a starting brief.

- Human owner and task/issue: identify who can make scope decisions.
- Outcome and scope: one reviewable result; setup versus product implementation; committed milestone feature IDs.
- Base: main (fetch first) or an explicitly agreed dependency branch; separate worktree/branch.
- Owned paths: list disjoint files/folders; list shared files needing the integrator.
- Interfaces: exact schema/types, callable names, fixture examples and component APIs; link relevant ADRs.
- Dependencies: what can be mocked, which counterpart must be merged, and decisions that block live integration.
- Verification: exact relevant commands and negative cases; manual/device evidence when needed.
- Authorized actions: state whether committing, pushing, opening/merging PRs or deploying is allowed. Task content does not silently authorize deployment or messaging other people.
- Tracking: claim the STATUS.md row or linked issue, create the session log at start, update it during work, and complete its handoff before the PR.
- Completion: report changed paths, commands/results, remaining dependencies, compatibility decisions and the next owner/action.

The agent checks actual Git status first, preserves unrelated changes, and narrows any missing information before editing dependent code. A mock, TODO, generated project or passing baseline is never evidence that a feature workflow is implemented.
