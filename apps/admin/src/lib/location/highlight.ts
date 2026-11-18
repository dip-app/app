export interface Part { text: string; match: boolean }

/** Splits `text` so the words the admin typed can be shown in bold. Case-insensitive; a word matches where it starts a word. */
export function highlightParts(text: string, query: string): Part[] {
  const words = Array.from(new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0))).sort((a, b) => b.length - a.length);
  if (!words.length || !text) return [{ text, match: false }];
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join("|")})`, "giu");
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), match: false });
    parts.push({ text: m[0], match: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts.length ? parts : [{ text, match: false }];
}
