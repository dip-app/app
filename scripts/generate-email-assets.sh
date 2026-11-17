#!/usr/bin/env bash
# Regenerates the notification-email image assets in apps/admin/public/img/email/ (logo.png, header.png,
# footer.png) from the admin theme illustrations and the DIP clover mark.
# Needs rsvg-convert and sips (macOS). Output is committed and
# served at https://letsdip.work/img/email/<name> (scripts/build-site.sh copies apps/admin/public/img to the site root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMG="$ROOT/apps/admin/public/img"
OUT="$IMG/email"
LOGO="$ROOT/ui/DIP/Resources/AppIcon.icon/Assets/logo.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

# logo.svg is a 1024 canvas holding one white clover group; drop the svg wrapper lines and recolour it.
CLOVER="$(sed -e '1d' -e '$d' "$LOGO")"
BRAND="#7B88FA"
CLOVER_BRAND="${CLOVER//#FFFFFF/$BRAND}"

# Theme illustrations (transparent PNG, 730x539).
for t in learning games music outdoors wellness food arts; do cp "$IMG/themes/$t.png" "$TMP/$t.png"; done

# Fjalla One (OFL, from the design system) for the wordmark, via a temporary fontconfig.
FONTS="$ROOT/ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/Fonts"
cat > "$TMP/fonts.conf" <<CONF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>$FONTS</dir><dir>/System/Library/Fonts</dir><dir>/Library/Fonts</dir><cachedir>$TMP/fc-cache</cachedir></fontconfig>
CONF
export FONTCONFIG_FILE="$TMP/fonts.conf" PANGOCAIRO_BACKEND=fc   # fc backend, or macOS rsvg ignores fontconfig and falls back

# Reusable soft cloud (same construction as the theme art).
cloud() { # x y scale opacity
  echo "<g transform=\"translate($1 $2) scale($3)\" fill=\"#FFFFFF\" fill-opacity=\"$4\"><circle cx=\"26\" cy=\"34\" r=\"22\"/><circle cx=\"58\" cy=\"22\" r=\"28\"/><circle cx=\"92\" cy=\"34\" r=\"20\"/><rect x=\"6\" y=\"34\" width=\"106\" height=\"22\" rx=\"11\"/></g>"
}

# 1. logo.png: clover on transparent, 96x96 (cropped to the mark plus a little padding).
cat > "$TMP/logo.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="140 140 744 744">$CLOVER_BRAND</svg>
SVG
rsvg-convert -w 96 -h 96 -o "$OUT/logo.png" "$TMP/logo.svg"

# 2. header.png: 1200x200, flat background, clover + "DIP" wordmark at the left, clouds and theme art on the right.
cat > "$TMP/header.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="200" viewBox="0 0 1200 200">
<rect width="1200" height="200" fill="#F2F3FC"/>
<g transform="translate(56 56) scale(0.1266) translate(-164 -164)">$CLOVER_BRAND</g>
<text x="166" y="141" font-family="Fjalla One" font-size="96" fill="#1E212B">DIP</text>
$(cloud 330 25 0.45 0.8)$(cloud 440 130 0.5 0.8)
<image xlink:href="music.png" x="900" y="2" width="272" height="201"/>
<image xlink:href="games.png" x="730" y="2" width="272" height="201"/>
<image xlink:href="learning.png" x="560" y="2" width="272" height="201"/>
</svg>
SVG
rsvg-convert -w 1200 -h 200 -o "$TMP/header-full.png" "$TMP/header.svg"

# 3. footer.png: 1200x200, flat background, a quiet right-weighted group of theme mascots and soft clouds.
cat > "$TMP/footer.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="200" viewBox="0 0 1200 200">
<rect width="1200" height="200" fill="#F2F3FC"/>
$(cloud 60 90 0.7 0.9)$(cloud 230 25 0.5 0.8)$(cloud 330 120 0.45 0.8)
<image xlink:href="arts.png" x="560" y="6" width="272" height="201"/>
<image xlink:href="food.png" x="730" y="6" width="272" height="201"/>
<image xlink:href="wellness.png" x="890" y="6" width="272" height="201"/>
</svg>
SVG
rsvg-convert -w 1200 -h 200 -o "$TMP/footer-full.png" "$TMP/footer.svg"

# The renders are fully opaque (own background); copy them out as lossless PNG.
for n in header footer; do
  sips -s format png "$TMP/$n-full.png" --out "$OUT/$n.png" > /dev/null
done
ls -l "$OUT"/*.png
