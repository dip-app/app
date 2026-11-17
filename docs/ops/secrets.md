# Secrets and signing material

How DIP keeps secrets out of this repository, chat and laptops-in-a-drawer. Owner steps are in section 6. Nothing here is set up until the owner completes them: until then every script stops with a clear message.

## 1. Model

- Secrets live **encrypted** in the private repo `dip-app/secrets`, using [sops](https://github.com/getsops/sops) with [age](https://github.com/FiloSottile/age). The app repo (this one) never contains a secret, plaintext or encrypted.
- One age key pair. The **public** key is committed in `dip-app/secrets/.sops.yaml` (recipient). The **private** key is held in the owner's password manager and, for automation, as the GitHub Actions secret `SOPS_AGE_KEY`. It is never committed, pasted into chat or put in a file inside a repository.
- This repo's scripts fetch the encrypted repo into the gitignored cache `.secrets-cache/`, decrypt, and write plaintext only to gitignored paths with mode 600.
- Read access to `dip-app/secrets` (git) is separate from the ability to decrypt (age key). Both are needed.

| Task | Command |
| --- | --- |
| Materialize iOS files (`GoogleService-Info.plist`, `Local.xcconfig`) | `scripts/secrets/pull.sh --only ios` |
| Backend env for local use (`.secrets-cache/out/functions.env`) | `scripts/secrets/pull.sh --only backend` |
| Admin public web config (`apps/admin/.env.local`) | `scripts/secrets/pull.sh --only admin` |
| Set Functions secrets in Secret Manager | `scripts/secrets/sync-gcp.sh --dry-run`, then without `--dry-run` |
| TestFlight with API-key signing | `scripts/testflight.sh --use-secrets` |

`pull.sh` refuses to overwrite a local file that differs from the repo (so a hand-edited `Local.xcconfig` is not lost); add `--force` to overwrite.

## 2. Layout of `dip-app/secrets`

The scaffold's `.sops.yaml` rule matches `*.enc.env`, `*.enc.json`, `*.enc.yaml`. Binary files are stored as sops-encrypted JSON blobs named `<original name>.enc.json`.

| Path | Content | Used by |
| --- | --- | --- |
| `backend/functions.enc.env` | `NAME=value` lines: `OPENAI_API_KEY`, `JEV_API_KEY`, `POSTMARK_SERVER_TOKEN`, `EMAIL_UNSUBSCRIBE_KEY`, `EMAIL_WEBHOOK_PASSWORD`, ... Names are `UPPER_SNAKE_CASE` and equal the `defineSecret` names. | `sync-gcp.sh` |
| `ios/GoogleService-Info.plist.enc.json` | the Firebase iOS config | `pull.sh --only ios` |
| `ios/Local.xcconfig.enc.json` | the whole `ui/Config/Local.xcconfig` (see `Local.example.xcconfig`) | `pull.sh --only ios` |
| `ios/signing.enc.env` | `ASC_KEY_ID`, `ASC_ISSUER_ID` (App Store Connect API key identifiers) | `testflight.sh --use-secrets` |
| `ios/asc-api-key.p8.enc.json` | the App Store Connect API key (`AuthKey_<ID>.p8`) | `testflight.sh --use-secrets` |
| `ios/certs/`, `ios/profiles/` | optional: a distribution `.p12` and provisioning profiles as `.enc.json` blobs, only if manual signing is ever needed (section 5) | not wired |
| `apps/admin/public.enc.env` | `NEXT_PUBLIC_*` values for reproducible local admin builds | `pull.sh --only admin` |

Note: the scaffold README mentions `scripts/secrets-sync-gcp.sh`; the script is `scripts/secrets/sync-gcp.sh`.

## 3. Day-to-day

Install tools once: `brew install sops age`. Put the age private key in `~/.config/sops/age/keys.txt` (from the password manager; `chmod 600`). In CI set `SOPS_AGE_KEY` instead. `gh auth login` gives read access to the private repo locally.

**Add or change a secret** (in a checkout of `dip-app/secrets`, key available):

```sh
sops backend/functions.enc.env                 # opens $EDITOR on the decrypted values, re-encrypts on save
# binary files (plist, xcconfig, .p8): encrypt a file that lives OUTSIDE the repo
sops -e --input-type binary --output-type json \
  --filename-override ios/asc-api-key.p8.enc.json /path/outside/repo/AuthKey_ABC123.p8 > ios/asc-api-key.p8.enc.json
git add -A && git commit -m "Update ASC key" && git push
```

Then run `scripts/secrets/sync-gcp.sh` (backend values) and redeploy the Functions that bind the changed secret; `sync-gcp.sh` creates a new Secret Manager version but running instances keep the old value until redeployed. The script feeds each value to `firebase functions:secrets:set NAME --data-file -` on stdin, so values never appear in argv, process lists, logs or shell history. `--dry-run` prints names only.

Secrets that Functions bind (`defineSecret`) must exist before a Functions deploy; see [email setup](email-setup.md) section 4.

**Rotate a secret.** Create a new value at the provider (OpenAI, Postmark, Apple), update the encrypted file, sync, redeploy, then revoke the old value at the provider. Anything that ever appeared in a chat, ticket, screenshot or log is exposed: rotate it, do not just delete the message.

**Onboard a collaborator.** (1) Invite them to `dip-app/secrets` with read access (write only for people who rotate values). (2) They run `age-keygen` and send you their **public** key. (3) Add it as an extra recipient (`age: key1,key2` in `.sops.yaml`) and run `sops updatekeys` on every `*.enc.*` file; commit. Per-person keys mean you can revoke one person without rotating the shared key. (Alternative: share the single team key through the password manager; simpler, but offboarding then means rotating the key and every secret.)

**Offboard.** Remove their repo access and their recipient, run `sops updatekeys`, and rotate the secrets they could read, because git history still holds ciphertext they could decrypt with their old key.

**Rotate the age key.** `age-keygen` a new pair, put the new public key in `.sops.yaml`, `sops updatekeys` each file, update `SOPS_AGE_KEY` in GitHub and the password manager, then remove the old recipient.

**Recovery.** If the age private key is lost and no other recipient exists, the encrypted files are unrecoverable. Keep the key in the password manager plus one offline copy (for example a printed or sealed backup) and name a second recipient (a second owner) as soon as possible. Then the recovery is: re-create each secret at its provider and encrypt anew.

## 4. What is NOT secret

Do not put these in `dip-app/secrets` (they are public or in-repo by design): Firebase web API keys and app IDs, the reCAPTCHA / App Check **site** key, bundle ID, Team ID `AX2A775SS6`, the Firebase project ID `team05-dip`, App Store ID, and the iOS client IDs. The plist and `Local.xcconfig` are still kept encrypted because they are gitignored by convention and keep builds reproducible, not because each value is secret. The admin `NEXT_PUBLIC_*` values appear in `apps/admin/public.enc.env` only for reproducible builds. Plain function parameters (`.env` files with non-secret params) stay in the repo. Rule of thumb: if leaking it lets someone act as DIP or read private data, it is a secret.

## 5. iOS signing

`scripts/testflight.sh` is unchanged by default: automatic signing with the Xcode account that is signed in to the paid team.

`scripts/testflight.sh --use-secrets` (also works with `--dry-run` and `--version`) pulls `GoogleService-Info.plist` and `Local.xcconfig`, decrypts the App Store Connect API key to a 600-mode temp file, and passes `-authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID` to `xcodebuild archive` and `-exportArchive` with `-allowProvisioningUpdates`. Xcode then uses cloud-managed signing, so no distribution certificate or provisioning profile has to be stored or imported, and no Xcode account needs to be signed in (usable on a headless Mac or CI). The temp key is deleted on exit (the script's trap). The key needs the App Manager or Admin role; create it in App Store Connect under Users and Access, Integrations, App Store Connect API.

Alternative if cloud signing is ever unsuitable: [fastlane match](https://docs.fastlane.tools/actions/match/) with a passphrase against a separate private repo, or storing a `.p12` and profiles here as `.enc.json` blobs and importing them into a temporary keychain. Neither is wired, because the API-key path needs no certificate handling and has nothing to clean up in the login keychain.

## 6. Owner steps (one time)

1. `brew install sops age`.
2. `mkdir -p ~/.config/sops/age && age-keygen -o ~/.config/sops/age/keys.txt && chmod 600 ~/.config/sops/age/keys.txt`. The command prints `Public key: age1...`.
3. Store the **private** key (the whole `keys.txt`) in the password manager, plus an offline backup. Never paste it into chat, an issue, or a file in any repo.
4. In `dip-app/secrets`, replace `REPLACE_WITH_PUBLIC_AGE_KEY` in `.sops.yaml` with the `age1...` **public** key and commit.
5. Encrypt the first files (section 3): `backend/functions.enc.env` first; then `ios/GoogleService-Info.plist.enc.json`, `ios/Local.xcconfig.enc.json`, `ios/signing.enc.env`, `ios/asc-api-key.p8.enc.json`, `apps/admin/public.enc.env`. Check `git diff --cached` shows only `ENC[...]` values and the `sops` metadata block before pushing. Delete the plaintext copies (and the key from any scratch file).
6. Rotate any secret that has ever been pasted in chat or committed anywhere before moving it here.
7. CI (optional, section 7): add repository secrets `SOPS_AGE_KEY` (the private key text) and a read-only credential for `dip-app/secrets`: either `DIP_SECRETS_TOKEN` (fine-grained token, repository `dip-app/secrets` only, Contents: read) or `DIP_SECRETS_DEPLOY_KEY` (a read-only deploy key: `ssh-keygen -t ed25519 -f key -N ""`, public half under the secrets repo Settings, Deploy keys, **without** write access; private half as the secret; delete the local files).
8. Verify locally: `scripts/secrets/pull.sh --only backend && scripts/secrets/sync-gcp.sh --dry-run` lists the names.

## 7. CI

`.github/workflows/admin.yml` contains commented, inactive example steps (install sops, `pull.sh --only admin`). Nothing deploys on its own and nothing reads the secrets until someone uncomments them. Exposure rules: only run secret-using jobs on `main` or `workflow_dispatch`, never on pull requests from forks; do not echo files from `.secrets-cache/out/`; backend `sync-gcp.sh` stays a manual, owner-run action.

## 8. Threat model

- A private repo is **not** a vault. Collaborators, GitHub staff, a leaked token, a misconfigured visibility change or a fork can expose its contents, and git history is forever. Only encrypted content may be committed; the `.gitignore` in both repos blocks the usual plaintext names (`*.p8`, `*.p12`, `*.pem`, `*.mobileprovision`, `GoogleService-Info.plist`, `*.dec.*`).
- Encryption protects against repo exposure, not against a compromised laptop or CI runner where the key is present. Keep the key out of shared machines, and give the CI deploy key/token read-only scope.
- sops encrypts values but leaves keys (names) and structure readable: do not encode sensitive facts in secret names.
- The scripts keep values out of argv, stdout and logs; the age key is read from env or file and never printed. `security import`-style tools that need a password in argv are avoided on purpose (hence API-key signing).
- Rotate anything exposed in chat, a ticket, a screenshot or a log. Deleting the message is not enough.
- No secrets are deployed or changed by merging this repository's pull requests; syncing to Secret Manager is an explicit human run of `sync-gcp.sh`.

## 9. Tests

`bash scripts/tests/test_secrets.sh` (also run by `npm run test:sessions` through `test_secrets.py`) uses a throwaway age key, fake data and a fake `firebase` binary in a temp dir. It covers decrypt, materialize, overwrite protection, dry-run, stdin-only delivery, and the failure messages. It skips if sops or age are not installed.
