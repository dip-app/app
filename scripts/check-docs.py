#!/usr/bin/env python3
"""Check repository-local Markdown file links without reading dependency caches."""
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0')
errors = []
count = 0
for relative in sorted(set(files)):
    path = ROOT / relative
    if not relative or path.suffix != '.md' or not path.is_file():
        continue
    count += 1
    for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', path.read_text()):
        target = target.strip().strip('<>')
        if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target):
            continue
        target = unquote(target.split('#', 1)[0])
        if target and not (path.parent / target).exists():
            errors.append(f'{relative}: missing local link {target}')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'Checked local Markdown file links in {count} documents')
