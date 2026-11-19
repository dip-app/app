#!/bin/sh
# Starts one driver per persona. Usage: PW_CORE_DIR=<node_modules with playwright-core> start-all.sh <scratch-dir> <round> [base]
# Stop them with: for p in 4401 4402 4403 4404 4405 4406; do node drive.mjs $p quit; done
S="$1"; R="$2"; BASE="${3:-http://localhost:3317/admin}"; D="$(cd "$(dirname "$0")" && pwd)"
start() { mkdir -p "$S/$R/$2"; nohup node "$D/server.mjs" --port "$1" --base "$BASE" --out "$S/$R/$2" $3 > "$S/$R/$2/server.log" 2>&1 & }
start 4401 new-hr ""
start 4402 office-mgr ""
start 4403 es-speaker "--locale es-MX"
start 4404 keyboard-sr ""
start 4405 phone-first "--width 390 --height 844"
start 4406 power-user ""
