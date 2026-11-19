#!/usr/bin/env bash
# Add an uploaded TestFlight build to tester groups through the App Store Connect API (no Xcode needed).
# Usage: scripts/testflight-distribute.sh --version X.Y.Z [--group "Group name"]... [--list] [--dry-run]
#   --version  marketing version of the build to distribute (the newest processed build of that version is used)
#   --group    beta group name to add the build to (repeatable). Default: every group of the app.
#   --list     only print the app, builds of that version and the beta groups; change nothing
#   --dry-run  print what would be added; change nothing
# Uses the same encrypted App Store Connect key as scripts/testflight.sh --use-secrets (docs/ops/secrets.md). Never prints secrets.
# Flow for a release: bump MARKETING_VERSION in ui/project.yml (0.1.N, new each upload) -> PR -> scripts/testflight.sh --use-secrets
# -> wait ~10-30 min for processing -> this script. Runbook: docs/ops/testflight-universal-links.md ("Cutting a TestFlight build").
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$(mktemp -d "${TMPDIR:-/tmp}/dip-tf-dist.XXXXXX")"
trap 'rm -rf "$out"' EXIT
"$root/scripts/secrets/pull.sh" --only ios >/dev/null
# shellcheck source=secrets/lib.sh
. "$root/scripts/secrets/lib.sh"
resolve_age_key
repo="$SECRETS_CACHE/repo"
while IFS='=' read -r k v; do
  case "$k" in ASC_KEY_ID) ASC_KEY_ID="$v" ;; ASC_ISSUER_ID) ASC_ISSUER_ID="$v" ;; esac
done < <(sops_decrypt "$repo/ios/signing.enc.env" --output-type dotenv)
[ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] || { echo "ios/signing.enc.env must define ASC_KEY_ID and ASC_ISSUER_ID" >&2; exit 1; }
( umask 077; sops_decrypt_blob "$repo/ios/asc-api-key.p8.enc.json" > "$out/key.p8" )
ASC_KEY_ID="$ASC_KEY_ID" ASC_ISSUER_ID="$ASC_ISSUER_ID" ASC_KEY_FILE="$out/key.p8" BUNDLE_ID="${BUNDLE_ID:-work.letsdip.app}" \
  node "$root/scripts/testflight-distribute.mjs" "$@"
