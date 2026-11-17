#!/usr/bin/env bash
# Fetch dip-app/secrets, decrypt with sops + age, and materialize the gitignored local files.
# Usage: scripts/secrets/pull.sh [--only ios|backend|admin]... [--force]
#   ios      ui/DIP/Support/GoogleService-Info.plist and ui/Config/Local.xcconfig
#   backend  .secrets-cache/out/functions.env (mode 600), for local use; deploys use sync-gcp.sh
#   admin    apps/admin/.env.local (public web config, optional file)
#   --force  overwrite a local file that differs from the secrets repo (default: refuse)
# Env: SOPS_AGE_KEY (CI) or ~/.config/sops/age/keys.txt; DIP_SECRETS_TOKEN / DIP_SECRETS_DEPLOY_KEY (CI read access);
#      DIP_SECRETS_REPO, DIP_SECRETS_CACHE (override clone source / cache dir, used by tests).
# Plaintext is written only to gitignored paths and never printed. See docs/ops/secrets.md.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"

only=(); FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only) case "${2:-}" in ios|backend|admin) only+=("$2") ;; *) die "--only needs ios, backend or admin" ;; esac; shift ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) die "unknown option $1" ;;
  esac
  shift
done
[ ${#only[@]} -gt 0 ] || only=(ios backend)
want() { local t; for t in "${only[@]}"; do [ "$t" = "$1" ] && return 0; done; return 1; }
export FORCE

require_sops
resolve_age_key
sync_secrets_repo
repo="$SECRETS_CACHE/repo"
umask 077

if want ios; then
  materialize blob "$repo/ios/GoogleService-Info.plist.enc.json" "$SECRETS_TARGET_ROOT/ui/DIP/Support/GoogleService-Info.plist"
  materialize blob "$repo/ios/Local.xcconfig.enc.json" "$SECRETS_TARGET_ROOT/ui/Config/Local.xcconfig"
fi
if want backend; then
  materialize env "$repo/backend/functions.enc.env" "$SECRETS_CACHE/out/functions.env"
fi
if want admin; then
  materialize env "$repo/apps/admin/public.enc.env" "$SECRETS_TARGET_ROOT/apps/admin/.env.local"
fi
echo "Done. Decrypted files are gitignored; do not copy them into commits, chat or logs."
