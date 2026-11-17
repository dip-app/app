# Work session

User: sandervonk
Date: 2026-11-17
Workstream: email-button-contrast
Agent: Claude
Status: completed

## Summary

Primary purple email button: white label in light mode, ink (#1E212B) label in dark mode.

## Changes

- gcp/functions/src/modules/email/domain/templates/layout.ts (inline white base, label wrapped in span.btn-t, dark override for .btn-a/.btn-t in prefers-color-scheme and [data-ogsc])
- gcp/tests/unit/email-templates.test.ts, gcp/tests/unit/__snapshots__/email/*
- docs/ops/email-compatibility.md (rule section, checklist wording)

## Validation

- npm run check:email: No errors
- node --import tsx --test email-templates, email-admin-suggestions, email-compat unit tests: pass
- Screenshots at 600px light/dark (invite, reminder, event-updated, admin suggestions) reviewed by a design auditor subagent

## Decisions

- Owner decision: ink on purple in dark for contrast (about 5.2:1 vs 3.1:1 white). Classic Outlook VML fallback stays white. Outlined admin Start button has no fill and is unchanged.

## Handoff

None; no deploy or sends.

