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
cp apps/landing/index.html site-dist/index.html
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
