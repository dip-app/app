# iOS agent instructions

Read root AGENTS.md, docs/milestones/V1.md, contracts/README.md, and docs/design/README.md first. This branch sets up work; do not interpret stubs as finished features.

Own one feature folder per branch. Put views and ViewModels in Features, repository interfaces in Domain, Firebase adapters in Data. Import DIPContracts and DIPDesignSystem; never hand-edit generated code. Firebase Timestamp/DocumentSnapshot mappings stay in Data; ISO JSON DTOs are not drop-in Firestore persistence structs. UI text, errors, loading and empty states belong to the feature.

Update project.yml for build settings/dependencies, never the generated xcodeproj. Do not add signing identities, production configuration, hardcoded tenant IDs, points or role writes. Use native share sheet for V1; deep links are out of scope. Follow test findings: one Join action, clear Joined state, date/location visibility, View Attendees, recognizable labeled My Events and Past Events.

Run package tests and generated-file checks for DTO/token edits. Run simulator build/tests for app changes; state any skipped environment check. Review contract and token changes with their counterpart owners before merging.

## Session handoff

Follow root SESSION.md. Start a new docs/sessions/SESSION_<username>_<date>_<NNN>.md per working session using npm run session:new; update it as work proceeds and before the PR. One session may contain several commits. The PR gate requires a newly added valid log, not a new file per commit. Record changed paths, decisions, exact checks, pending work and handoffs; never include secrets.
