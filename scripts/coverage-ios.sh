#!/usr/bin/env bash
# Runs the DIP app tests (which also exercise the linked Swift packages) with code coverage
# and prints a per-target line-coverage summary. Usage:
#   npm run coverage:ios                       # default Simulator
#   SIMULATOR="iPhone 17" npm run coverage:ios # another installed Simulator
# Requires a generated project (npm run ios:generate) and DEVELOPMENT_TEAM in ui/Config/Local.xcconfig.
set -euo pipefail
cd "$(dirname "$0")/.."
SIMULATOR="${SIMULATOR:-iPhone 18 Pro}"
RESULT="build/coverage/DIP.xcresult"
rm -rf "$RESULT"
mkdir -p build/coverage
xcodebuild test -project ui/DIP.xcodeproj -scheme DIP \
  -destination "platform=iOS Simulator,name=${SIMULATOR}" \
  -enableCodeCoverage YES -resultBundlePath "$RESULT" -quiet
echo
echo "Line coverage by target (key V1 logic: DIP Data/Domain, DIPAccounts, DIPCore):"
xcrun xccov view --report --only-targets "$RESULT"
xcrun xccov view --report "$RESULT" > build/coverage/ios-coverage.txt

# Key V1 app logic: ui/DIP/Domain and ui/DIP/Data, excluding the thin Firebase SDK adapters
# (Firebase*.swift), which are verified by emulator/device runs rather than unit tests.
python3 - build/coverage/ios-coverage.txt <<'PY'
import re, sys
covered = total = 0
for line in open(sys.argv[1]):
    m = re.search(r"(/ui/DIP/(?:Domain|Data)/\S+\.swift)\s+[\d.]+% \((\d+)/(\d+)\)", line)
    if m and not m.group(1).rsplit("/", 1)[-1].startswith("Firebase"):
        covered += int(m.group(2)); total += int(m.group(3))
print(f"\nKey app logic (Domain + Data, excluding Firebase adapters): {100 * covered / max(total, 1):.1f}% ({covered}/{total})")
PY

# DIPAccounts and DIPCore: measure their own package test suites. SwiftPM's build layout
# varies by toolchain, so read the coverage JSON it reports instead of guessing binary paths.
for pkg in DIPAccounts DIPCore; do
  swift test --package-path "ui/Packages/$pkg" --enable-code-coverage >/dev/null
  json="$(swift test --package-path "ui/Packages/$pkg" --show-codecov-path)"
  python3 - "$pkg" "$json" <<'PY'
import json, sys
name, path = sys.argv[1], sys.argv[2]
covered = total = 0
for data in json.load(open(path))["data"]:
    for f in data["files"]:
        # Only this package's own sources (dependencies like generated DIPContracts DTOs excluded).
        if f"/ui/Packages/{name}/Sources/" in f["filename"]:
            covered += f["summary"]["lines"]["covered"]; total += f["summary"]["lines"]["count"]
print(f"{name} package sources: {100 * covered / max(total, 1):.1f}% ({covered}/{total})")
PY
done
echo
echo "Full per-file report: build/coverage/ios-coverage.txt"
