#!/usr/bin/env python3
"""Sync the iOS String Catalogs with the strings the Swift compiler extracted during an Xcode build.

Xcode's IDE updates catalogs as you build; command-line builds (xcodebuild) only emit .stringsdata files. After a
simulator build with SWIFT_EMIT_LOC_STRINGS=YES (set in ui/project.yml), run:

    python3 scripts/ios-i18n-sync.py --derived-data <DerivedData dir of that build>

New keys are added (state "new" for English), removed keys are marked stale, translations are kept. Then translate the
new keys and run `python3 scripts/ios-i18n-check.py`. Needs Xcode (xcrun xcstringstool). See docs/design/ios-i18n.md.
"""
import argparse
import glob
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# catalog path -> build target directory name (Objects-normal lives under <target>.build).
CATALOGS = {
    "ui/DIP/Resources/Localizable.xcstrings": "DIP.build",
    "ui/Packages/DIPCore/Sources/DIPCore/Resources/Localizable.xcstrings": "DIPCore-t.build",
    "ui/Packages/DIPCore/Sources/DIPPresentation/Resources/Localizable.xcstrings": "DIPPresentation-t.build",
    "ui/Packages/DIPCore/Sources/DIPMockData/Resources/Localizable.xcstrings": "DIPMockData-t.build",
    "ui/Packages/DIPAccounts/Sources/DIPAccounts/Resources/Localizable.xcstrings": "DIPAccounts-t.build",
    "ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/Localizable.xcstrings": "DIPDesignSystem-t.build",
}


def stringsdata(derived, target):
    pattern = os.path.join(derived, "Build", "Intermediates.noindex", "**", target, "Objects-normal", "*", "*.stringsdata")
    files = glob.glob(pattern, recursive=True)
    # One architecture is enough (both list the same strings); prefer arm64.
    arm = [f for f in files if "/arm64/" in f]
    return arm or files


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--derived-data", required=True)
    args = parser.parse_args()
    failed = False
    for catalog, target in CATALOGS.items():
        files = stringsdata(args.derived_data, target)
        if not files:
            print(f"skip {catalog}: no .stringsdata for {target} (build with SWIFT_EMIT_LOC_STRINGS=YES first)")
            failed = True
            continue
        result = subprocess.run(["xcrun", "xcstringstool", "sync", os.path.join(ROOT, catalog), "--stringsdata", *files],
                                capture_output=True, text=True)
        print(f"synced {catalog} from {len(files)} files" if result.returncode == 0 else f"FAILED {catalog}: {result.stderr}")
        failed |= result.returncode != 0
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
