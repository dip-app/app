import { strict as assert } from "node:assert";
import { describe, test } from "node:test";
import { auditDocument } from "../../functions/src/modules/admin/domain/audit";
import { AUDIT_SUMMARY_KEYS, named } from "../../functions/src/modules/admin/domain/auditSummaries";
import { AdminError } from "../../functions/src/modules/admin/domain/errors";
import { toHttpsError as adminToHttpsError } from "../../functions/src/modules/admin/transport/adminCallables";
import { toHttpsError as organizerToHttpsError } from "../../functions/src/modules/organizer/transport/organizerCallables";
import { OrganizerError } from "../../functions/src/modules/organizer/domain/errors";
import { ERROR_MESSAGES, errorMessageDetails } from "../../functions/src/modules/i18n";

const actor = { uid: "u1", name: "Ada", role: "admin" as const };
const base = { id: "a1", action: "member.update" as const, targetType: "member" as const, targetId: "m1", summary: "Updated Ada: name" };

describe("auditDocument summary keys", () => {
  test("writes the key and string params", () => {
    const doc = auditDocument("c1", actor, { ...base, summaryKey: "member.update", summaryParams: { name: "Ada", fields: "name", count: 3 } });
    assert.equal(doc.summary, "Updated Ada: name");
    assert.equal(doc.summaryKey, "member.update");
    assert.deepEqual(doc.summaryParams, [{ name: "name", value: "Ada" }, { name: "fields", value: "name" }, { name: "count", value: "3" }]);
  });

  test("omits key and params when absent", () => {
    const doc = auditDocument("c1", actor, base);
    assert.equal("summaryKey" in doc, false);
    assert.equal("summaryParams" in doc, false);
  });

  test("a key without params writes no params", () => {
    const doc = auditDocument("c1", actor, { ...base, summaryKey: "roster.claim" });
    assert.equal(doc.summaryKey, "roster.claim");
    assert.equal("summaryParams" in doc, false);
  });

  test("clips values to 280 characters and keeps at most 10 params", () => {
    const params = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`p${i}`, "x".repeat(400)]));
    const doc = auditDocument("c1", actor, { ...base, summaryKey: "member.update", summaryParams: params });
    assert.equal(doc.summaryParams?.length, 10);
    assert.ok(doc.summaryParams?.every((p) => [...p.value].length === 280));
  });

  test("summary keys are dotted lower camel and unique", () => {
    const pattern = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;
    assert.ok(AUDIT_SUMMARY_KEYS.every((key) => pattern.test(key) && key.length <= 80));
    assert.equal(new Set(AUDIT_SUMMARY_KEYS).size, AUDIT_SUMMARY_KEYS.length);
  });

  test("named() flags a missing name", () => {
    assert.deepEqual(named("Ada"), { known: "yes", name: "Ada" });
    assert.deepEqual(named(undefined, "email"), { emailKnown: "no", email: "" });
  });
});

describe("error message keys", () => {
  test("English values are unique", () => {
    const values = Object.values(ERROR_MESSAGES);
    assert.equal(new Set(values).size, values.length);
  });

  test("exact message", () => {
    assert.deepEqual(errorMessageDetails("Member not found."), { messageKey: "errors.memberNotFound" });
  });

  test("parameterized message", () => {
    assert.deepEqual(errorMessageDetails("At most 5000 rows per import."), { messageKey: "errors.importTooLarge.rows", messageParams: { max: 5000 } });
  });

  test("unknown message", () => {
    assert.deepEqual(errorMessageDetails("Something nobody wrote down."), {});
  });

  test("admin toHttpsError adds messageKey and keeps reason, fields and message", () => {
    const error = adminToHttpsError(new AdminError("invalid-argument", "VALIDATION_FAILED", "Invalid request.", ["b", "a"]));
    assert.equal(error.message, "Invalid request.");
    assert.deepEqual(error.details, { reason: "VALIDATION_FAILED", fields: ["b", "a"], messageKey: "errors.validationFailed" });
  });

  test("admin toHttpsError keeps extra details and gives internal errors the generic key", () => {
    const credits = adminToHttpsError(new AdminError("resource-exhausted", "AI_CREDITS_EXHAUSTED", "This company has used this month's Dipbot credits.", [], { creditsRemaining: 0 }));
    assert.deepEqual(credits.details, { reason: "AI_CREDITS_EXHAUSTED", creditsRemaining: 0, messageKey: "errors.aiCreditsExhausted" });
    const internal = adminToHttpsError(new AdminError("internal", "INVALID_STORED_DATA", "Invalid stored import."));
    assert.equal(internal.message, "Something went wrong. Try again later.");
    assert.equal((internal.details as { messageKey: string }).messageKey, "errors.generic");
    assert.equal((adminToHttpsError(new Error("boom")).details as { messageKey: string }).messageKey, "errors.generic");
  });

  test("an unknown message leaves the details without a key", () => {
    const error = adminToHttpsError(new AdminError("not-found", "MEMBER_NOT_FOUND", "Custom text."));
    assert.deepEqual(error.details, { reason: "MEMBER_NOT_FOUND" });
  });

  test("organizer toHttpsError adds messageKey", () => {
    const error = organizerToHttpsError(new OrganizerError("aborted", "REVISION_CONFLICT", "Someone else changed this event. Reload it and try again."));
    assert.deepEqual(error.details, { reason: "REVISION_CONFLICT", messageKey: "errors.revisionConflict.event" });
  });
});
