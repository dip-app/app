import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_CATEGORIES, AUDIT_LABELS, aiFacts, auditAction, auditCategoriesInUse, humanizeAction, isAiAction } from "../auditLabels";
import { auditCsv } from "../exports";
import type { AuditEntry } from "../adminTypes";

const FUNCTIONS_SRC = join(__dirname, "../../../../../gcp/functions/src");

/** The keys the backend can write: the `AUDIT_ACTIONS` array in auditActions.ts (one quoted string per line). */
function backendActions(): string[] {
  const source = readFileSync(join(FUNCTIONS_SRC, "modules/admin/domain/auditActions.ts"), "utf8");
  const body = /AUDIT_ACTIONS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(source)?.[1] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "generated" ? [] : sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe("audit action labels", () => {
  const actions = backendActions();

  it("reads a plausible backend list", () => {
    expect(actions.length).toBeGreaterThanOrEqual(20);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("labels every action the backend can write", () => {
    const missing = actions.filter((a) => !AUDIT_LABELS[a]);
    expect(missing, `Add a label in apps/admin/src/lib/auditLabels.ts for: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no label for an action the backend no longer lists", () => {
    const stale = Object.keys(AUDIT_LABELS).filter((k) => !actions.includes(k));
    expect(stale).toEqual([]);
  });

  it("writes every audit action literal through the typed list", () => {
    // Any `action: "x.y"` in a file that writes audit entries must be in AUDIT_ACTIONS (the type enforces it too).
    const used = new Set<string>();
    for (const file of sourceFiles(FUNCTIONS_SRC)) {
      const text = readFileSync(file, "utf8");
      if (!/writeAudit\(|auditDocument\(/.test(text)) continue;
      for (const line of text.split("\n")) {
        const m = /\baction:\s*(.*)$/.exec(line);
        if (!m) continue;
        for (const q of m[1].matchAll(/"([a-z]+(?:\.[A-Za-z]+)+)"/g)) used.add(q[1]);
      }
    }
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((a) => !actions.includes(a))).toEqual([]);
  });

  it("gives every label a sentence-style text and a known category", () => {
    for (const [key, { label, category }] of Object.entries(AUDIT_LABELS)) {
      expect(AUDIT_CATEGORIES, key).toContain(category);
      expect(label, key).toMatch(/^[A-Z]/);
      expect(label, key).not.toMatch(/[—–]|\.$/);
      expect(label, key).not.toBe(key);
      expect(label.toLowerCase(), key).not.toContain("openai");
    }
  });

  it("only lists categories that have actions", () => {
    const used = auditCategoriesInUse();
    for (const c of used) expect(Object.values(AUDIT_LABELS).some((l) => l.category === c)).toBe(true);
    expect(used).toContain("AI");
  });

  it("names the brand correctly", () => {
    expect(auditAction("ai.generateDrafts")).toEqual({ label: "Generated event drafts with Dipbot", category: "AI", known: true });
  });
});

describe("humanizeAction fallback", () => {
  it("splits dots and camelCase and keeps acronyms", () => {
    expect(humanizeAction("ai.generateDrafts")).toBe("AI generate drafts");
    expect(humanizeAction("rsvpListExport")).toBe("RSVP list export");
    expect(humanizeAction("event.cancel")).toBe("Event cancel");
    expect(humanizeAction("member.photo_url.sync")).toBe("Member photo URL sync");
    expect(humanizeAction("CSVImport")).toBe("CSV import");
    expect(humanizeAction("dipbot.reply")).toBe("Dipbot reply");
  });

  it("never returns the raw key or an empty string", () => {
    expect(humanizeAction("")).toBe("Unknown action");
    expect(humanizeAction("...")).toBe("Unknown action");
    expect(humanizeAction("tags.backfill")).not.toContain(".");
  });

  it("labels unknown keys through auditAction as not known", () => {
    expect(auditAction("tags.backfillIcons")).toEqual({ label: "Tags backfill icons", category: "Settings", known: false });
    expect(auditAction("toString").known).toBe(false);
  });
});

describe("AI audit facts", () => {
  it("shows credits and counts, never cost or content", () => {
    const facts = aiFacts([
      { field: "models", before: "", after: "gpt-5-mini" },
      { field: "tokens", before: "", after: "100 in, 50 out" },
      { field: "credits", before: "", after: "10" },
      { field: "costUsd", before: "", after: "0.02" },
      { field: "prompt", before: "", after: "secret note" },
    ]);
    expect(facts).toEqual([
      { label: "Model", value: "gpt-5-mini" },
      { label: "Tokens", value: "100 in, 50 out" },
      { label: "Credits used", value: "10" },
    ]);
    expect(isAiAction("ai.noteDeclined")).toBe(true);
    expect(isAiAction("member.update")).toBe(false);
  });
});

describe("audit CSV", () => {
  it("exports the label, the raw key and the category", () => {
    const entry: AuditEntry = { id: "1", at: "2026-11-18T10:00:00Z", actorId: "u", actorName: "Ada", actorRole: "admin", action: "ai.generateDrafts", targetType: "company", targetId: "acme", summary: "Generated 3", changes: [] };
    const [header, row] = auditCsv([entry]).trim().split(/\r?\n/);
    expect(header).toContain("action key");
    expect(row).toContain("Generated event drafts with Dipbot");
    expect(row).toContain("ai.generateDrafts");
    expect(row).toContain("AI");
  });
});
