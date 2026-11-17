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
cloud() { # x y scale opacity fill
  echo "<g transform=\"translate($1 $2) scale($3)\" fill=\"$5\" fill-opacity=\"$4\"><circle cx=\"26\" cy=\"34\" r=\"22\"/><circle cx=\"58\" cy=\"22\" r=\"28\"/><circle cx=\"92\" cy=\"34\" r=\"20\"/><rect x=\"6\" y=\"34\" width=\"106\" height=\"22\" rx=\"11\"/></g>"
}

# 1. logo.png: clover on transparent, 96x96 (cropped to the mark plus a little padding).
cat > "$TMP/logo.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="140 140 744 744">$CLOVER_BRAND</svg>
SVG
rsvg-convert -w 96 -h 96 -o "$OUT/logo.png" "$TMP/logo.svg"

# 2/3. header*.png and footer*.png: 1200x200, flat opaque background (light and dark variants).
# header: clover + "DIP" wordmark at the left, clouds and theme art right. footer: quiet right-weighted mascots.
build() { # suffix bg ink cloudfill cloudopacity plate (plate = art panel colour, or none)
  local sfx="$1" bg="$2" ink="$3" cf="$4" co="$5" plate="${6:-none}"
  local plate_el=""
  if [ "$plate" != "none" ]; then plate_el="<rect x=\"548\" y=\"4\" width=\"640\" height=\"192\" rx=\"16\" fill=\"$plate\"/>"; fi
  cat > "$TMP/header$sfx.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="200" viewBox="0 0 1200 200">
<rect width="1200" height="200" fill="$bg"/>
<g transform="translate(56 56) scale(0.1266) translate(-164 -164)">$CLOVER_BRAND</g>
<text x="166" y="141" font-family="Fjalla One" font-size="96" fill="$ink">DIP</text>
$(cloud 330 25 0.45 $co $cf)$(cloud 440 130 0.5 $co $cf)
$plate_el
<image xlink:href="music.png" x="900" y="8" width="272" height="186"/>
<image xlink:href="games.png" x="730" y="8" width="272" height="186"/>
<image xlink:href="learning.png" x="560" y="8" width="272" height="186"/>
</svg>
SVG
  cat > "$TMP/footer$sfx.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="200" viewBox="0 0 1200 200">
<rect width="1200" height="200" fill="$bg"/>
$(cloud 60 90 0.7 $co $cf)$(cloud 230 25 0.5 $co $cf)$(cloud 330 120 0.45 $co $cf)
$plate_el
<image xlink:href="arts.png" x="560" y="8" width="272" height="186"/>
<image xlink:href="food.png" x="730" y="8" width="272" height="186"/>
<image xlink:href="wellness.png" x="890" y="8" width="272" height="186"/>
</svg>
SVG
  for n in header footer; do
    rsvg-convert -w 1200 -h 200 -o "$TMP/$n$sfx-full.png" "$TMP/$n$sfx.svg"
    sips -s format png "$TMP/$n$sfx-full.png" --out "$OUT/$n$sfx.png" > /dev/null   # opaque, lossless
  done
}
build ""      "#F2F3FC" "#1E212B" "#FFFFFF" 0.85
build "-dark" "#23252E" "#ECEDEF" "#2E313B" 1 "#E8EAF8"
ls -l "$OUT"/*.png
