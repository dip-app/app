# Contract agent rules

Coordinate changes with one backend and one iOS reviewer. Read README.md, callables.md and data-ownership.md. Edit v1/models.schema.json and fixtures, then run npm run generate and npm run check. Never hand-edit generated Swift/TypeScript. Extend supported generator shapes deliberately and test both languages when changing schema structure.

Wire compatibility and persisted Firestore compatibility are separate reviews. Never use client companyId or userId as authorization. Required-field additions and enum meaning changes can break clients. Keep server ownership, idempotency, errors and migration plans explicit. All current endpoint specs are unimplemented. Add schemas to V2 commands before handing implementations to separate agents.

## Session handoff

Follow root SESSION.md. Start a new docs/sessions/SESSION_<username>_<date>_<NNN>.md per working session using npm run session:new; update it as work proceeds and before the PR. One session may contain several commits. The PR gate requires a newly added valid log, not a new file per commit. Record changed paths, decisions, exact checks, pending work and handoffs; never include secrets.
