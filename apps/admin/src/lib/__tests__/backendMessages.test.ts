import { afterEach, describe, expect, it } from "vitest";
import { auditSummary } from "../auditLabels";
import { apiErrorFrom } from "../firebaseAdapter";
import { en } from "../i18n/catalog/en";
import { es } from "../i18n/catalog/es";
import { setLocale, translate } from "../i18n";

afterEach(() => setLocale("en"));

/** English sentences the server stores, with the key and params it writes beside them. */
const SERVER_SAMPLES: [key: string, params: Record<string, string>, summary: string][] = [
  ["roster.invite", { email: "a@b.co" }, "Invited a@b.co"],
  ["roster.revoke", { emailKnown: "no", email: "" }, "Revoked the invitation for a person"],
  ["roster.resend", { emailKnown: "yes", email: "a@b.co", number: "3" }, "Resent the invite for a@b.co (#3)"],
  ["roster.backfill", { added: "4", existing: "1", skipped: "0" }, "Added existing members to the roster: 4 added, 1 already listed, 0 skipped"],
  ["attendance.checkInPoints", { event: "Trivia", points: "25" }, "Checked in a member at Trivia (+25 points)"],
  ["photo.remove", { uploaderKnown: "yes", uploader: "Ada", eventKnown: "no", event: "" }, "Removed photo by Ada from an event"],
  ["import.plan", { rows: "1200", create: "10", update: "5", invalid: "2" }, "Planned an employee import of 1200 rows (10 new, 5 updates, 2 invalid)"],
  ["member.update", { known: "yes", name: "Ada", fields: "role, teamIds" }, "Updated Ada: role, teamIds"],
  ["member.deactivate", { known: "no", name: "" }, "Deactivated a member"],
  ["points.adjust", { delta: "+5" }, "Adjusted points by +5"],
  ["event.status", { title: "Picnic", status: "completed" }, "Marked the event \"Picnic\" completed"],
  ["ai.generated", { count: "1" }, "Generated 1 AI event draft"],
  ["ai.generated", { count: "3" }, "Generated 3 AI event drafts"],
];

describe("audit summaries", () => {
  it("English catalog text equals the server's English summary", () => {
    for (const [key, params, summary] of SERVER_SAMPLES) {
      expect(auditSummary({ summary: "stored", summaryKey: key, summaryParams: params })).toBe("stored");
      const vars = Object.fromEntries(Object.entries(params).map(([name, value]) => [name, /^-?\d+$/.test(value) ? Number(value) : value]));
      expect(translate("en", `audit.summary.${key}`, vars)).toBe(summary);
    }
  });

  it("shows the stored English summary in English, for old entries and unknown keys", () => {
    expect(auditSummary({ summary: "Invited a@b.co", summaryKey: "roster.invite", summaryParams: { email: "a@b.co" } })).toBe("Invited a@b.co");
    setLocale("es");
    expect(auditSummary({ summary: "Invited a@b.co" })).toBe("Invited a@b.co");
    expect(auditSummary({ summary: "Something", summaryKey: "nope.unknown" })).toBe("Something");
  });

  it("renders Spanish from the key and params, keeping content as sent", () => {
    setLocale("es");
    expect(auditSummary({ summary: "Invited a@b.co", summaryKey: "roster.invite", summaryParams: { email: "a@b.co" } })).toBe("Invitó a a@b.co");
    expect(auditSummary({ summary: "x", summaryKey: "event.create", summaryParams: { title: "007" } })).toBe("Creó el evento “007”");
    expect(auditSummary({ summary: "x", summaryKey: "ai.generated", summaryParams: { count: "1" } })).toBe("Generó 1 borrador de evento con IA");
    expect(auditSummary({ summary: "x", summaryKey: "member.reset", summaryParams: { known: "no", name: "" } })).toBe("Restableció el perfil de un miembro");
  });
});

describe("typed error messages", () => {
  const wire = (details: Record<string, unknown>, message = "Member not found.") => ({ code: "functions/not-found", message, details });

  it("keeps the server message in English", () => {
    const error = apiErrorFrom(wire({ reason: "MEMBER_NOT_FOUND", messageKey: "errors.memberNotFound" })) as Error;
    expect(error.message).toBe("Member not found.");
    expect(error).toMatchObject({ messageKey: "errors.memberNotFound", reason: "MEMBER_NOT_FOUND" });
  });

  it("uses the catalog text outside English, for the message and the field errors", () => {
    setLocale("es");
    const error = apiErrorFrom({ code: "functions/invalid-argument", message: "Invalid request.", details: { reason: "VALIDATION_FAILED", fields: ["title"], messageKey: "errors.validationFailed" } }) as { message: string; fields: Record<string, string> };
    expect(error.message).toBe(es["errors.validationFailed"]);
    // A bare "Invalid request." under a field says nothing; the field gets "Check this field." instead.
    expect(error.fields).toEqual({ title: es["failure.field"] });
  });

  it("fills params and falls back to the server text for unknown keys", () => {
    setLocale("es");
    const rows = apiErrorFrom(wire({ messageKey: "errors.importTooLarge.rows", messageParams: { max: 5000 } }, "At most 5000 rows per import.")) as Error;
    expect(rows.message).toBe("Máximo 5000 filas por importación.");
    expect(apiErrorFrom(wire({ messageKey: "errors.notInTheCatalog" }, "Server text.")) as Error).toHaveProperty("message", "Server text.");
    expect(apiErrorFrom(wire({}, "Plain.")) as Error).toHaveProperty("message", "Plain.");
  });

  it("the errors catalog has the same keys in both languages", () => {
    const keys = Object.keys(en).filter((key) => key.startsWith("errors."));
    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) expect(es).toHaveProperty([key]);
  });
});
