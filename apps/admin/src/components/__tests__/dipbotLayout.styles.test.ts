import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// jsdom has no layout, so the phone-width rules are guarded at the source: they are what keeps the credits line from
// overflowing at 320px, keeps the Refresh icon, clamps the why line, and keeps disabled Dipbot actions readable.
const styles = (name: string) => readFileSync(join(__dirname, "..", "..", "styles", name), "utf8");
const ideas = styles("_ideas.scss");
const action = styles("_dipbot-action.scss");

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const token = (name: string) => action.match(new RegExp(`\\$${name}:\\s*(#[0-9a-fA-F]{6})`))![1]!;

describe("disabled DipbotAction contrast (WCAG AA)", () => {
  it("label and credit count on the disabled wash are at least 4.5:1", () => {
    expect(ratio(token("da-muted"), token("da-off"))).toBeGreaterThanOrEqual(4.5);
    // The label (color) and the cost (.credit-cost) use the same token when disabled.
    expect(action).toContain("background: $da-off; color: $da-muted; box-shadow: none; .credit-cost { color: $da-muted;");
  });
});

describe("Dipbot header and credits layout", () => {
  it("the credits line wraps instead of overflowing: the header wraps and the meter text may break", () => {
    expect(ideas).toMatch(/\.ideas-head \{[^}]*flex-wrap: wrap/);
    expect(ideas).toMatch(/\.credits-meter \{[^}]*max-width: 100%[^}]*min-width: 0/);
    expect(ideas).not.toMatch(/\.credits-text \{ white-space: nowrap/);
  });

  it("the Refresh button keeps its icon at phone widths", () => {
    expect(ideas).not.toMatch(/\.ifu-refresh \.dip-action-icon \{ display: none/);
    expect(ideas).not.toMatch(/\.sh--stack \.sh-end[^}]*dip-action-icon[^}]*display: none/);
  });

  it("the why line is clamped to two lines with an ellipsis", () => {
    expect(ideas).toMatch(/\.ifu-why \{[^}]*-webkit-line-clamp: 2[^}]*text-overflow: ellipsis/);
  });

  it("narrow headers put the actions on their own row so the title and updated text keep their width", () => {
    expect(ideas).toContain('grid-template-areas: "mark title toggle" "when when when" "hint hint hint" "end end end"');
  });
});
