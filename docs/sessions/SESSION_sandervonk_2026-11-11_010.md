# Work session

User: sandervonk
Date: 2026-11-11
Workstream: AASA appAssociation fix
Agent: Claude Code
Status: completed

## Summary

Firebase Hosting served its own empty auto-generated apple-app-site-association on team05-dip.web.app. Set hosting `appAssociation` to `NONE` so our rewrite serves our file.

## Changes

- firebase.json (shared): `"appAssociation": "NONE"` on the hosting block; rewrite and headers unchanged.
- scripts/tests/test_hosting_share_links.py: asserts the option, JSON content type and Cache-Control.

## Validation

- python3 -m unittest scripts/tests/test_hosting_share_links.py. Live curl results are in the PR.

## Decisions

- The full-config docs only document `AUTO`; `NONE` is accepted by the CLI schema, verified live after deploy.

## Handoff

Team ID placeholder in the AASA file still needs the real value.
