#!/usr/bin/env bash
# Tests for scripts/secrets/{pull,sync-gcp}.sh with a THROWAWAY age key, fake data and a fake firebase CLI.
# No network, no real secrets, nothing written outside a temp dir. Needs sops and age (brew install sops age).
# Run: bash scripts/tests/test_secrets.sh
set -uo pipefail
here="$(cd "$(dirname "$0")/../secrets" && pwd)"
command -v sops >/dev/null && command -v age-keygen >/dev/null || { echo "SKIP: sops and age are not installed"; exit 0; }

work="$(mktemp -d "${TMPDIR:-/tmp}/dip-secrets-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT
fails=0
ok()   { echo "ok   $1"; }
fail() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else fail "$name"; fi; }

# Throwaway keys: one real recipient, one stranger.
age-keygen -o "$work/key.txt" >/dev/null 2>&1
age-keygen -o "$work/other.txt" >/dev/null 2>&1
pub="$(age-keygen -y "$work/key.txt")"

# Fake secrets repo, encrypted exactly like the documented layout.
sec="$work/secrets-src"
mkdir -p "$sec/backend" "$sec/ios" "$sec/apps/admin"
cat > "$sec/.sops.yaml" <<EOF
creation_rules:
  - path_regex: .*\.enc\.(env|json|yaml)$
    age: $pub
EOF
printf 'OPENAI_API_KEY=fake-openai-VALUE-123\nPOSTMARK_SERVER_TOKEN=fake-postmark-VALUE-456\n' > "$work/functions.env"
printf '\x00\x01binary-plist\xff\n' > "$work/GoogleService-Info.plist"
printf 'GOOGLE_REVERSED_CLIENT_ID = com.googleusercontent.apps.FAKE\n' > "$work/Local.xcconfig"
printf 'NEXT_PUBLIC_FIREBASE_API_KEY=fake-public\n' > "$work/admin.env"
export SOPS_AGE_KEY_FILE="$work/key.txt"
( cd "$sec"
  sops -e --input-type dotenv --output-type dotenv --filename-override backend/functions.enc.env "$work/functions.env" > backend/functions.enc.env
  sops -e --input-type dotenv --output-type dotenv --filename-override apps/admin/public.enc.env "$work/admin.env" > apps/admin/public.enc.env
  sops -e --input-type binary --output-type json --filename-override ios/GoogleService-Info.plist.enc.json "$work/GoogleService-Info.plist" > ios/GoogleService-Info.plist.enc.json
  sops -e --input-type binary --output-type json --filename-override ios/Local.xcconfig.enc.json "$work/Local.xcconfig" > ios/Local.xcconfig.enc.json
  git init -q && git add -A && git -c user.name=t -c user.email=t@example.com commit -q -m fixture )
unset SOPS_AGE_KEY_FILE

# Fake firebase: records argv and stdin per call.
mkdir -p "$work/bin"
cat > "$work/bin/firebase" <<'EOF'
#!/usr/bin/env bash
n="$(ls "$FAKE_FB_LOG" | wc -l | tr -d ' ')"
printf '%s\n' "$@" > "$FAKE_FB_LOG/call$n.argv"
cat > "$FAKE_FB_LOG/call$n.stdin"
EOF
chmod +x "$work/bin/firebase"

target="$work/target"; mkdir -p "$target"
export DIP_SECRETS_REPO="$sec" DIP_SECRETS_CACHE="$work/cache" DIP_SECRETS_TARGET_ROOT="$target"
export HOME="$work/home"; mkdir -p "$HOME"
unset SOPS_AGE_KEY SOPS_AGE_KEY_FILE
run() { env "$@"; }

# 1. Failure messages.
out="$(PATH=/usr/bin:/bin "$here/pull.sh" 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q 'brew install sops age' <<<"$out" && ok "missing sops prints install hint" || fail "missing sops prints install hint"
out="$("$here/pull.sh" 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q 'no age private key found' <<<"$out" && ok "missing key fails clearly" || fail "missing key fails clearly"
out="$(SOPS_AGE_KEY_FILE="$work/other.txt" "$here/pull.sh" 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q 'could not decrypt' <<<"$out" && [ ! -e "$target/ui/Config/Local.xcconfig" ] && ok "wrong key fails and writes nothing" || fail "wrong key fails and writes nothing"

# 2. Decrypt and materialize (key via file, then via env).
out="$(SOPS_AGE_KEY_FILE="$work/key.txt" "$here/pull.sh" --only ios --only backend 2>&1)"; rc=$?
[ $rc -eq 0 ] && ok "pull succeeds with key file" || { fail "pull succeeds with key file"; echo "$out"; }
check "plist round-trips byte for byte" cmp "$work/GoogleService-Info.plist" "$target/ui/DIP/Support/GoogleService-Info.plist"
check "xcconfig round-trips" cmp "$work/Local.xcconfig" "$target/ui/Config/Local.xcconfig"
check "backend env materialized" grep -q 'OPENAI_API_KEY=fake-openai-VALUE-123' "$work/cache/out/functions.env"
[ "$(stat -f %Lp "$target/ui/Config/Local.xcconfig" 2>/dev/null || stat -c %a "$target/ui/Config/Local.xcconfig")" = 600 ] && ok "files are mode 600" || fail "files are mode 600"
grep -q 'fake-openai-VALUE' <<<"$out" && fail "pull output leaks values" || ok "pull output leaks no values"
out="$(SOPS_AGE_KEY="$(cat "$work/key.txt")" "$here/pull.sh" --only ios 2>&1)"
grep -q 'unchanged' <<<"$out" && ok "re-pull via SOPS_AGE_KEY is idempotent" || fail "re-pull via SOPS_AGE_KEY is idempotent"
echo 'GOOGLE_REVERSED_CLIENT_ID = local-edit' > "$target/ui/Config/Local.xcconfig"
out="$(SOPS_AGE_KEY_FILE="$work/key.txt" "$here/pull.sh" --only ios 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q -- '--force' <<<"$out" && grep -q local-edit "$target/ui/Config/Local.xcconfig" && ok "differing local file is protected" || fail "differing local file is protected"
SOPS_AGE_KEY_FILE="$work/key.txt" "$here/pull.sh" --only ios --force >/dev/null 2>&1
check "--force overwrites" cmp "$work/Local.xcconfig" "$target/ui/Config/Local.xcconfig"
out="$(SOPS_AGE_KEY_FILE="$work/key.txt" "$here/pull.sh" --only admin 2>&1)"
check "admin env materialized" grep -q 'NEXT_PUBLIC_FIREBASE_API_KEY=fake-public' "$target/apps/admin/.env.local"
rm -rf "$sec/ios/Local.xcconfig.enc.json"; ( cd "$sec" && git add -A && git -c user.name=t -c user.email=t@example.com commit -q -m rm )
out="$(SOPS_AGE_KEY_FILE="$work/key.txt" "$here/pull.sh" --only ios --force 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q 'missing encrypted file' <<<"$out" && ok "missing file in repo is named" || fail "missing file in repo is named"

# 3. sync-gcp.
export SOPS_AGE_KEY_FILE="$work/key.txt"
out="$(PATH="$work/bin:$PATH" "$here/sync-gcp.sh" --dry-run 2>&1)"; rc=$?
[ $rc -eq 0 ] && grep -q 'would set  OPENAI_API_KEY' <<<"$out" && grep -q 'would set  POSTMARK_SERVER_TOKEN' <<<"$out" && ok "dry-run lists names" || { fail "dry-run lists names"; echo "$out"; }
grep -q 'VALUE' <<<"$out" && fail "dry-run leaks values" || ok "dry-run prints no values"
export FAKE_FB_LOG="$work/fb"; mkdir -p "$FAKE_FB_LOG"
out="$(PATH="$work/bin:$PATH" "$here/sync-gcp.sh" --project demo-test 2>&1)"; rc=$?
[ $rc -eq 0 ] && [ "$(ls "$FAKE_FB_LOG" | grep -c argv)" = 2 ] && ok "sync calls firebase once per secret" || { fail "sync calls firebase once per secret"; echo "$out"; }
grep -rq 'VALUE' "$FAKE_FB_LOG"/*.argv && fail "value appeared in argv" || ok "values never in argv"
[ "$(cat "$FAKE_FB_LOG/call0.stdin")" = "fake-openai-VALUE-123" ] && ok "value delivered on stdin" || fail "value delivered on stdin"
grep -q -- '--data-file' "$FAKE_FB_LOG/call0.argv" && grep -q demo-test "$FAKE_FB_LOG/call0.argv" && ok "uses --data-file - and --project" || fail "uses --data-file - and --project"
grep -q 'VALUE' <<<"$out" && fail "sync output leaks values" || ok "sync output leaks no values"
out="$(PATH="$work/bin:$PATH" "$here/sync-gcp.sh" --dry-run --only NOPE 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q 'not in functions.enc.env' <<<"$out" && ok "unknown --only is rejected" || fail "unknown --only is rejected"

# 4. Invalid secret name.
printf 'bad-name=x\n' > "$work/bad.env"
( cd "$sec" && sops -e --input-type dotenv --output-type dotenv --filename-override backend/functions.enc.env "$work/bad.env" > backend/functions.enc.env && git add -A && git -c user.name=t -c user.email=t@example.com commit -q -m bad )
out="$(PATH="$work/bin:$PATH" "$here/sync-gcp.sh" --dry-run 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q 'invalid secret name' <<<"$out" && ok "invalid name rejected" || fail "invalid name rejected"

# 5. Placeholder recipient is refused.
sed -i.bak "s/age: .*/age: REPLACE_WITH_PUBLIC_AGE_KEY/" "$sec/.sops.yaml"; rm -f "$sec/.sops.yaml.bak"
( cd "$sec" && git add -A && git -c user.name=t -c user.email=t@example.com commit -q -m placeholder )
out="$("$here/pull.sh" --only backend 2>&1)"; rc=$?
[ $rc -ne 0 ] && grep -q 'placeholder recipient' <<<"$out" && ok "placeholder recipient is refused" || fail "placeholder recipient is refused"

echo
[ "$fails" = 0 ] && echo "All secrets tests passed" || { echo "$fails failed"; exit 1; }
