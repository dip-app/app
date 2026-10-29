#!/usr/bin/env python3
"""Build/test the isolated UI component host using an available iPhone simulator."""
import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--device', default=os.environ.get('SIMULATOR_ID'))
parser.add_argument('--derived-data', type=Path)
args = parser.parse_args()
if not args.device:
    devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']))
    args.device = next((device['udid'] for runtime, entries in devices['devices'].items() if '.iOS-' in runtime for device in entries if device.get('isAvailable') and device['name'].startswith('iPhone')), None)
if not args.device:
    raise SystemExit('No available iPhone simulator. Install an iOS runtime in Xcode or pass --device UDID.')
derived = args.derived_data or Path(tempfile.mkdtemp(prefix='dip-component-preview-'))
print(f'Simulator: {args.device}; derived data: {derived}', flush=True)
subprocess.run(['xcodegen', 'generate', '--spec', str(root / 'project.yml')], check=True)
subprocess.run(['xcodebuild', '-project', str(root / 'DIPFoundationPreview.xcodeproj'), '-scheme', 'Preview', '-destination', f'platform=iOS Simulator,id={args.device}', '-derivedDataPath', str(derived), '-parallel-testing-enabled', 'NO', '-collect-test-diagnostics', 'never', 'CODE_SIGNING_ALLOWED=NO', 'test'], check=True)
