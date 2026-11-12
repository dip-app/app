"""Pure-helper tests for the launch switches (docs/ops/launch-switches.md). No network, no deploy, no file writes."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import launch_config as lc  # noqa: E402

CONFIG = json.loads((ROOT / "firebase.json").read_text())
LANDING = (ROOT / "apps/landing/index.html").read_text()


class AppStoreConfig(unittest.TestCase):
    def test_committed_launch_ts_is_parseable_and_empty(self):
        self.assertEqual(lc.read_launch_config(lc.LAUNCH_TS.read_text()), ("", False))

    def test_parse_values_and_reject_bad_ones(self):
        ts = 'export const APP_STORE_ID = "1234567890";\nexport const USE_OFFICIAL_APP_STORE_BADGE = true;\n'
        self.assertEqual(lc.read_launch_config(ts), ("1234567890", True))
        with self.assertRaises(ValueError):
            lc.read_launch_config('export const APP_STORE_ID = "id123";\nexport const USE_OFFICIAL_APP_STORE_BADGE = false;')
        with self.assertRaises(ValueError):
            lc.read_launch_config("export const OTHER = 1;")

    def test_empty_id_leaves_landing_untouched(self):
        self.assertEqual(lc.render_landing(LANDING, "", True, True), LANDING)

    def test_id_points_the_pill_at_the_listing(self):
        html = lc.render_landing(LANDING, "1234567890")
        self.assertIn('href="https://apps.apple.com/app/id1234567890"', html)
        self.assertNotIn('id="open-app" href="dip://"', html)
        self.assertIn("Get the app</a>", html)

    def test_badge_variant_needs_the_asset(self):
        with self.assertRaises(ValueError):
            lc.render_landing(LANDING, "1234567890", True, False)
        html = lc.render_landing(LANDING, "1234567890", True, True)
        self.assertIn('alt="Download on the App Store"', html)
        self.assertNotIn("Get the app</a>", html)

    def test_url(self):
        self.assertEqual(lc.app_store_url("42"), "https://apps.apple.com/app/id42")
        self.assertEqual(lc.app_store_url(""), "")


class IndexingSwitch(unittest.TestCase):
    def test_today_is_noindex(self):
        self.assertFalse(lc.indexing_state(CONFIG))
        self.assertEqual((ROOT / "apps/landing/robots.txt").read_text(), (ROOT / "apps/landing/robots.noindex.txt").read_text())

    def test_off_is_a_noop_on_the_committed_config_and_formatting_round_trips(self):
        self.assertEqual(lc.set_indexing(CONFIG, False), CONFIG)
        self.assertEqual(lc.dump_firebase_json(CONFIG), (ROOT / "firebase.json").read_text())

    def test_on_drops_the_global_header_and_keeps_admin_noindex(self):
        on = lc.set_indexing(CONFIG, True)
        self.assertTrue(lc.indexing_state(on))
        site = lc._site(on, "letsdip")
        global_keys = [h["key"] for h in lc._global_rule(site)["headers"]]
        self.assertNotIn("X-Robots-Tag", global_keys)
        self.assertIn("X-Frame-Options", global_keys)
        admin = next(h for h in site["headers"] if h["source"] == "/admin/**")
        self.assertEqual(admin["headers"], [lc.ROBOTS_HEADER])
        # The redirect-only legacy site is never touched, and the input is not mutated.
        self.assertEqual(lc._site(on, "team05-dip"), lc._site(CONFIG, "team05-dip"))
        self.assertFalse(lc.indexing_state(CONFIG))

    def test_on_then_off_restores_the_original(self):
        self.assertEqual(lc.set_indexing(lc.set_indexing(CONFIG, True), False), CONFIG)
        self.assertEqual(lc.set_indexing(lc.set_indexing(CONFIG, True), True), lc.set_indexing(CONFIG, True))

    def test_robots_variants(self):
        index = (ROOT / "apps/landing/robots.index.txt").read_text()
        self.assertIn("Allow: /", index)
        self.assertIn("Disallow: /admin/", index)
        self.assertIn("Sitemap: https://letsdip.work/sitemap.xml", index)
        self.assertIn("Disallow: /\n", (ROOT / "apps/landing/robots.noindex.txt").read_text())
        self.assertIn("https://letsdip.work/", (ROOT / "apps/landing/sitemap.xml").read_text())


class PushSwitch(unittest.TestCase):
    """Push stays off by default; enabling is the single `#include "Push.xcconfig"` line in Local.xcconfig."""

    def test_default_is_off_and_include_enables_it(self):
        base = (ROOT / "ui/Config/Base.xcconfig").read_text()
        self.assertIn("DIP_PUSH_ENABLED = NO", base)
        self.assertLess(base.index("DIP_PUSH_ENABLED = NO"), base.index('#include? "Local.xcconfig"'))
        push = (ROOT / "ui/Config/Push.xcconfig").read_text()
        self.assertIn("DIP_PUSH_ENABLED = YES", push)
        self.assertIn("DIP_ENTITLEMENTS = Config/DIP-Paid-Push.entitlements", push)

    def test_push_entitlements_are_the_paid_ones_plus_aps_environment(self):
        paid = (ROOT / "ui/Config/DIP-Paid.entitlements").read_text()
        pushy = (ROOT / "ui/Config/DIP-Paid-Push.entitlements").read_text()
        self.assertIn("aps-environment", pushy)
        self.assertNotIn("aps-environment", paid)
        self.assertNotIn("aps-environment", (ROOT / "ui/Config/DIP.entitlements").read_text())
        for needle in ("applinks:letsdip.work", "keychain-access-groups"):
            self.assertIn(needle, paid)
            self.assertIn(needle, pushy)


if __name__ == "__main__":
    unittest.main()
