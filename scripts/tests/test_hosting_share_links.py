"""Sanity checks for the share-link hosting config (docs/design/share-links.md). No network, no deploy."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class HostingShareLinks(unittest.TestCase):
    def setUp(self):
        self.hosting = json.loads((ROOT / "firebase.json").read_text())["hosting"]

    def test_event_and_aasa_rewrites_exist_and_point_at_real_files(self):
        rewrites = {r["source"]: r["destination"] for r in self.hosting["rewrites"]}
        self.assertEqual(rewrites["/e/**"], "/share/event.html")
        self.assertIn("/.well-known/apple-app-site-association", rewrites)
        for destination in rewrites.values():
            self.assertTrue((ROOT / "apps/admin/public" / destination.lstrip("/")).is_file(), destination)

    def test_aasa_headers_and_admin_rules_are_kept(self):
        sources = {h["source"] for h in self.hosting["headers"]}
        self.assertIn("/.well-known/apple-app-site-association", sources)
        self.assertIn("**", sources)  # global noindex headers
        self.assertEqual(self.hosting["public"], "apps/admin/out")

    def test_aasa_is_valid_json_for_the_event_path(self):
        aasa = json.loads((ROOT / "apps/admin/public/aasa/apple-app-site-association.json").read_text())
        detail = aasa["applinks"]["details"][0]
        self.assertEqual(detail["appIDs"], ["TEAMID.org.dip-app.DIP"])  # placeholder Team ID until the paid team exists
        self.assertEqual(detail["components"][0]["/"], "/e/*")

    def test_domain_matches_swift_base_url_and_paid_entitlements(self):
        swift = (ROOT / "ui/Packages/DIPCore/Sources/DIPCore/DIPShareLink.swift").read_text()
        host = re.search(r'baseURL = URL\(string: "https://([^"/]+)"\)', swift).group(1)
        entitlements = (ROOT / "ui/Config/DIP-Paid.entitlements").read_text()
        self.assertIn(f"applinks:{host}", entitlements)
        self.assertNotIn("associated-domains", (ROOT / "ui/Config/DIP.entitlements").read_text())

    def test_landing_page_has_unset_app_store_placeholder(self):
        html = (ROOT / "apps/admin/public/share/event.html").read_text()
        self.assertRegex(html, r'var APP_STORE_ID = "";')
        self.assertIn("dip://events/", html)


if __name__ == "__main__":
    unittest.main()
