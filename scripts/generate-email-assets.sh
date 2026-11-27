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

# 2/3. header.png and footer.png: 1200x200, TRANSPARENT, one asset for light mode, dark mode and forced inversion.
# The band colour comes from the email's table cell (#F2F3FC light, #121318 dark, or whatever a client inverts it to);
# the art carries only what reads on both: the brand-purple clover and wordmark, faint purple clouds, and the mascots on
# a rounded light panel (their ink outlines need a light ground). header-dark.png and footer-dark.png are written as
# copies so emails already sent with the old dark swap keep loading an image.
build() {
  # The panel stays inside the body card's right edge on phones (12 px page gutter: x <= 1160 of 1200 at 390 px wide).
  local plate="<rect x=\"584\" y=\"16\" width=\"572\" height=\"168\" rx=\"24\" fill=\"#FFFFFF\" stroke=\"#E6E7EE\" stroke-width=\"2\"/>"
  cat > "$TMP/header.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="200" viewBox="0 0 1200 200">
<g transform="translate(56 56) scale(0.1266) translate(-164 -164)">$CLOVER_BRAND</g>
<text x="166" y="141" font-family="Fjalla One" font-size="96" fill="#5A66E6">DIP</text>
$(cloud 330 25 0.45 0.16 "#7B88FA")$(cloud 440 130 0.5 0.16 "#7B88FA")
$plate
<image xlink:href="music.png" x="904" y="22" width="232" height="158"/>
<image xlink:href="games.png" x="758" y="22" width="232" height="158"/>
<image xlink:href="learning.png" x="604" y="22" width="232" height="158"/>
</svg>
SVG
  cat > "$TMP/footer.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="200" viewBox="0 0 1200 200">
$(cloud 60 90 0.7 0.16 "#7B88FA")$(cloud 230 25 0.5 0.16 "#7B88FA")$(cloud 330 120 0.45 0.16 "#7B88FA")
$plate
<image xlink:href="arts.png" x="604" y="22" width="232" height="158"/>
<image xlink:href="food.png" x="758" y="22" width="232" height="158"/>
<image xlink:href="wellness.png" x="904" y="22" width="232" height="158"/>
</svg>
SVG
  for n in header footer; do
    rsvg-convert -w 1200 -h 200 -o "$OUT/$n.png" "$TMP/$n.svg"   # keeps alpha
    cp "$OUT/$n.png" "$OUT/$n-dark.png"
  done
}
build
# 4. ideas/<theme>.png: 224x224 opaque tiles (shown at 112x112) for the admin weekly ideas email. The transparent theme art
# is cropped to its mascot cluster (about x 290..730, y 30..500 of the shared 730x539 slot) and centered on the theme's accent
# color (apps/admin/public/img/themes/ACCENTS.md), so the character fills most of the tile.
mkdir -p "$OUT/ideas"
tile() { # theme accent
  cp "$IMG/themes/$1.png" "$TMP/tile-$1.png"
  cat > "$TMP/tile-$1.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="224" height="224" viewBox="0 0 224 224">
<rect width="224" height="224" fill="$2"/>
<image xlink:href="tile-$1.png" x="-100.5" y="1.5" width="304.6" height="224.9"/>
</svg>
SVG
  rsvg-convert -w 224 -h 224 -o "$TMP/tile-$1-full.png" "$TMP/tile-$1.svg"
  sips -s format png "$TMP/tile-$1-full.png" --out "$OUT/ideas/$1.png" > /dev/null   # opaque, lossless
}
tile fitness "#FB72E4"; tile outdoors "#6BE5D0"; tile food "#FF7C73"; tile arts "#7B88FA"; tile games "#FFCC3E"
tile music "#66D9FF"; tile learning "#6BFF9B"; tile volunteering "#1E212B"; tile wellness "#FF7C73"
ls -l "$OUT"/*.png "$OUT"/ideas/*.png
