#!/usr/bin/env bash
# Regenerates the 1200x630 link-preview images in apps/admin/public/share/og/ from the app's bundled
# event cover artwork plus the DIP clover mark. Needs rsvg-convert and sips (macOS). Output is committed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COVERS="$ROOT/ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/EventCovers.xcassets"
OUT="$ROOT/apps/admin/public/share/og"
LOGO="$ROOT/ui/DIP/Resources/AppIcon.icon/Assets/logo.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

# logo.svg is a 1024 canvas holding one white clover group; drop the svg wrapper lines and reuse the group.
CLOVER="$(sed -e '1d' -e '$d' "$LOGO")"
FONT="Helvetica Neue, Helvetica, Arial, sans-serif"

render() { # name, cover jpg path (empty for the generic image)
  local name="$1" cover="${2:-}"
  if [ -n "$cover" ]; then cp "$cover" "$TMP/$name-cover.jpg"; cover="$name-cover.jpg"; fi
  if [ -n "$cover" ]; then
    # Cover artwork scaled to fill 1200x630, with a flat periwinkle brand strip along the bottom.
    cat > "$TMP/$name.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
<image xlink:href="$cover" x="0" y="0" width="1200" height="630" preserveAspectRatio="xMidYMid slice"/>
<rect x="0" y="510" width="1200" height="120" fill="#7B88FA"/>
<g transform="translate(36 516) scale(0.105)">$CLOVER</g>
<text x="160" y="590" font-family="$FONT" font-weight="800" font-size="64" fill="#FFFFFF">DIP</text>
</svg>
SVG
  else
    cat > "$TMP/$name.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#7B88FA"/>
<g transform="translate(150 55) scale(0.5)">$CLOVER</g>
<text x="690" y="385" font-family="$FONT" font-weight="800" font-size="200" fill="#FFFFFF">DIP</text>
</svg>
SVG
  fi
  rsvg-convert -w 1200 -h 630 -o "$TMP/$name.png" "$TMP/$name.svg"
  sips -s format jpeg -s formatOptions 72 "$TMP/$name.png" --out "$OUT/$name.jpg" > /dev/null
}

render default ""
for c in fitness outdoors hiking games cooking; do
  render "$c" "$COVERS/cover_$c.imageset/$c.jpg"
done
ls -l "$OUT"
