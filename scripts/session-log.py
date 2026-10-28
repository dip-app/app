#!/usr/bin/env python3
"""Create session handoffs and validate the new logs in a PR (not each commit)."""
import argparse
import datetime as dt
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATTERN = re.compile(r'docs/sessions/SESSION_([a-zA-Z0-9][a-zA-Z0-9-]*)_(\d{4}-\d{2}-\d{2})_(\d{3})\.md$')
SECTIONS = ('Summary', 'Changes', 'Validation', 'Decisions', 'Handoff')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def validate(path, text):
    match = PATTERN.fullmatch(path)
    if not match:
        raise ValueError(f'Invalid session filename: {path}')
    dt.date.fromisoformat(match[2])
    metadata = {}
    for key in ('User', 'Date', 'Workstream', 'Agent', 'Status'):
        values = re.findall(rf'^{key}:[ \t]*(.*)$', text, re.M)
        if len(values) != 1 or not values[0].strip() or values[0].strip().lower() in ('todo', 'tbd', 'placeholder'):
            raise ValueError(f'{path}: provide exactly one meaningful {key}')
        metadata[key] = values[0].strip()
    if metadata['User'] != match[1] or metadata['Date'] != match[2]:
        raise ValueError(f'{path}: filename and user/date metadata differ')
    if metadata['Status'] not in ('completed', 'handoff', 'blocked'):
        raise ValueError(f'{path}: finish with completed, handoff or blocked status')
    for section in SECTIONS:
        body = re.search(rf'^## {section}\n(.*?)(?=^## |\Z)', text, re.M | re.S)
        if not body or len(body[1].strip()) < 12:
            raise ValueError(f'{path}: fill the {section} section')


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='action', required=True)
    new = sub.add_parser('new')
    new.add_argument('--user', required=True)
    new.add_argument('--workstream', required=True)
    new.add_argument('--agent', default='Codex')
    new.add_argument('--date', default=dt.date.today().isoformat())
    check = sub.add_parser('check')
    check.add_argument('--base', default='')
    check.add_argument('--self-test', action='store_true')
    check.add_argument('--allow-updated', action='store_true', help='Push checks may update the same session; PRs must add one')
    args = p.parse_args()
    if args.action == 'new':
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9-]*', args.user):
            raise SystemExit('Use a stable username containing letters, numbers or hyphens')
        dt.date.fromisoformat(args.date)
        folder = ROOT / 'docs/sessions'
        folder.mkdir(parents=True, exist_ok=True)
        for number in range(1, 1000):
            path = folder / f'SESSION_{args.user}_{args.date}_{number:03}.md'
            try:
                with path.open('x') as file:
                    file.write(f'# Work session\n\nUser: {args.user}\nDate: {args.date}\nWorkstream: {args.workstream}\nAgent: {args.agent}\nStatus: active\n\n')
                    file.write('\n'.join(f'## {s}\n\n' for s in SECTIONS))
                print(path.relative_to(ROOT))
                return
            except FileExistsError:
                continue
        raise SystemExit('No unused session sequence remains for this date')
    if args.self_test:
        valid = 'User: tester\nDate: 2026-10-28\nWorkstream: setup\nAgent: Codex\nStatus: completed\n' + ''.join(f'\n## {s}\nMeaningful handoff content.\n' for s in SECTIONS)
        path = 'docs/sessions/SESSION_tester_2026-10-28_001.md'
        validate(path, valid)
        for invalid in (valid.replace('Status: completed', 'Status: active'), valid.replace('User: tester','User: other'), valid.replace('## Validation','## Missing'), valid.replace('User: tester', 'User: tester-extra'), valid.replace('Date: 2026-10-28', 'Date: 2026-10-28-extra'), valid + '\nUser: tester\n'):
            try:
                validate(path, invalid)
            except ValueError:
                continue
            raise SystemExit('Session validator accepted invalid input')
        print('Session validator positive and negative checks passed')
        return
    base = args.base
    if base and set(base) != {'0'}:
        git('rev-parse', '--verify', f'{base}^{{commit}}')
    else:
        base = git('hash-object', '-t', 'tree', '/dev/null')
    change_filter = '--diff-filter=AM' if args.allow_updated else '--diff-filter=A'
    changed = git('diff', '--name-only', change_filter, base, 'HEAD', '--', 'docs/sessions/SESSION_*.md').splitlines()
    if not changed:
        raise SystemExit('Change must add or update a session log' if args.allow_updated else 'PR must add at least one session log; one log can cover multiple commits')
    for path in changed:
        validate(path, git('show', f'HEAD:{path}'))
    print(f'Validated {len(changed)} session log(s) for this change')


if __name__ == '__main__':
    main()
