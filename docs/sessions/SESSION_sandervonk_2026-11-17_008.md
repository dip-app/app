# Work session

User: sandervonk
Date: 2026-11-17
Workstream: email-setup-short
Agent: Claude
Status: completed

## Summary

Shortened the email setup guide to the owner's exact Postmark and Squarespace steps.

## Changes

docs/ops/email-setup.md rewritten (short); old content moved to docs/ops/email-runbook.md.

## Validation

check-docs links.

## Decisions

Keep Squarespace SPF and empty _domainkey; set DMARC to p=none first; Postmark bounce domain handles SPF.

## Handoff

Owner does Squarespace forwards, Postmark account and DNS records, then the token.

