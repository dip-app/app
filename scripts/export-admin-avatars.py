#!/usr/bin/env python3
"""Regenerate apps/admin/public/img/avatars/*.webp from the app's avatar artwork.

The app's avatars exist only as small rasters (44-80 px in the iOS asset catalogs; the Figma
"Coworker Profile Picture" set flattens them to 44 px images). They are flat-colour art, so each
source is upscaled, smoothed, snapped back to its own flat palette and downsampled again. That keeps
the shapes crisp at the 96 px (2x) the portal shows them at.

Sources (ui/Packages/DIPDesignSystem/.../Home.xcassets): CoworkerProfilePicture3..7 (80 px: pink, red,
purple, teal, green), CoworkerProfilePicture2 (44 px: orange), CoworkerProfilePicture (44 px: lime), CoworkerProfilePicture1 is purple again,
AvatarTeal is the same character as teal. Figma node ids (file DCIagJo7uk5IOUGqlKzAjf): Avatar=Pink
46:452, Red 46:451, Teal 46:450, Yellow 76:1663, Green 76:1665, Purple 76:5812, Lime 76:5818, Blue 76:5847.
Blue is only in Figma; pass --blue <png> to include it.

Usage: python3 scripts/export-admin-avatars.py [--blue path/to/blue.png]
"""
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / "ui/Packages/DIPDesignSystem/Sources/DIPDesignSystem/Resources/Home.xcassets"
OUT = ROOT / "apps/admin/public/img/avatars"
SOURCES = {
    "pink": "CoworkerProfilePicture3",
    "red": "CoworkerProfilePicture4",
    "purple": "CoworkerProfilePicture5",
    "teal": "CoworkerProfilePicture6",
    "green": "CoworkerProfilePicture7",
    "orange": "CoworkerProfilePicture2",
    "lime": "CoworkerProfilePicture",
}
SIZE = 192


def clean(src: Path, out: Path) -> None:
    im = Image.open(src).convert("RGBA")
    w = im.size[0]
    px = np.array(im).reshape(-1, 4)
    counts = Counter(map(tuple, px[px[:, 3] == 255])).most_common(12)
    pal = [np.array(c[:3]) for c, n in counts if n > w * w * 0.004][:3]
    big = im.resize((SIZE * 4, SIZE * 4), Image.BICUBIC).filter(ImageFilter.GaussianBlur(SIZE * 4 / w * 0.55))
    a = np.array(big).astype(float)
    dist = np.stack([((a[..., :3] - p) ** 2).sum(-1) for p in pal], -1)
    idx = dist.argmin(-1)
    o = np.zeros(a.shape, np.uint8)
    for i, p in enumerate(pal):
        o[idx == i, :3] = p
    o[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    img = Image.fromarray(o).resize((SIZE, SIZE), Image.LANCZOS)
    # Every avatar is a disc: a supersampled circle mask removes the stair-steps left at the rim.
    mask = Image.new("L", (SIZE * 4, SIZE * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, SIZE * 4 - 1, SIZE * 4 - 1), fill=255)
    img.putalpha(mask.resize((SIZE, SIZE), Image.LANCZOS))
    img.save(out, "WEBP", quality=90, method=6)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    srcs = {k: RES / f"{v}.imageset/image.png" for k, v in SOURCES.items()}
    if "--blue" in sys.argv:
        srcs["blue"] = Path(sys.argv[sys.argv.index("--blue") + 1])
    for name, src in srcs.items():
        clean(src, OUT / f"{name}.webp")
        print("wrote", OUT / f"{name}.webp")


if __name__ == "__main__":
    main()
