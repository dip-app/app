#!/usr/bin/env python3
"""Compare the original Figma Home export with a same-viewport simulator capture.

Requires Pillow and numpy (requirements-review.txt). Images are review evidence,
never application resources. Pixel metrics describe differences, not design approval.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--name", default="home")
parser.add_argument("--figma", required=True, type=Path)
parser.add_argument("--simulator", required=True, type=Path)
parser.add_argument("--output", type=Path, default=Path(__file__).parent / "Review")
args = parser.parse_args()
reference = Image.open(args.figma).convert("RGB")
if reference.size == (610, 1082):
    # Home's 402x874 frame begins at x104,y100 in its shadow-inclusive export.
    reference = reference.crop((104, 100, 506, 974))
if reference.size != (402, 874):
    raise SystemExit("Expected the 402x874 Home frame or its 610x1082 shadow-inclusive export.")
actual = Image.open(args.simulator).convert("RGB")
scale = actual.width // 402
if scale < 1 or actual.size != (402 * scale, 874 * scale):
    raise SystemExit("Simulator must have a 402x874 logical viewport at an integer pixel scale.")
actual = actual.resize(reference.size, Image.Resampling.LANCZOS)
args.output.mkdir(parents=True, exist_ok=True)
reference.save(args.output / f"figma-{args.name}.png")
actual.save(args.output / "reference-standard.png")
pair = Image.new("RGB", (804, 874), "white")
pair.paste(reference)
pair.paste(actual, (402, 0))
pair.save(args.output / f"{args.name}-comparison.png")
Image.blend(reference, actual, 0.5).save(args.output / f"{args.name}-overlay.png")
ImageChops.difference(reference, actual).save(args.output / f"{args.name}-difference.png")
# Exclude native OS status/home-indicator chrome and pixels outside Figma's rounded frame.
mask_image = Image.new("L", (402, 874), 0)
ImageDraw.Draw(mask_image).rounded_rectangle((0, 0, 401, 873), radius=60, fill=255)
mask = np.asarray(mask_image) > 0
mask[:50] = False
mask[853:] = False
delta = np.abs(np.asarray(reference).astype(float) - np.asarray(actual).astype(float))
pixels = delta[mask]
report = {
    "frame": {"width": 402, "height": 874},
    "simulatorScale": scale,
    "figmaExportSHA256": hashlib.sha256(args.figma.read_bytes()).hexdigest(),
    "simulatorSHA256": hashlib.sha256(args.simulator.read_bytes()).hexdigest(),
    "region": "Inside rounded Figma frame, y=50...852; excludes native OS chrome",
    "comparedPixels": int(mask.sum()),
    "meanAbsoluteChannelDifference": round(float(pixels.mean()), 4),
    "pixelsWithAnyChannelDifferenceOver10Percent": round(float((pixels.max(axis=1) > 10).mean() * 100), 4),
    "note": "Figma and iOS use different rasterizers. This is not a zero-difference or approval claim."
}
(args.output / f"{args.name}-comparison.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
