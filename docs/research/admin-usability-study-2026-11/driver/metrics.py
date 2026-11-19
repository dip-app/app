"""Per-task time and step counts from each participant's commands.jsonl.

Tasks are split at each `goto` (the moderator's start page). Usage: python3 metrics.py <round-dir> <persona>=<t,t,...> ...
Prints persona, task, commands, failed commands, minutes.
"""
import json
import sys
from datetime import datetime

root = sys.argv[1]
for spec in sys.argv[2:]:
    persona, tasks = spec.split("=")
    tasks = tasks.split(",")
    rows = [json.loads(line) for line in open(f"{root}/{persona}/commands.jsonl") if line.strip()]
    rows = [r for r in rows if r.get("cmd") not in ("quit", "url")]
    segments, current = [], None
    for r in rows:
        if r["cmd"] == "goto":
            current = []
            segments.append(current)
        if current is not None:
            current.append(r)
    for task, seg in zip(tasks, segments):
        t0 = datetime.fromisoformat(seg[0]["t"].replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(seg[-1]["t"].replace("Z", "+00:00"))
        fails = sum(1 for r in seg if not r.get("ok", True))
        print(f"{persona}\tT{task}\t{len(seg)}\t{fails}\t{(t1 - t0).total_seconds() / 60:.1f}")
