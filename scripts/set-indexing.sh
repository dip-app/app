#!/usr/bin/env bash
# Switch search-engine indexing of https://letsdip.work on or off (docs/ops/launch-switches.md).
# Edits firebase.json (the X-Robots-Tag header of the `letsdip` site) and apps/landing/robots.txt only.
# It never builds or deploys. Usage: scripts/set-indexing.sh on|off|status
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  on|off|status) exec python3 scripts/launch_config.py indexing "$1" ;;
  *) echo "Usage: scripts/set-indexing.sh on|off|status" >&2; exit 2 ;;
esac
