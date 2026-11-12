#!/usr/bin/env bash
# Assemble the Firebase Hosting root (site-dist/): landing page at /, the admin portal
# (built with basePath /admin) at /admin/, plus shared public assets (AASA, share images, art).
# Usage: scripts/build-site.sh [--skip-admin-build]   (needs Node 20+ and apps/admin deps)
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" != "--skip-admin-build" ]; then
  npm --prefix apps/admin run build
fi
rm -rf site-dist
mkdir -p site-dist/admin
# Landing page: with APP_STORE_ID set in gcp/functions/src/config/launch.ts the button opens the App Store listing
# (or shows the official badge when USE_OFFICIAL_APP_STORE_BADGE is on); empty = unchanged "open the app" pill.
python3 scripts/launch_config.py landing apps/landing/index.html site-dist/index.html
# robots.txt and sitemap.xml are written by scripts/set-indexing.sh (noindex today); see docs/ops/launch-switches.md.
cp apps/landing/robots.txt site-dist/robots.txt
cp apps/landing/sitemap.xml site-dist/sitemap.xml
mkdir -p site-dist/img/landing && cp apps/landing/img/* site-dist/img/landing/
cp apps/landing/img/favicon.ico site-dist/favicon.ico   # crawlers and old clients ask for /favicon.ico
cp -R apps/admin/out/. site-dist/admin/
# Root-level public assets the share page, Universal Links and admin <img src="/img/..."> rely on.
for d in aasa share img; do
  [ -d "apps/admin/public/$d" ] && mkdir -p "site-dist/$d" && cp -R "apps/admin/public/$d/." "site-dist/$d/" || true
done
# The admin export copies public/ into its out dir too; drop the duplicates under /admin.
rm -rf site-dist/admin/aasa site-dist/admin/share
echo "site-dist ready: $(find site-dist -type f | wc -l | tr -d ' ') files"
