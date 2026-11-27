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
        self.assertIn("Private beta on iPhone", LANDING)
        self.assertIn('id="open-app" href="dip://">Open the app</a>', LANDING)
        self.assertIn('<a class="button" href="#join">How to join</a>', LANDING)
        self.assertIn('id="join"', LANDING)
        self.assertIn('role="status"', LANDING)
        self.assertNotIn("app-store.svg", LANDING)  # no App Store glyph before a listing exists

    def test_committed_testflight_url_is_empty_and_validated(self):
        self.assertEqual(lc.read_testflight_url(lc.LAUNCH_TS.read_text()), "")
        self.assertEqual(lc.read_testflight_url('export const TESTFLIGHT_URL = "https://testflight.apple.com/join/AbC123xy";'),
                         "https://testflight.apple.com/join/AbC123xy")
        for bad in ("http://testflight.apple.com/join/AbC123xy", "https://evil.example/join/AbC123xy", "https://testflight.apple.com/join/x\"y"):
            with self.assertRaises(ValueError):
                lc.read_testflight_url(f'export const TESTFLIGHT_URL = "{bad}";')
        with self.assertRaises(ValueError):
            lc.read_testflight_url("export const OTHER = 1;")

    def test_testflight_link_joins_the_beta(self):
        html = lc.render_landing(LANDING, "", False, False, "https://testflight.apple.com/join/AbC123xy")
        self.assertIn('href="https://testflight.apple.com/join/AbC123xy">Join the beta on TestFlight</a>', html)
        self.assertNotIn('href="dip://"', html)
        self.assertIn("Private beta on iPhone", html)
        self.assertNotIn('id="join"', html)
        self.assertNotIn('href="#join"', html)

    def test_id_points_the_button_at_the_listing_and_wins_over_testflight(self):
        html = lc.render_landing(LANDING, "1234567890", False, False, "https://testflight.apple.com/join/AbC123xy")
        self.assertIn('href="https://apps.apple.com/app/id1234567890">Get DIP on the App Store</a>', html)
        self.assertNotIn('id="open-app" href="dip://"', html)
        self.assertNotIn("testflight", html.lower().split("<body>")[1])
        self.assertNotIn("Private beta", html)
        self.assertNotIn('id="join"', html)

    def test_badge_variant_needs_the_asset(self):
        with self.assertRaises(ValueError):
            lc.render_landing(LANDING, "1234567890", True, False)
        html = lc.render_landing(LANDING, "1234567890", True, True)
        self.assertIn('alt="Download on the App Store"', html)
        self.assertNotIn("Get DIP on the App Store</a>", html)

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
        sitemap = (ROOT / "apps/landing/sitemap.xml").read_text()
        for page in ("https://letsdip.work/", "https://letsdip.work/privacy/", "https://letsdip.work/support/"):
            self.assertIn(f"<loc>{page}</loc>", sitemap)

    def test_link_preview_crawlers_may_fetch_share_pages_in_both_variants(self):
        """Slack, X and LinkedIn honor robots.txt for unfurls; a crawler obeys only its most specific group."""
        bots = ["Twitterbot", "LinkedInBot", "Slackbot-LinkExpanding", "Slackbot", "Discordbot", "facebookexternalhit", "Facebot", "TelegramBot"]
        for name in ("robots.index.txt", "robots.noindex.txt"):
            text = (ROOT / "apps/landing" / name).read_text()
            groups = [g for g in text.split("\n\n") if "User-agent:" in g]
            preview = next(g for g in groups if "User-agent: Twitterbot" in g)
            for bot in bots:
                self.assertIn(f"User-agent: {bot}\n", preview, f"{name}: {bot}")
            rules = [line for line in preview.splitlines() if line.startswith(("Allow:", "Disallow:"))]
            self.assertEqual(rules, ["Allow: /", "Disallow: /admin/", "Disallow: /u/", "Disallow: /o/"], name)
            for bot in ("Googlebot", "Applebot", "Bingbot"):
                self.assertNotIn(bot, text, name)  # search engines stay under the * group
        self.assertIn("User-agent: *\nDisallow: /\n", (ROOT / "apps/landing/robots.noindex.txt").read_text())
        self.assertEqual((ROOT / "apps/landing/robots.txt").read_text(), (ROOT / "apps/landing/robots.noindex.txt").read_text())
