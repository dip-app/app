#!/usr/bin/env bash
# Archive the DIP app in Release and upload it to App Store Connect (TestFlight).
# Usage: scripts/testflight.sh [--dry-run] [--version X.Y.Z] [--use-secrets]
#   --dry-run      archive only, do not upload
#   --version      override MARKETING_VERSION for this archive (default: project.yml)
#   --use-secrets  fetch GoogleService-Info.plist, Local.xcconfig and an App Store Connect API key from the encrypted
#                  dip-app/secrets repo (scripts/secrets/pull.sh, docs/ops/secrets.md) and sign headlessly through the
#                  API key (cloud-managed signing) instead of the Xcode account. Default mode is unchanged.
# Needs: release (not beta) Xcode selected, signed in to the paid team in Xcode (Settings > Accounts),
# xcodegen, and ui/DIP/Support/GoogleService-Info.plist + ui/Config/Local.xcconfig (both gitignored, see ui/README.md).
# The build number is assigned by App Store Connect on upload (manageAppVersionAndBuildNumber).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/ui"

dry=0; version=""; use_secrets=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --version) version="${2:?--version needs a value}"; shift ;;
    --use-secrets) use_secrets=1 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

auth=()
out="$(mktemp -d "${TMPDIR:-/tmp}/dip-testflight.XXXXXX")"
trap 'rm -rf "$out"' EXIT
if [ "$use_secrets" = 1 ]; then
  "$root/scripts/secrets/pull.sh" --only ios
  # shellcheck source=../scripts/secrets/lib.sh
  . "$root/scripts/secrets/lib.sh"
  resolve_age_key
  repo="$SECRETS_CACHE/repo"
  while IFS='=' read -r k v; do
    case "$k" in ASC_KEY_ID) ASC_KEY_ID="$v" ;; ASC_ISSUER_ID) ASC_ISSUER_ID="$v" ;; esac
  done < <(sops_decrypt "$repo/ios/signing.enc.env" --output-type dotenv)
  [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] || { echo "ios/signing.enc.env must define ASC_KEY_ID and ASC_ISSUER_ID" >&2; exit 1; }
  ( umask 077; sops_decrypt_blob "$repo/ios/asc-api-key.p8.enc.json" > "$out/AuthKey_${ASC_KEY_ID}.p8" )
  auth=(-authenticationKeyPath "$out/AuthKey_${ASC_KEY_ID}.p8" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

xcodebuild -version | grep -qi beta && { echo "Selected Xcode is a beta; App Store Connect rejects it. Use xcode-select to pick a release Xcode." >&2; exit 1; }
[ -f DIP/Support/GoogleService-Info.plist ] || { echo "Missing ui/DIP/Support/GoogleService-Info.plist" >&2; exit 1; }
grep -q 'BUNDLE_ID' DIP/Support/GoogleService-Info.plist && plutil -p DIP/Support/GoogleService-Info.plist | grep -q '"BUNDLE_ID" => "work.letsdip.app"' \
  || { echo "GoogleService-Info.plist is not for work.letsdip.app" >&2; exit 1; }
[ -f Config/Local.xcconfig ] && grep -q GOOGLE_REVERSED_CLIENT_ID Config/Local.xcconfig \
  || { echo "ui/Config/Local.xcconfig must set GOOGLE_REVERSED_CLIENT_ID (see ui/README.md)" >&2; exit 1; }
if [ -n "$(git status --porcelain -- . ../apps ../gcp 2>/dev/null)" ]; then
  echo "warning: uncommitted changes will be in this build" >&2
fi

xcodegen generate -q
extra=(); [ -n "$version" ] && extra+=("MARKETING_VERSION=$version")
echo "Archiving (Release)…"
xcodebuild archive -project DIP.xcodeproj -scheme DIP -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$out/DIP.xcarchive" -allowProvisioningUpdates ${auth[@]+"${auth[@]}"} ${extra[@]+"${extra[@]}"} \
  > "$out/archive.log" 2>&1 || { tail -30 "$out/archive.log"; exit 1; }
# Guard: a Local.xcconfig that overrides DIP_ENTITLEMENTS can drop App Attest, push or Associated Domains.
# Without App Attest the app cannot get an App Check token, so sign-in and every callable fail in production.
app="$(ls -d "$out"/DIP.xcarchive/Products/Applications/*.app | head -1)"
ents="$(codesign -d --entitlements :- "$app" 2>/dev/null | plutil -p - 2>/dev/null || true)"
for key in com.apple.developer.devicecheck.appattest-environment aps-environment com.apple.developer.associated-domains; do
  echo "$ents" | grep -q "$key" || { echo "Archive is missing the $key entitlement. Check DIP_ENTITLEMENTS in ui/Config/Local.xcconfig (default is Config/DIP-Paid-Push.entitlements); remove any override." >&2; exit 1; }
done
echo "$ents" | grep -q '"com.apple.developer.devicecheck.appattest-environment" => "production"' || { echo "App Attest environment is not production." >&2; exit 1; }
if [ "$dry" = 1 ]; then echo "Dry run OK: archive built, nothing uploaded."; exit 0; fi
echo "Uploading to App Store Connect…"
xcodebuild -exportArchive -archivePath "$out/DIP.xcarchive" -exportOptionsPlist Config/ExportOptions-TestFlight.plist \
  -exportPath "$out/export" -allowProvisioningUpdates ${auth[@]+"${auth[@]}"} > "$out/export.log" 2>&1 || { tail -30 "$out/export.log"; exit 1; }
echo "Uploaded. Processing in App Store Connect takes ~10-30 minutes; then it appears in TestFlight."
