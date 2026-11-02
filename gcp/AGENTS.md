# Firebase agent guidance

Read the repository's root `AGENTS.md`, feature scope, and `contracts/` before changing this service.

- This branch provides scaffolding. resolveMembershipV1 (Google sign-in, email-domain membership, ADR 0007) is implemented/exported and emulator-tested, but no callable has been deployed.
- Feature code lives in `functions/src/modules/<area>/`, with module-local `transport`, `application`, `domain`, and `infrastructure` layers. Work packets own accounts, participation, and organizer modules. Top-level layer folders are only for reviewed cross-cutting helpers; the integrator wires the root export list.
- `functions/src/index.ts` is the deployment export list. Adding an export makes it deployable; do this deliberately in a feature PR.
- Never edit `functions/src/generated/` directly. Regenerate from the shared contract source.
- Derive identity from verified Firebase Auth context. Recheck company membership and authorization on every server command. Admin SDK calls bypass Security Rules.
- Keep client writes to membership, organizer roles, balances, counters, approvals, and ledgers denied until a reviewed workflow owns them.
- The initial Firestore and Storage rules deny every client operation. This is intentional setup behavior, not a finished authorization policy.
- Introduce each allowed operation with emulator tests for permitted access, unauthenticated access, another company, privilege escalation, and protected fields. Do not replace the baseline with a blanket authenticated-user rule.
- Use `demo-dip` and the emulators for development and tests. Never seed, reset, or deploy to a real Firebase project as an incidental test step.
- Run the backend build, unit tests, contract checks, and relevant emulator tests. A TODO test is pending work, not passing feature coverage.
- Do not commit service-account files, production credentials, user data, or emulator exports containing real users.

## Session handoff

Follow root SESSION.md. Start a new docs/sessions/SESSION_<username>_<date>_<NNN>.md per working session using npm run session:new; update it as work proceeds and before the PR. One session may contain several commits. The PR gate requires a newly added valid log, not a new file per commit. Record changed paths, decisions, exact checks, pending work and handoffs; never include secrets.
