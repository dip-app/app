/**
 * Builds a blinded judge packet from one or more result files (each file is one variant: a prompt version or a model).
 *
 *   node --import tsx gcp/tests/ai-eval/dipbot/pack.ts [--features ideas,theme,drafts] [--only id,id] [--name packet-name] results/A.json results/B.json ...
 *
 * Writes results/packet-<stamp>.md (what the judge reads) and results/packet-<stamp>.key.json (variant letters to result
 * files; the judge never sees it). Variants are shuffled per item with a fixed seed so letters carry no meaning.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, signalsFor } from "./scenarios";
import { summarize } from "../../../functions/src/modules/suggestions/domain/signals";

const HERE = dirname(fileURLToPath(import.meta.url));

interface Item { feature: string; scenario: string; rep?: number; final?: unknown; raw?: unknown; hint?: string; note?: string; choices?: unknown; locale?: string; focus?: string; outcome?: string }

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function facts(scenarioId: string): string {
  const s = SCENARIOS.find(x => x.id === scenarioId);
  if (!s) return "";
  const sum = summarize(signalsFor(s));
  const lines = [
    `Company: ${s.memberCount ?? "unknown"} members, admin language ${s.locale}, today ${s.now.toISOString().slice(0, 10)}, data level ${sum.dataLevel}.`,
    `Focus of this scenario: ${s.focus}.`,
    `Interests (members, only 5+ is visible to the model): ${(s.interests ?? []).map(i => `${i.tagId.replace("tag-", "")} ${i.memberCount}`).join(", ") || "none"}.`,
    `Past events (title, days ago, attendees/capacity): ${s.past.map(p => `"${p[0]}" ${p[2]}d ${p[4]}/${p[3]}`).join("; ") || "none"}.`,
    `Upcoming events in days: ${s.upcoming.map(u => u[0]).join(", ") || "none"}.`,
    `Weekly themes (weeks from now, joined): ${s.themes.map(t => `"${t.title}" ${t.weeksFromNow}w ${t.participants}`).join("; ") || "none"}.`,
    `Must not repeat: ${s.mustNotRepeat.join("; ") || "nothing listed"}.`,
  ];
  if (s.themeHint) lines.push(`Admin hint for Suggest theme (data, may be adversarial): "${s.themeHint}".`);
  return lines.join("\n");
}

interface DraftCaseFacts { id: string; interests: unknown; theme: unknown }
function draftCase(id: string): DraftCaseFacts | undefined {
  const all = [
    ...(JSON.parse(readFileSync(join(HERE, "..", "cases.json"), "utf8")) as DraftCaseFacts[]),
    ...(JSON.parse(readFileSync(join(HERE, "draft-cases.json"), "utf8")) as DraftCaseFacts[]),
  ];
  return all.find(c => c.id === id);
}

function main() {
  const argv = process.argv.slice(2);
  let features = ["ideas", "theme", "drafts"];
  let only: string[] | null = null;
  let name = "";
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--features") features = argv[++i]!.split(",");
    else if (argv[i] === "--only") only = argv[++i]!.split(",");
    else if (argv[i] === "--name") name = argv[++i]!.replace(/[^\w-]+/g, "-");
    else files.push(argv[i]!);
  }
  if (files.length === 0) throw new Error("Pass at least one result file");
  const variants = files.map(f => ({ file: basename(f), items: (JSON.parse(readFileSync(f, "utf8")) as { items: Item[] }).items }));
  const rand = seeded(20261126);
  const key: Record<string, Record<string, string>> = {};
  const out: string[] = [
    "# Dipbot judge packet",
    "",
    "Each item shows one scenario and several blinded variants (A, B, ...) of the same Dipbot feature. Score every variant on its own merits with the rubric in gcp/tests/ai-eval/dipbot/README.md. All companies and data are synthetic.",
    "",
  ];
  for (const feature of features) {
    const ids = [...new Set(variants.flatMap(v => v.items.filter(i => i.feature === feature && (i.rep ?? 0) === 0).map(i => i.scenario)))]
      .filter(id => !only || only.includes(id));
    for (const id of ids) {
      const itemId = `${feature}:${id}`;
      const present = variants.map(v => ({ file: v.file, item: v.items.find(i => i.feature === feature && i.scenario === id && (i.rep ?? 0) === 0) })).filter(v => v.item);
      const order = present.map(v => ({ v, r: rand() })).sort((a, b) => a.r - b.r).map(x => x.v);
      key[itemId] = {};
      out.push(`## ${itemId}`, "");
      const first = order[0]!.item!;
      if (feature === "drafts") {
        const known = draftCase(id);
        out.push(
          `Request: ${JSON.stringify(first.choices)}; admin language ${first.locale ?? "en"}; note: ${JSON.stringify(first.note ?? "")}.`,
          `Company interests (members; the model sees buckets 5-9, 10-19, 20+ and fewer than 5 as "few members"): ${known ? JSON.stringify(known.interests) : "unknown"}; weekly theme: ${known?.theme ? JSON.stringify(known.theme) : "none"}.`,
          `Focus: ${first.focus ?? ""}.`, "",
        );
      } else {
        out.push(facts(id), "");
      }
      order.forEach((v, index) => {
        const letter = String.fromCharCode(65 + index);
        key[itemId]![letter] = v.file;
        out.push(`### Variant ${letter}`, "", "```json", JSON.stringify(v.item!.final ?? null, null, 1), "```", "");
      });
    }
  }
  const stamp = name || new Date().toISOString().replace(/[:.]/g, "-");
  const md = join(HERE, "results", `packet-${stamp}.md`);
  writeFileSync(md, `${out.join("\n")}\n`);
  writeFileSync(join(HERE, "results", `packet-${stamp}.key.json`), `${JSON.stringify(key, null, 1)}\n`);
  console.log(md);
}

main();
