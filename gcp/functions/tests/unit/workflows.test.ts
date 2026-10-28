import { test } from "node:test";

// Pending feature tests: these are a development checklist, not coverage.
test.todo("company joining rejects unauthenticated and invalid-code requests");
test.todo("commands reject access to another company");
test.todo("organizer commands reject member privileges");
test.todo("RSVP retries do not duplicate participation or increment counts twice");
test.todo("concurrent RSVPs cannot exceed event capacity");
test.todo("attendance and challenge approval award points once");
test.todo("reward redemption cannot overspend points or exhaust inventory twice");
