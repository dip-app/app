# Work session

User: sandervonk
Date: 2026-11-27
Workstream: themes-edit-redirect
Agent: Claude
Status: completed

## Summary

Answer the old /admin/themes/edit/ address with a hosting 301 to /admin/challenges/edit/, finishing the redirects from #372.

## Changes

- firebase.json: 301 /admin/themes/edit{,/} to /admin/challenges/edit/.
- scripts/tests/test_hosting_share_links.py: expect the new redirect and the challenges/edit target.

## Validation

- curl on letsdip.work showed /admin/themes/?phase=past redirecting to /admin/challenges/?phase=past, so hosting keeps the query string and ?id survives.
- python3 -m unittest discover -s scripts/tests -p test_hosting_share_links.py passes.

## Decisions

- Keep the client redirect page as the fallback for other servers.

## Handoff

Deploy hosting after merge; nothing else pending here.
