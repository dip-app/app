# Session logs for humans and agents

One log per working session, not per commit. A session may contain several commits. The log records context, decisions, checks, unfinished work and a next-person handoff; commit messages describe individual changes. Add at least one NEW log in every PR. Continue updating the same log during the session; start another when a different person/agent starts a separate session. Do not edit someone else's log. Never include tokens, join codes from real companies, personal customer data or credentials.

At session start run:

```sh
npm run session:new -- --user YOUR-GITHUB-USERNAME --workstream 03-events-participation
```

This creates `docs/sessions/SESSION_<username>_<YYYY-MM-DD>_<NNN>.md` with a unique sequence, avoiding collisions. Use your actual local date via `--date YYYY-MM-DD` if the execution host timezone differs. Identify the human owner in User and the agent/model in Agent. Update Summary, Changes, Validation, Decisions and Handoff as work proceeds. Before the PR, set Status to completed, handoff or blocked and replace empty sections with factual notes. State pending checks explicitly; a blocked session is a valid handoff, not a claim of completion.

`npm run session:check -- --base <BASE-SHA>` validates new logs against the branch base. CI runs this on the PR diff (and on setup/main pushes), checking filename, matching username/date metadata, status and nonempty sections. It does NOT require a new log in every commit. A maintainer still reviews honesty and useful content; automation cannot prove that a session account is accurate.

The first setup log is included as an example. Do not copy its identity or claims. Each workstream README gives the owned paths and handoff requirements. Agents must maintain their log as part of the task rather than asking the human to reconstruct it at the end.

Push checks allow an updated existing log for follow-up commits in the same session. PR checks still require at least one newly added log across the whole PR. This keeps the check compatible with small commits and repeated pushes.
