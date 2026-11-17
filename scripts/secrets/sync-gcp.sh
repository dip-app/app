#!/usr/bin/env bash
# Push the Firebase Functions secrets from dip-app/secrets (backend/functions.enc.env) into Secret Manager.
# Usage: scripts/secrets/sync-gcp.sh [--dry-run] [--project ID] [--only NAME]...
#   --dry-run   list the secret names that would be set; nothing is printed except names, nothing is written
#   --project   Firebase project (default team05-dip)
#   --only      limit to these names (repeatable)
# Values go to 'firebase functions:secrets:set NAME --data-file -' on stdin: never in argv, logs or shell history.
# Each set creates a new secret version; redeploy the functions that bind it afterwards (docs/ops/secrets.md).
# Needs: a firebase login with Secret Manager access (or GOOGLE_APPLICATION_CREDENTIALS in CI), plus the pull.sh prerequisites.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

dry=0; project="team05-dip"; only=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --project) project="${2:?--project needs a value}"; shift ;;
    --only) only+=("${2:?--only needs a name}"); shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "unknown option $1" ;;
  esac
  shift
done

require_sops
command -v python3 >/dev/null 2>&1 || die "python3 is required"
[ "$dry" = 1 ] || command -v firebase >/dev/null 2>&1 || die "firebase CLI is required (npm i -g firebase-tools)"
resolve_age_key
sync_secrets_repo
file="$SECRETS_CACHE/repo/backend/functions.enc.env"
[ -f "$file" ] || die "missing backend/functions.enc.env in the secrets repo"

# Decrypt to JSON in memory; the python child gets values only via a pipe and hands them to firebase on stdin.
sops_decrypt "$file" --output-type json | DRY="$dry" PROJECT="$project" ONLY="$(IFS=,; echo "${only[*]-}")" python3 -I -c '
import json, os, re, subprocess, sys
data = json.load(sys.stdin)
dry = os.environ["DRY"] == "1"
only = [n for n in os.environ["ONLY"].split(",") if n]
names = sorted(k for k in data if not k.startswith("sops"))
bad = [n for n in names if not re.fullmatch(r"[A-Z][A-Z0-9_]*", n)]
if bad:
    sys.exit("error: invalid secret name(s): " + ", ".join(bad) + " (use UPPER_SNAKE_CASE)")
missing = [n for n in only if n not in names]
if missing:
    sys.exit("error: not in functions.enc.env: " + ", ".join(missing))
if only:
    names = [n for n in names if n in only]
empty = [n for n in names if not str(data[n])]
if empty:
    sys.exit("error: empty value for: " + ", ".join(empty))
if not names:
    sys.exit("error: no secrets found")
for n in names:
    if dry:
        print("would set  " + n)
        continue
    r = subprocess.run(["firebase", "functions:secrets:set", n, "--project", os.environ["PROJECT"],
                        "--data-file", "-", "--non-interactive"],
                       input=str(data[n]).encode(), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if r.returncode != 0:
        sys.exit("error: firebase failed for " + n + ": " + r.stderr.decode(errors="replace").strip()[:300])
    print("set        " + n)
print(("Dry run: " if dry else "") + str(len(names)) + " secret(s)" + ("" if dry else " synced to " + os.environ["PROJECT"] + ". Redeploy functions that bind them."))
'
