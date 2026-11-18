import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Keeps the shared kit (components/kit, docs/design/admin-components.md) from eroding: pages and components use
// Button, Chip/ChipToggle, InlineNotice and the rest instead of writing the classes by hand.
const SRC = join(__dirname, "..", "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" || name === "kit" ? [] : files(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}
const sources = files(SRC).map((f) => ({ file: relative(SRC, f), text: readFileSync(f, "utf8") }));
// Skeletons mirror the markup of the real thing, so they spell the classes out on purpose.
const isSkeleton = (file: string) => /Skeleton/.test(file);

function offenders(pattern: RegExp, allow: string[] = []): string[] {
  return sources.filter((s) => !isSkeleton(s.file) && !allow.includes(s.file) && pattern.test(s.text)).map((s) => s.file);
}

describe("shared kit guard", () => {
  it("no hand-written .pill-btn buttons or links: use Button", () => {
    // The import page's file picker is a <label> that must look like a button.
    expect(offenders(/className=(\{`|")pill-btn/, ["app/import/page.tsx"])).toEqual([]);
  });

  it("no hand-written informational pills or filter chips: use Chip and ChipToggle", () => {
    expect(offenders(/className=(\{`|")info-pill/)).toEqual([]);
    expect(offenders(/<button[^>]*className="chip\b/)).toEqual([]);
  });

  it("no hand-written error banners outside the files still to migrate: use InlineNotice", () => {
    const pending = ["app/members/detail/page.tsx", "components/EventForm.tsx", "components/ThemeForm.tsx", "app/import/page.tsx"];
    expect(offenders(/className="banner error"/, pending)).toEqual([]);
  });

  it("no hand-written Dipbot action with a cost in its label: use DipbotAction", () => {
    expect(offenders(/credits?<\/|\bcredits?\}\s*<\/button/i)).toEqual([]);
  });
});
