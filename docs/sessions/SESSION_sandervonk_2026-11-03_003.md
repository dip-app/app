# Work session

User: sandervonk
Date: 2026-11-03
Workstream: 02-accounts-profile
Agent: Claude Code (Sonnet 5.5)
Status: completed

## Summary

Removed the separate `companyDomains` Firestore collection. `resolveMembershipV1` now finds the company with a transactional Admin query on `companies.emailDomain` (single string field, existing contract; no schema change).


## Changes

- gcp/functions: `firestoreMembershipStore` queries `companies where emailDomain == root limit 2`; zero or two-plus matches both return NO_COMPANY_FOR_DOMAIN (duplicates logged as errors). Removed the `companyExists` port.
- gcp/firestore.indexes.json: explicit ascending single-field override for `companies.emailDomain` (no composite index needed).
- gcp/firestore.rules: comment only; client list/query of companies and emailDomain writes stay denied (new rules tests).
- Tests (unit, integration, callable, rules, sample-data contract), seed script and fixture: companyDomains removed; seed rejects non-root, personal and duplicate emailDomain.
- scripts/migrate-company-domains.mjs: idempotent, dry-run-by-default migration of live data.
- Docs: ADR 0007, architecture, data-ownership, callables, accounts-integration, packet 02 README, gcp READMEs.


## Validation

- `npm run check`: pass (generated, sessions, docs, contracts, build, unit).
- `npm run test:rules`: 86 pass.
- `npm run test:accounts:integration`: 11 pass (emulator, includes real callable).
- `npm run test:seed` (seed twice): pass.
- Migration script exercised on the Firestore emulator: dry run, apply+delete, and idempotent rerun.
- Not run: Swift/Xcode (no iOS code references companyDomains), `session:check` against base is run before the PR.


## Decisions

- Kept single-string `emailDomain` (stored field names must not change silently); one domain per company. Several domains per company would need an array field and a new contract version.
- Firestore cannot enforce uniqueness; enforced by seed/migration validation plus a fail-closed resolver (documented in data-ownership and ADR 0007).
- No deploy and no live data touched.


## Handoff

Maintainer must deploy indexes, rules and functions and run the migration against the live project (commands in the PR description). Before the migration, the live cmu.edu mapping needs `--overwrite-email-domain` because the demo company's emailDomain differs. Orphan or malformed mappings are left for manual review.

