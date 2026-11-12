#!/usr/bin/env python3
"""Launch switches for the public website (docs/ops/launch-switches.md).

Pure helpers (unit-tested in scripts/tests/test_launch_config.py) plus a small CLI used by
scripts/build-site.sh and scripts/set-indexing.sh. Nothing here deploys or talks to the network.

  launch_config.py landing <src.html> <dst.html>    render the landing page for the current App Store config
  launch_config.py indexing status|on|off           read or change the search-indexing switch in firebase.json
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAUNCH_TS = ROOT / "gcp/functions/src/config/launch.ts"
FIREBASE_JSON = ROOT / "firebase.json"
LANDING = ROOT / "apps/landing"
BADGE_PATH = "img/app-store-badge.svg"  # under apps/landing; published at /img/landing/app-store-badge.svg
MAIN_SITE = "letsdip"
ROBOTS_HEADER = {"key": "X-Robots-Tag", "value": "noindex, nofollow"}
ADMIN_SOURCE = "/admin/**"

_ID = re.compile(r'^export const APP_STORE_ID = "([^"]*)";', re.M)
_BADGE = re.compile(r"^export const USE_OFFICIAL_APP_STORE_BADGE = (true|false);", re.M)
_LANDING_PILL = re.compile(
    r'<a class="pill store" id="open-app" href="dip://" role="button">.*?</a>', re.S
)


def read_launch_config(ts_text):
    """Returns (app_store_id, use_badge) parsed from gcp/functions/src/config/launch.ts."""
    id_match, badge_match = _ID.search(ts_text), _BADGE.search(ts_text)
    if not id_match or not badge_match:
        raise ValueError("launch.ts must keep APP_STORE_ID and USE_OFFICIAL_APP_STORE_BADGE as one-line literals")
    app_store_id = id_match.group(1)
    if app_store_id and not app_store_id.isdigit():
        raise ValueError("APP_STORE_ID must be empty or digits only")
    return app_store_id, badge_match.group(1) == "true"


def app_store_url(app_store_id):
    return f"https://apps.apple.com/app/id{app_store_id}" if app_store_id.isdigit() else ""


def render_landing(html, app_store_id, use_badge=False, badge_exists=False):
    """Landing page for the App Store config. An empty id returns the page unchanged (open-the-app pill)."""
    url = app_store_url(app_store_id)
    if not url:
        return html
    if not _LANDING_PILL.search(html):
        raise ValueError("landing page no longer contains the #open-app pill")
    if use_badge:
        if not badge_exists:
            raise ValueError(f"USE_OFFICIAL_APP_STORE_BADGE is on but apps/landing/{BADGE_PATH} is missing")
        replacement = (
            f'<a class="store-badge" id="open-app" href="{url}">'
            '<img src="/img/landing/app-store-badge.svg" alt="Download on the App Store" height="48"></a>'
        )
    else:
        # Same pill, now opening the listing instead of dip://.
        replacement = _LANDING_PILL.search(html).group(0).replace('href="dip://"', f'href="{url}"', 1)
    return _LANDING_PILL.sub(lambda _m: replacement, html, count=1)


def _site(config, name):
    return next(s for s in config["hosting"] if s["site"] == name)


def _global_rule(site):
    return next(h for h in site["headers"] if h["source"] == "**")


def indexing_state(config):
    """True when the main site lets search engines in (no global X-Robots-Tag header)."""
    keys = {h["key"] for h in _global_rule(_site(config, MAIN_SITE))["headers"]}
    return "X-Robots-Tag" not in keys


def set_indexing(config, on):
    """Returns a copy of the firebase.json dict with the main site's indexing switch set.

    off (pre-release): X-Robots-Tag noindex, nofollow on every path (first header of the `**` rule).
    on: that header is removed, and `/admin/**` gets its own noindex so the portal never becomes indexable.
    The redirect-only `team05-dip` site is never touched: it stays noindex.
    """
    out = json.loads(json.dumps(config))
    site = _site(out, MAIN_SITE)
    rule = _global_rule(site)
    rule["headers"] = [h for h in rule["headers"] if h["key"] != "X-Robots-Tag"]
    site["headers"] = [h for h in site["headers"] if h["source"] != ADMIN_SOURCE]
    if on:
        position = site["headers"].index(rule) + 1
        site["headers"].insert(position, {"source": ADMIN_SOURCE, "headers": [dict(ROBOTS_HEADER)]})
    else:
        rule["headers"].insert(0, dict(ROBOTS_HEADER))
    return out


def dump_firebase_json(config):
    return json.dumps(config, indent=2, ensure_ascii=False) + "\n"


def _landing(src, dst):
    app_store_id, use_badge = read_launch_config(LAUNCH_TS.read_text())
    html = render_landing(Path(src).read_text(), app_store_id, use_badge, (LANDING / BADGE_PATH).is_file())
    Path(dst).write_text(html)
    print(f"landing: App Store {'listing ' + app_store_id if app_store_id else 'not configured (open-app pill)'}"
          f"{', official badge' if app_store_id and use_badge else ''}")


def _indexing(action):
    config = json.loads(FIREBASE_JSON.read_text())
    if action == "status":
        print("indexing: ON (search engines allowed)" if indexing_state(config) else "indexing: OFF (noindex, nofollow)")
        return
    on = action == "on"
    FIREBASE_JSON.write_text(dump_firebase_json(set_indexing(config, on)))
    robots = LANDING / ("robots.index.txt" if on else "robots.noindex.txt")
    (LANDING / "robots.txt").write_text(robots.read_text())
    print(f"indexing set {action}: firebase.json and apps/landing/robots.txt updated. Review `git diff`, then rebuild "
          "(scripts/build-site.sh) and deploy hosting deliberately; nothing was deployed.")


def main(argv):
    if len(argv) == 4 and argv[1] == "landing":
        _landing(argv[2], argv[3])
    elif len(argv) == 3 and argv[1] == "indexing" and argv[2] in ("status", "on", "off"):
        _indexing(argv[2])
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
