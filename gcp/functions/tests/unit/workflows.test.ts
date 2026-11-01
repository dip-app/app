import { test } from "node:test";

// Pending feature tests: these are a development checklist, not coverage.
// Company joining is covered by the executable gcp/tests/unit/accounts*.test.ts suites.
test.todo("commands reject access to another company");
test.todo("organizer commands reject member privileges");
test.todo("RSVP retries do not duplicate participation or increment counts twice");
test.todo("concurrent RSVPs cannot exceed event capacity");
test.todo("attendance and challenge approval award points once");
test.todo("reward redemption cannot overspend points or exhaust inventory twice");
