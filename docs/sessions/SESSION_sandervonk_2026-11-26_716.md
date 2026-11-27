# Work session

User: sandervonk
Date: 2026-11-26
Workstream: privacy-processors
Agent: Codex
Status: completed

## Summary

The privacy policy no longer matched production: email is on and sent through Resend (the page said the provider would be named before the first email), the day-before reminder is on by default (the page said reminders you turn on), and Dipbot's ideas and theme suggestions now send the company's own past event and theme titles to OpenAI (the page said never event titles). Places and Pixabay were not mentioned.

## Changes

- apps/landing/privacy/index.html: Service providers section updated to name Resend and ImprovMX, list the email kinds, describe what Dipbot sends now, and add Google Maps Platform (Places) and Pixabay.

## Validation

- Checked each statement against the code: themeAgent and ideaAgent do-not-repeat lists, covers liveQuery word filter, places callables, email provider config.

## Decisions

- Needs the owner's approval before merge because it is legal text.

## Handoff

Owner reviews the wording; deploy hosting after merge.

