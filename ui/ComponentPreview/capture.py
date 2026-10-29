#!/usr/bin/env python3
"""Capture stable native prototype screens. Requires Xcode, Pillow and numpy.

Build/install the preview host first. This tool waits for consecutive stable
content captures to avoid recording the simulator's white launch transition.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile
import time

import numpy as np
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--device", required=True, help="Booted iPhone simulator UUID")
parser.add_argument("--bundle", default="org.dip-app.FoundationPreview")
parser.add_argument("--screens", nargs="+", default=["home", "event", "event-joined", "events", "memories", "profile", "attendees", "album"])
parser.add_argument("--output", type=Path, default=Path(tempfile.mkdtemp(prefix="dip-captures-")))
parser.add_argument("--reference-status-bar", action="store_true")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

def simctl(*commands):
    subprocess.run(["xcrun", "simctl", *commands], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

try:
    if args.reference_status_bar:
        simctl("status_bar", args.device, "override", "--time", "9:41",
               "--batteryState", "charged", "--batteryLevel", "100",
               "--wifiMode", "active", "--wifiBars", "3",
               "--cellularMode", "active", "--cellularBars", "4")
    for screen in args.screens:
        simctl("launch", "--terminate-running-process", args.device, args.bundle, "--screen=" + screen)
        time.sleep(3)
        previous = None
        stable = 0
        deadline = time.monotonic() + 60
        target = args.output / (screen + "-3x.png")
        while time.monotonic() < deadline:
            simctl("io", args.device, "screenshot", str(target))
            im = Image.open(target).convert("RGB")
            scale = im.width // 402
            if scale < 1 or im.size != (402 * scale, 874 * scale):
                raise SystemExit("Capture needs a simulator with a 402x874 logical viewport.")
            content = np.asarray(im)[50*scale:853*scale].astype(float)
            nonwhite = (np.abs(content - 255).max(axis=2) > 10).mean()
            difference = np.abs(content - previous).mean() if previous is not None else float("inf")
            stable = stable + 1 if difference < 0.01 and nonwhite > 0.05 else 0
            if stable >= 2:
                print("Stable capture: " + str(target), flush=True)
                break
            previous = content
            time.sleep(1)
        else:
            raise SystemExit("Screen did not stabilize: " + screen)
finally:
    if args.reference_status_bar:
        simctl("status_bar", args.device, "clear")
