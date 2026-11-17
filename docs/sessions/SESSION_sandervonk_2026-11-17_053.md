# Work session

User: sandervonk
Date: 2026-11-17
Workstream: secrets-wiring
Agent: Claude Sonnet
Status: handoff

## Summary

Wired this repo to the private `dip-app/secrets` repo (sops + age) so builds, TestFlight, CI and backend deploys can fetch secrets and signing material without plaintext in git. Nothing deployed, no real secret read, written or pushed; `dip-app/secrets` was only read (README, `.sops.yaml`).

## Changes

- `scripts/secrets/lib.sh`, `pull.sh`, `sync-gcp.sh`: clone/update into gitignored `.secrets-cache/` (gh token, `DIP_SECRETS_TOKEN` or `DIP_SECRETS_DEPLOY_KEY`, passed via env not argv), decrypt with `SOPS_AGE_KEY` or `~/.config/sops/age/keys.txt`, materialize `GoogleService-Info.plist`, `Local.xcconfig`, backend env, admin public env; overwrite protection; Secret Manager sync via stdin with `--dry-run` names only.
- `scripts/testflight.sh`: optional `--use-secrets` (pull files, ASC API key to a temp 600 file, `-authenticationKey*` flags for archive and export). Default path unchanged.
- `.gitignore`: `.secrets-cache/`, `*.dec.*`, `*.p8`, `*.pem`.
- `.github/workflows/admin.yml`: commented, inactive example steps only.
- `docs/ops/secrets.md` (model, layout, rotation, onboarding, recovery, owner steps, threat model); links from `docs/ops/README.md` and the TestFlight doc.
- Tests: `scripts/tests/test_secrets.sh` (24 checks) and `test_secrets.py` wrapper (skips without sops/age).

## Validation

- `bash scripts/tests/test_secrets.sh`: 24 of 24 passed with a throwaway age key, fake data and a fake firebase CLI (decrypt, materialize, idempotence, overwrite protection, dry-run, stdin-only delivery, missing sops, missing key, wrong key, missing file, invalid name, placeholder recipient).
- `bash -n scripts/testflight.sh`. `npm run test:sessions` and `npm run test:docs` run before the PR.
- Not run: `testflight.sh --use-secrets` end to end (needs real API key and paid team), real clone from `dip-app/secrets` (placeholder recipient), real `firebase functions:secrets:set`, CI steps.

## Decisions

- Signing via App Store Connect API key (cloud-managed signing) instead of importing a `.p12` and profiles into a temporary keychain: no certificate handling, nothing to clean in the login keychain, works headless. fastlane match and manual import are documented as alternatives.
- Binary files are stored as `<name>.enc.json` (sops binary type) so the scaffold's `.sops.yaml` path rule matches without change.
- The scaffold README names `scripts/secrets-sync-gcp.sh`; the script is `scripts/secrets/sync-gcp.sh` as requested.

## Handoff

Owner steps are in `docs/ops/secrets.md` section 6: install tools, `age-keygen`, put the public key in `dip-app/secrets/.sops.yaml`, store the private key in the password manager and as CI secret `SOPS_AGE_KEY`, encrypt the first files, add a read-only token or deploy key, rotate anything pasted in chat. Then run `scripts/secrets/pull.sh --only backend && scripts/secrets/sync-gcp.sh --dry-run`.
