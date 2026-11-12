# Seed and backfill script conventions

Scripts that write data (seeds, backfills, migrations) are operator tools. They never run in CI against a real project and never run as part of routine coding. This page is the contract every such script follows; existing scripts that predate a rule are listed at the end.

## Where they live and what they are

| Script | Purpose | Target |
| --- | --- | --- |
| `gcp/scripts/seed.mjs` (`npm run test:seed`) | Demo fixture `gcp/sample-data/v1.json` | **Emulators only**: refuses anything except project `demo-dip` and the local Auth and Firestore emulator hosts. |
| `scripts/seed-weekly-theme.mjs` | The "Fitness" weekly theme (a `Challenge`) per company | Real project through Application Default Credentials, or an emulator through `FIRESTORE_EMULATOR_HOST`. |
| `gcp/scripts/backfill-event-shares.mjs`, `backfill-roster.ts`, `backfill-rsvp-profile.mjs` | Backfills of server-owned data after a schema addition | Same as above. |
| `scripts/migrate-company-domains.mjs` | One-off company domain migration | Same as above. |

New operator scripts go in `gcp/scripts/` (backend data) or `scripts/` (cross-cutting), as ES modules (`.mjs`) that load `firebase-admin` through `createRequire(new URL("../functions/package.json", import.meta.url))` so they use the Functions workspace's dependency.

## Rules for every script that writes

1. **Dry run by default.** Without `--apply` the script reads, prints exactly what it would create, change or skip, and writes nothing. `--apply` is the only way to write. The first output line states `DRY-RUN` or `APPLY` and the target (`emulator <host>` or `LIVE project <id>`).
2. **Explicit target.** `--project <ID>` is required for anything that can reach a live project; the script prints it back. Credentials are Application Default Credentials (`gcloud auth application-default login`) or an emulator host variable. No key files, tokens or secrets in the repository, arguments, fixtures or logs.
3. **`seed-` prefix for seed documents.** Every document ID a seed script creates starts with `seed-` (for example `seed-fitness-20261109`), so seeded data is recognizable and removable and can never collide with a server-generated or user-generated ID. Demo members use `seed-` UIDs and emails under a reserved test domain. Backfills write real keys (for example `eventShares/{eventId}`) and are not seeds; they follow rules 1, 2 and 4 to 7 only.
4. **Deterministic IDs and idempotence.** The ID derives from the content (company, theme key, week), so a rerun finds the document instead of duplicating it. An existing document is never overwritten; a conflict (same ID, different content) is reported and skipped.
5. **Server-owned fields stay server-owned.** Scripts may write fields clients cannot (counts, balances, revisions) only when they mirror exactly what the callable would write (revision 1, `createdAt`/`updatedAt` server timestamps, `createdBy` a documented system value), and they reuse the same validation rules (for example the weekly window overlap rule). Prefer calling the domain code over re-implementing it.
6. **Manifest.** With `--apply`, the script writes (and prints) a manifest file next to the run: `seed-manifests/<script>-<UTC timestamp>.json` (gitignored; keep it with the session log or in the team drive). It lists the project, script name, git commit, arguments, and every document path created or skipped. The manifest is the input for undo.
7. **Undo.** Each seed script supports `--undo <manifest.json>` (dry run by default, `--apply` to delete). It deletes only documents listed in the manifest that still have a `seed-` ID and the recorded content hash or revision 1 (a document edited since is reported, not deleted). Backfills that cannot be undone safely say so in their header and must be preceded by a Firestore export:
   `gcloud firestore export gs://<backup-bucket>/pre-<script> --project <ID>`.
8. **Never touch real people's data.** Seeds do not create Auth users in a live project, do not write to real members' `users/{uid}` documents, and do not send notifications. Triggers still fire on writes: say in the header which triggers a seed will fire (for example RSVP triggers create notification levels) and prefer a window where that is harmless.
9. **Tests.** Pure helpers (ID derivation, window math, manifest building) have unit tests; the write path is exercised against the emulator in a script test or `npm run test:seed`-style target. Never point a test at a live project.

## Running one against production (checklist)

1. Run the dry run, read the output, and have a second person read it for anything involving real companies.
2. Export Firestore if the script is not a pure create-only seed.
3. Run with `--apply`; keep the manifest.
4. Smoke test the result in the app or portal; record the command, commit, manifest path and result in the session log.
5. To undo: `--undo <manifest> ` dry run, then `--undo <manifest> --apply`.

## Known gaps against these rules

- `scripts/seed-weekly-theme.mjs` already has dry run by default, deterministic IDs (`weekly-fitness-<yyyymmdd>`) and never overwrites, but its IDs are not `seed-` prefixed, and it has no manifest or `--undo` yet. The two production weeks created on November 9 (`weekly-fitness-20261109`, `weekly-fitness-20261116`) are real data now: remove them through `updateChallengeV1`/the admin portal, not by script. Bring the script to rules 3, 6 and 7 before its next production run.
- The backfill scripts are create-only or merge-only and dry-run by default; they have no manifest. They are idempotent, so a rerun is the recovery path.
