#!/usr/bin/env bash
# Shared helpers for scripts/secrets/*. Source this file; do not run it.
# Model and owner steps: docs/ops/secrets.md. Never echo a decrypted value from here.

SECRETS_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECRETS_TARGET_ROOT="${DIP_SECRETS_TARGET_ROOT:-$SECRETS_REPO_ROOT}"  # where pull.sh writes ui/ and apps/ files (tests override)
SECRETS_REMOTE="${DIP_SECRETS_REPO:-https://github.com/dip-app/secrets.git}"
SECRETS_CACHE="${DIP_SECRETS_CACHE:-$SECRETS_REPO_ROOT/.secrets-cache}"

die() { echo "error: $*" >&2; exit 1; }

require_sops() {
  command -v sops >/dev/null 2>&1 || die "sops is not installed. Install it with: brew install sops age (macOS) or see https://github.com/getsops/sops/releases"
}

# Picks the age private key: SOPS_AGE_KEY (env, used in CI) wins, then SOPS_AGE_KEY_FILE, then
# ~/.config/sops/age/keys.txt. Exports SOPS_AGE_KEY_FILE for the file case (sops on macOS would
# otherwise look in ~/Library/Application Support). Never prints key material.
resolve_age_key() {
  if [ -n "${SOPS_AGE_KEY:-}" ]; then return 0; fi
  if [ -n "${SOPS_AGE_KEY_FILE:-}" ]; then
    [ -r "$SOPS_AGE_KEY_FILE" ] || die "SOPS_AGE_KEY_FILE is set but not readable: $SOPS_AGE_KEY_FILE"
    return 0
  fi
  if [ -r "$HOME/.config/sops/age/keys.txt" ]; then
    export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"
    return 0
  fi
  die "no age private key found. Set SOPS_AGE_KEY (CI) or put the key in ~/.config/sops/age/keys.txt (get it from the password manager; first time: brew install age && age-keygen, see docs/ops/secrets.md)."
}

# sops_decrypt <file> [extra sops args]: plaintext to stdout. Errors from sops are shown (they never contain values).
sops_decrypt() {
  local file="$1"; shift
  [ -f "$file" ] || die "missing encrypted file in the secrets repo: ${file#"$SECRETS_CACHE"/repo/} (see docs/ops/secrets.md, section 'Layout')"
  sops --decrypt "$@" "$file" || die "sops could not decrypt ${file#"$SECRETS_CACHE"/repo/}. Is your age key one of the recipients in dip-app/secrets .sops.yaml? Ask the owner to run 'sops updatekeys'."
}

# Binary blob stored as <name>.enc.json (sops --input-type binary --output-type json).
sops_decrypt_blob() { sops_decrypt "$1" --input-type json --output-type binary; }

# materialize <blob|env> <encrypted file> <dest>: decrypt fully first, so a failed decrypt never leaves an empty file.
materialize() {
  local kind="$1" src="$2" dest="$3" tmp
  tmp="$(mktemp "$SECRETS_CACHE/.dec.XXXXXX")"
  if [ "$kind" = blob ]; then sops_decrypt_blob "$src" > "$tmp" || { rm -f "$tmp"; exit 1; }
  else sops_decrypt "$src" --output-type dotenv > "$tmp" || { rm -f "$tmp"; exit 1; }; fi
  write_secret_file "$dest" < "$tmp" || { rm -f "$tmp"; exit 1; }
  rm -f "$tmp"
}

# Writes stdin to $1 with mode 600, atomically. Refuses to replace a different existing file unless
# FORCE=1, so local overrides (for example a hand-edited Local.xcconfig) are not lost silently.
write_secret_file() {
  local dest="$1" tmp
  mkdir -p "$(dirname "$dest")"
  tmp="$(mktemp "$(dirname "$dest")/.secret.XXXXXX")"
  chmod 600 "$tmp"
  cat > "$tmp"
  if [ -e "$dest" ] && cmp -s "$tmp" "$dest"; then rm -f "$tmp"; echo "unchanged  ${dest#"$SECRETS_TARGET_ROOT"/}"; return 0; fi
  if [ -e "$dest" ] && [ "${FORCE:-0}" != 1 ]; then
    rm -f "$tmp"
    die "${dest#"$SECRETS_TARGET_ROOT"/} exists and differs from the secrets repo. Re-run with --force to overwrite it."
  fi
  mv -f "$tmp" "$dest"
  echo "wrote      ${dest#"$SECRETS_TARGET_ROOT"/}"
}

# Clone or fast-forward the encrypted repo into $SECRETS_CACHE/repo. Auth, in order:
#   DIP_SECRETS_DEPLOY_KEY  private key text of a read-only deploy key (CI, SSH url)
#   DIP_SECRETS_TOKEN       read-only token (CI, HTTPS url), passed to git via env, not argv
#   local gh login          'gh auth token' (developer machines)
#   otherwise               whatever git credentials are already configured
sync_secrets_repo() {
  command -v git >/dev/null 2>&1 || die "git is required"
  mkdir -p "$SECRETS_CACHE"; chmod 700 "$SECRETS_CACHE"
  local repo="$SECRETS_CACHE/repo" remote="$SECRETS_REMOTE" token="${DIP_SECRETS_TOKEN:-}" keyfile=""
  if [ -n "${DIP_SECRETS_DEPLOY_KEY:-}" ]; then
    keyfile="$(mktemp "$SECRETS_CACHE/.deploykey.XXXXXX")"; chmod 600 "$keyfile"
    printf '%s\n' "$DIP_SECRETS_DEPLOY_KEY" > "$keyfile"
    trap 'rm -f "$keyfile"' RETURN
    export GIT_SSH_COMMAND="ssh -i $keyfile -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
    case "$remote" in https://github.com/*) remote="git@github.com:${remote#https://github.com/}" ;; esac
  elif [ -z "$token" ] && [[ "$remote" == https://* ]] && command -v gh >/dev/null 2>&1; then
    token="$(gh auth token 2>/dev/null || true)"
  fi
  if [ -n "$token" ] && [[ "$remote" == https://* ]]; then
    local b64; b64="$(printf 'x-access-token:%s' "$token" | base64 | tr -d '\n')"
    export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="http.extraheader" GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $b64"
  fi
  export GIT_TERMINAL_PROMPT=0
  if [ -d "$repo/.git" ]; then
    git -C "$repo" remote set-url origin "$remote"
    git -C "$repo" fetch --quiet --depth 1 origin || die "could not fetch the secrets repo (access? 'gh auth status', or DIP_SECRETS_TOKEN / DIP_SECRETS_DEPLOY_KEY in CI)"
    git -C "$repo" reset --quiet --hard FETCH_HEAD
  else
    rm -rf "$repo"
    git clone --quiet --depth 1 "$remote" "$repo" || die "could not clone the secrets repo (access? 'gh auth status', or DIP_SECRETS_TOKEN / DIP_SECRETS_DEPLOY_KEY in CI)"
  fi
  unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0
  if grep -q 'REPLACE_WITH_PUBLIC_AGE_KEY' "$repo/.sops.yaml" 2>/dev/null; then
    die "dip-app/secrets .sops.yaml still has the placeholder recipient. Complete the owner steps in docs/ops/secrets.md first."
  fi
}
