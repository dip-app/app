#!/usr/bin/env python3
"""Guardrails for the iOS String Catalogs (docs/design/ios-i18n.md). Pure Python, no Xcode needed.

Fails on:
  1. a translatable key with no translation (or state "new") in a shipped language (SHIPPED, currently es),
     or a plural source whose translation lacks the "one"/"other" forms;
  2. stale keys (extractionState "stale": removed from the code, still in the catalog) and semantic keys used in
     Swift (`String(localized: "area.key"`) that are missing from the target's catalog, or present in the catalog but
     used nowhere (unused);
  3. format-specifier mismatches between the English source and ANY translation (shipped or demo, e.g. tlh);
  4. likely unlocalized UI strings introduced in Swift: package code that looks strings up in the app bundle (no
     `bundle: .module`), and capitalized English literals passed to UI parameters as plain Strings. Existing
     exceptions live in scripts/ios-i18n-allowlist.txt (regenerate it with --update-allowlist after review).

Demo locales (DEMO, currently tlh) are checked for specifier parity only; missing strings fall back to English.
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHIPPED = ["es"]
DEMO = ["tlh"]
ALLOWLIST = os.path.join(ROOT, "scripts", "ios-i18n-allowlist.txt")

# catalog -> (source directories, is a Swift package target)
TARGETS = {
    "ui/DIP/Resources/Localizable.xcstrings": (["ui/DIP"], False),
    "ui/Packages/DIPCore/Sources/DIPCore/Resources/Localizable.xcstrings": (["ui/Packages/DIPCore/Sources/DIPCore"], True),
    "ui/Packages/DIPCore/Sources/DIPPresentation/Resources/Localizable.xcstrings": (["ui/Packages/DIPCore/Sources/DIPPresentation"], True),
    "ui/Packages/DIPAccounts/Sources/DIPAccounts/Resources/Localizable.xcstrings": (["ui/Packages/DIPAccounts/Sources/DIPAccounts"], True),
    "ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/Localizable.xcstrings": (["ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem"], True),
}
INFOPLIST = "ui/DIP/Resources/InfoPlist.xcstrings"
SPEC = re.compile(r"%(?:(\d+)\$)?(?:#@\w+@|ll[du]|l[du]|[dufgeis@])")
SEMANTIC_KEY = re.compile(r"^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$")


def specifiers(text):
    """Sorted (index, type) pairs; implicit indexes are assigned in order. Plural tokens (%#@x@) are ignored."""
    out, implicit = [], 0
    for match in SPEC.finditer(text):
        token = match.group(0)
        if "#@" in token:
            continue
        implicit += 1
        index = int(match.group(1)) if match.group(1) else implicit
        kind = token[-1] if token[-1] != "u" else "d"
        out.append((index, {"d": "int", "i": "int", "@": "obj", "f": "float", "g": "float", "e": "float", "s": "cstr"}[kind]))
    return sorted(out)


def forms(localization):
    """{form: text} for a localization: a plain string ({"": text}) or plural variations (top level or substitution)."""
    if not localization:
        return {}
    if "variations" in localization:
        return {k: v["stringUnit"]["value"] for k, v in localization["variations"].get("plural", {}).items()}
    if "substitutions" in localization:
        result = {}
        for sub in localization["substitutions"].values():
            for k, v in sub["variations"].get("plural", {}).items():
                result[k] = v["stringUnit"]["value"]
        return result
    return {"": localization["stringUnit"]["value"]}


def states(localization):
    if "stringUnit" in localization and "substitutions" not in localization:
        return [localization["stringUnit"].get("state")]
    found = []
    def walk(node):
        if isinstance(node, dict):
            if "stringUnit" in node:
                found.append(node["stringUnit"].get("state"))
            for value in node.values():
                walk(value)
    walk(localization.get("variations", localization.get("substitutions", {})))
    return found


def check_catalog(path, data, errors):
    for key, entry in sorted(data.get("strings", {}).items()):
        where = f"{path}: {key!r}"
        if entry.get("extractionState") == "stale":
            errors.append(f"{where}: stale (no longer in the code); delete it or restore its use")
            continue
        locs = entry.get("localizations", {})
        source = forms(locs.get("en")) or {"": key}
        is_plural = "" not in source
        reference = specifiers(source.get("other", source.get("")) or "")
        for lang, loc in locs.items():
            if lang == "en":
                continue
            translated = forms(loc)
            for form, text in translated.items():
                got = specifiers(text)
                if form in ("", "other") and got != reference:
                    errors.append(f"{where} [{lang}{'/' + form if form else ''}]: specifiers {got} != English {reference}")
                elif form not in ("", "other") and not set(got) <= set(reference):
                    errors.append(f"{where} [{lang}/{form}]: specifiers {got} not in English {reference}")
        if entry.get("shouldTranslate") is False:
            continue
        for lang in SHIPPED:
            loc = locs.get(lang)
            if not loc:
                errors.append(f"{where}: missing {lang} translation")
                continue
            if any(state not in ("translated", "needs_review") for state in states(loc)):
                errors.append(f"{where}: {lang} state is not translated/needs_review")
            translated = forms(loc)
            if is_plural and not {"one", "other"} <= set(translated):
                errors.append(f"{where}: {lang} plural needs 'one' and 'other' forms")


def swift_files(directories):
    for directory in directories:
        for base, dirs, files in os.walk(os.path.join(ROOT, directory)):
            dirs[:] = [d for d in dirs if d not in ("Tests", ".build")]
            for name in files:
                if name.endswith(".swift"):
                    yield os.path.join(base, name)


LOCALIZED_CALL = re.compile(r'(?:String\(\s*localized:|LocalizedStringResource\()\s*"((?:[^"\\]|\\.)*)"')
# Package code: SwiftUI literal lookups that default to the APP bundle unless `bundle:` is passed.
PACKAGE_MAIN_BUNDLE = [
    (re.compile(r'\bText\("(?:[^"\\]|\\.)*"\s*\)'), "Text(\"...\") in a package needs bundle: .module"),
    (re.compile(r'\.accessibility(?:Label|Hint|Value)\("'), "accessibility literal in a package looks in the app bundle; use Text(\"...\", bundle: .module)"),
    (re.compile(r'\b(?:Button|Label|Toggle|Section|navigationTitle)\("[A-Z]'), "SwiftUI literal in a package looks in the app bundle"),
    (re.compile(r'String\(localized:(?![^\n]*bundle: \.module)'), "String(localized:) in a package needs bundle: .module"),
]
# Plain-String UI parameters given an English literal (renders verbatim, never translated).
UNLOCALIZED_PARAM = re.compile(r'\b(title|message|subtitle|actionTitle|retryTitle|label|placeholder|prompt|text|caption|hint|body|detail)\s*:\s*"([A-Z][^"]*[a-z][^"]*)"')
UNLOCALIZED_RETURN = re.compile(r'(?:return|\?|:)\s*"([A-Z][a-z]+(?: [A-Za-z’\']+)+[.!?]?)"')


def scan_sources(errors, findings):
    used = {}
    for catalog, (directories, is_package) in TARGETS.items():
        keys = used.setdefault(catalog, set())
        for path in swift_files(directories):
            rel = os.path.relpath(path, ROOT)
            source = open(path, encoding="utf-8").read()
            keys.update(match.group(1) for match in LOCALIZED_CALL.finditer(source))
            in_preview = False
            in_debug = 0
            for line in source.splitlines():
                stripped = line.strip()
                if stripped.startswith("#Preview"):
                    in_preview = True
                if stripped.startswith("#if DEBUG"):
                    in_debug += 1
                elif stripped.startswith("#endif") and in_debug:
                    in_debug -= 1
                if in_preview or in_debug or stripped.startswith("//") or stripped.startswith("///"):
                    continue
                code = re.sub(r'(String\(localized:|LocalizedStringResource\(|comment:|defaultValue:)\s*"(?:[^"\\]|\\.)*"', "", line)
                if is_package:
                    for pattern, why in PACKAGE_MAIN_BUNDLE:
                        if pattern.search(line) and "bundle: .module" not in line:
                            findings.append((rel, stripped, why))
                for match in UNLOCALIZED_PARAM.finditer(code):
                    if "accessibilityIdentifier" in code or "Logger" in code:
                        continue
                    findings.append((rel, stripped, f'plain String "{match.group(2)}" for {match.group(1)}: is it shown? use String(localized:)'))
    return used


def check_keys(catalogs, used, errors):
    for catalog, data in catalogs.items():
        if catalog == INFOPLIST:
            continue
        keys = set(data.get("strings", {}))
        for key in sorted(used.get(catalog, set())):
            if SEMANTIC_KEY.match(key) and key not in keys:
                errors.append(f"{catalog}: key {key!r} is used in Swift but missing from the catalog (run scripts/ios-i18n-sync.py after a build)")
        for key in sorted(keys):
            if SEMANTIC_KEY.match(key) and key not in used.get(catalog, set()):
                errors.append(f"{catalog}: key {key!r} is not used in Swift (unused); remove it")


def load_allowlist():
    if not os.path.exists(ALLOWLIST):
        return set()
    return {line.rstrip("\n") for line in open(ALLOWLIST, encoding="utf-8") if line.strip() and not line.startswith("#")}


def finding_id(finding):
    rel, line, _ = finding
    return f"{rel}\t{line}"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--update-allowlist", action="store_true", help="accept the current source findings as reviewed")
    args = parser.parse_args(argv)
    errors, findings = [], []
    catalogs = {}
    for catalog in list(TARGETS) + [INFOPLIST]:
        try:
            data = json.load(open(os.path.join(ROOT, catalog), encoding="utf-8"))
        except (OSError, ValueError) as error:
            errors.append(f"{catalog}: cannot read ({error})")
            continue
        if data.get("sourceLanguage") != "en":
            errors.append(f"{catalog}: sourceLanguage must be en")
        catalogs[catalog] = data
        check_catalog(catalog, data, errors)
    used = scan_sources(errors, findings)
    check_keys(catalogs, used, errors)
    if args.update_allowlist:
        with open(ALLOWLIST, "w", encoding="utf-8") as handle:
            handle.write("# Reviewed exceptions for scripts/ios-i18n-check.py (file<TAB>trimmed line). Not user-facing or intentionally verbatim.\n")
            for item in sorted({finding_id(f) for f in findings}):
                handle.write(item + "\n")
        print(f"allowlist updated with {len({finding_id(f) for f in findings})} entries")
    else:
        allowed = load_allowlist()
        for finding in findings:
            if finding_id(finding) not in allowed:
                errors.append(f"{finding[0]}: {finding[2]}\n    {finding[1]}")
    if errors:
        print("\n".join(errors))
        print(f"\nios-i18n-check: {len(errors)} problem(s). See docs/design/ios-i18n.md.")
        return 1
    total = sum(len(d.get("strings", {})) for d in catalogs.values())
    print(f"ios-i18n-check: OK ({total} keys in {len(catalogs)} catalogs; shipped {', '.join(SHIPPED)}; demo {', '.join(DEMO)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
