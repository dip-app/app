import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "../api";
import { applyMapping, columnLetter, dataRowsOf, forgetMapping, guessHeaderRow, loadSavedMapping, mapRow, mappingFromSaved, mappingIssues, saveMapping, suggestMapping } from "../importMapping";

const memory = (): KeyValueStore => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

describe("column suggestions", () => {
  it("matches headers by name and skips what it doesn't know", () => {
    expect(suggestMapping(["Work Email", "Full Name", "Dept", "Office", "Employee ID", "Reports To", "Hire Date", "Job Title", "Squad"])).toEqual([
      "email", "displayName", "department", "workLocation", "skip", "managerEmail", "startDate", "jobTitle", "teams",
    ]);
  });
  it("suggests each field once", () => {
    expect(suggestMapping(["Email", "Email Address", "Name"])).toEqual(["email", "skip", "displayName"]);
  });
});

describe("mapping checks", () => {
  it("requires email and rejects a field used twice", () => {
    expect(mappingIssues(["displayName", "skip"]).errors[0]).toMatch(/email/i);
    expect(mappingIssues(["email", "email"]).errors.join()).toMatch(/more than one/);
    expect(mappingIssues(["email", "displayName"]).errors).toEqual([]);
    expect(mappingIssues(["email"]).warnings[0]).toMatch(/name/i);
  });
});

describe("applying a mapping", () => {
  const sheet = [
    ["Acme staff export"], [],
    ["Who", "Mail", "Squad", "Notes"],
    ["Sam Rivera", "SAM@acme.com", "Platform; Design", "x"],
    [],
    ["Lee Chen", "lee@other.com", "", ""],
  ];
  it("keeps spreadsheet row numbers, reads the chosen header row and skips empty rows", () => {
    expect(guessHeaderRow(sheet)).toBe(2);
    const parsed = applyMapping(sheet, 2, ["displayName", "email", "teams", "skip"], "acme.com");
    expect(parsed.lines).toEqual([4, 6]);
    expect(parsed.rows[0]).toMatchObject({ email: "sam@acme.com", displayName: "Sam Rivera", teams: ["Platform", "Design"] });
    expect(parsed.localErrors.has(4)).toBe(false);
    expect(parsed.localErrors.get(6)?.join()).toContain("@acme.com");
    expect(parsed.unknownColumns).toEqual(["Notes"]);
    expect(dataRowsOf(sheet, 2).map((r) => r.line)).toEqual([4, 6]);
  });
  it("refuses a mapping without email and files that are empty or too large", () => {
    expect(applyMapping(sheet, 2, ["displayName", "skip", "teams", "skip"], "acme.com").fatal).toMatch(/email/i);
    expect(applyMapping([["email"]], 0, ["email"], "acme.com").fatal).toMatch(/no rows/);
    const big = [["email"], ...Array.from({ length: 2001 }, (_, i) => [`u${i}@acme.com`])];
    expect(applyMapping(big, 0, ["email"], "acme.com").fatal).toMatch(/2000/);
  });
  it("maps one row with blanks left empty", () => {
    expect(mapRow(["A@Acme.com", "Ann"], ["email", "displayName"])).toMatchObject({ email: "a@acme.com", displayName: "Ann", role: "", teams: [], startDate: "" });
  });
});

describe("saved mapping", () => {
  it("is stored per company by header name and reused for a file with the same headers", () => {
    const store = memory();
    const headers = ["Who", "Mail", "Squad", "Notes"];
    saveMapping(store, "acme", headers, ["displayName", "email", "teams", "skip"]);
    const saved = loadSavedMapping(store, "acme")!;
    expect(loadSavedMapping(store, "globex")).toBeNull();
    // Same headers in a different order, plus a new column that falls back to the suggestion.
    expect(mappingFromSaved(["Mail", "Notes", "Who", "Department"], saved)).toEqual(["email", "skip", "displayName", "department"]);
  });
  it("is ignored when the file looks different, and can be forgotten", () => {
    const store = memory();
    saveMapping(store, "acme", ["Who", "Mail"], ["displayName", "email"]);
    const saved = loadSavedMapping(store, "acme")!;
    expect(mappingFromSaved(["A", "B", "C", "D"], saved)).toBeNull();
    forgetMapping(store, "acme");
    expect(loadSavedMapping(store, "acme")).toBeNull();
  });
  it("copes with unreadable storage", () => {
    const broken: KeyValueStore = { getItem: () => "{nope", setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    expect(loadSavedMapping(broken, "acme")).toBeNull();
    expect(() => saveMapping(broken, "acme", ["Mail"], ["email"])).not.toThrow();
  });
});

describe("column letters", () => {
  it("counts like a spreadsheet", () => {
    expect([columnLetter(0), columnLetter(25), columnLetter(26), columnLetter(27)]).toEqual(["A", "Z", "AA", "AB"]);
  });
});
