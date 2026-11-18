"""Unit tests for scripts/ios-i18n-check.py (docs/design/ios-i18n.md), plus a run against the committed catalogs."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("ios_i18n_check", ROOT / "scripts" / "ios-i18n-check.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def unit(value, state="translated"):
    return {"stringUnit": {"state": state, "value": value}}


def plural(one, other, state="translated"):
    return {"variations": {"plural": {"one": unit(one, state), "other": unit(other, state)}}}


def run(strings):
    errors = []
    check.check_catalog("test.xcstrings", {"sourceLanguage": "en", "strings": strings}, errors)
    return errors


class Specifiers(unittest.TestCase):
    def test_positional_and_implicit_match(self):
        self.assertEqual(check.specifiers("%@ invited %lld"), check.specifiers("%2$lld invitados por %1$@"))

    def test_type_and_count_differ(self):
        self.assertNotEqual(check.specifiers("%lld photos"), check.specifiers("%@ fotos"))
        self.assertNotEqual(check.specifiers("%@ and %@"), check.specifiers("%@"))

    def test_plural_token_ignored(self):
        self.assertEqual(check.specifiers("%#@count@"), [])


class Catalog(unittest.TestCase):
    def test_complete_entry_passes(self):
        self.assertEqual(run({"Join": {"localizations": {"es": unit("Unirme"), "tlh": unit("yImuv", "needs_review")}}}), [])

    def test_missing_shipped_translation_fails(self):
        self.assertTrue(any("missing es" in e for e in run({"Join": {}})))

    def test_demo_locale_is_optional(self):
        self.assertEqual(run({"Join": {"localizations": {"es": unit("Unirme")}}}), [])

    def test_new_state_fails(self):
        self.assertTrue(any("state" in e for e in run({"Join": {"localizations": {"es": unit("Unirme", "new")}}})))

    def test_specifier_mismatch_fails_in_any_language(self):
        entry = {"localizations": {"en": unit("%lld going"), "es": unit("%lld van"), "tlh": unit("%@ jaH")}}
        errors = run({"x.going": entry})
        self.assertEqual(len(errors), 1)
        self.assertIn("[tlh]", errors[0])

    def test_plural_needs_one_and_other(self):
        entry = {"localizations": {"en": plural("%lld photo", "%lld photos"), "es": {"variations": {"plural": {"other": unit("%lld fotos")}}}}}
        self.assertTrue(any("'one' and 'other'" in e for e in run({"album.count": entry})))
        entry["localizations"]["es"] = plural("%lld foto", "%lld fotos")
        self.assertEqual(run({"album.count": entry}), [])

    def test_stale_fails(self):
        self.assertTrue(any("stale" in e for e in run({"Old": {"extractionState": "stale"}})))

    def test_should_not_translate_is_skipped(self):
        self.assertEqual(run({"%@ · %@": {"shouldTranslate": False}}), [])


class CommittedCatalogs(unittest.TestCase):
    def test_repository_catalogs_pass(self):
        self.assertEqual(check.main([]), 0)


if __name__ == "__main__":
    unittest.main()
