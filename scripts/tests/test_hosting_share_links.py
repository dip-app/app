"""Sanity checks for the share-link hosting config (docs/design/share-links.md). No network, no deploy."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class HostingShareLinks(unittest.TestCase):
    def setUp(self):
        sites = json.loads((ROOT / "firebase.json").read_text())["hosting"]
        self.hosting = next(s for s in sites if s["site"] == "letsdip")  # main site: landing, admin, share links, AASA
        self.legacy = next(s for s in sites if s["site"] == "team05-dip")  # redirect-only

    def test_event_and_aasa_rewrites_exist(self):
        rewrites = {r["source"]: r for r in self.hosting["rewrites"]}
        self.assertEqual(rewrites["/e/**"]["function"], {"functionId": "eventSharePageV1", "region": "us-central1"})
        aasa = rewrites["/.well-known/apple-app-site-association"]
        self.assertTrue((ROOT / "apps/admin/public" / aasa["destination"].lstrip("/")).is_file())
        self.assertEqual(len(rewrites), 2)  # no catch-all that would shadow the admin site

    def test_app_association_is_disabled_so_our_aasa_is_served(self):
        # Firebase auto-generates an empty AASA on web.app unless appAssociation is NONE.
        self.assertEqual(self.hosting["appAssociation"], "NONE")
        headers = {h["source"]: {x["key"]: x["value"] for x in h["headers"]} for h in self.hosting["headers"]}
        aasa = headers["/.well-known/apple-app-site-association"]
        self.assertEqual(aasa["Content-Type"], "application/json")
        self.assertEqual(aasa["Cache-Control"], "public, max-age=300")

    def test_share_function_is_exported_and_preview_images_exist(self):
        index = (ROOT / "gcp/functions/src/index.ts").read_text()
        self.assertIn('export { eventSharePageV1 } from "./modules/share";', index)
        for name in ["default", "fitness", "outdoors", "hiking", "games", "cooking"]:
            self.assertTrue((ROOT / f"apps/admin/public/share/og/{name}.jpg").is_file(), name)

    def test_aasa_headers_and_admin_rules_are_kept(self):
        sources = {h["source"] for h in self.hosting["headers"]}
        self.assertIn("/.well-known/apple-app-site-association", sources)
        self.assertIn("**", sources)  # global noindex headers
        self.assertEqual(self.hosting["public"], "site-dist")  # built by scripts/build-site.sh: landing at /, admin at /admin/

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
        ts = (ROOT / "gcp/functions/src/modules/share/domain/sharePage.ts").read_text()
        launch = (ROOT / "gcp/functions/src/config/launch.ts").read_text()
        self.assertRegex(launch, r'APP_STORE_ID = "";')  # single source; see docs/ops/launch-switches.md
        self.assertIn("config/launch", ts)
        self.assertIn("dip://events/", ts)
        self.assertNotIn("http-equiv", ts)

    def test_legacy_default_domain_only_redirects_to_the_public_domain(self):
        self.assertEqual(self.legacy["public"], "apps/redirect")
        rule = self.legacy["redirects"][0]
        self.assertEqual((rule["source"], rule["type"]), ("/:path*", 301))
        self.assertEqual(rule["destination"], "https://letsdip.work/:path*")
        self.assertIn(("/", 301), [(r["source"], r["type"]) for r in self.legacy["redirects"]])  # the static fallback page must not win at /
        self.assertNotIn("rewrites", self.legacy)


if __name__ == "__main__":
    unittest.main()
