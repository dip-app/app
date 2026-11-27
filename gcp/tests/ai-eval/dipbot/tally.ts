/**
 * Merges judge scores with hard checks, cost and latency per variant (result file).
 *
 *   node --import tsx gcp/tests/ai-eval/dipbot/tally.ts results/packet-<stamp>.key.json results/packet-<stamp>.scores.json results/A.json results/B.json ...
 *
 * scores.json is the judge's output: [{ "item": "ideas:co-01-rich", "variant": "A", "scores": { ... 1-5 each }, "overall": 1-10, "issues": [] }].
 * Without a key and scores file (pass "-" for both) it prints only the hard checks, cost and latency.
 */
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

interface Item {
  feature: string; scenario: string; rep?: number; outcome?: string; micros?: number; latencyMs?: number; agentMs?: number; turns?: number; tools?: string[];
  tokensIn?: number; tokensOut?: number; checks?: { problems?: number } & Record<string, unknown>; agentKept?: number;
  correct?: boolean; pickedHit?: boolean; lexicalHit?: boolean; top1Hit?: boolean; heuristicHit?: boolean; source?: string;
}
interface Score { item: string; variant: string; scores: Record<string, number>; overall: number; issues?: string[] }

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const p50 = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]!; };
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "-");

function main() {
  const [keyPath, scoresPath, ...files] = process.argv.slice(2);
  const key = keyPath && keyPath !== "-" && existsSync(keyPath) ? JSON.parse(readFileSync(keyPath, "utf8")) as Record<string, Record<string, string>> : {};
  const scores = scoresPath && scoresPath !== "-" && existsSync(scoresPath) ? JSON.parse(readFileSync(scoresPath, "utf8")) as Score[] : [];
  const byFile = new Map<string, Score[]>();
  for (const s of scores) {
    const file = key[s.item]?.[s.variant];
    if (!file) continue;
    byFile.set(file, [...(byFile.get(file) ?? []), s]);
  }
  for (const path of files) {
    const file = basename(path);
    const data = JSON.parse(readFileSync(path, "utf8")) as { label: string; spentMicros: number; items: Item[] };
    console.log(`\n== ${data.label} (${file}), spent $${(data.spentMicros / 1e6).toFixed(4)}`);
    const features = [...new Set(data.items.map(i => i.feature))];
    for (const feature of features) {
      const items = data.items.filter(i => i.feature === feature);
      const judged = (byFile.get(file) ?? []).filter(s => s.item.startsWith(`${feature}:`));
      const dims = [...new Set(judged.flatMap(s => Object.keys(s.scores)))];
      const dimText = dims.map(d => `${d} ${f1(avg(judged.map(s => s.scores[d]!).filter(Number.isFinite)))}`).join(", ");
      const cost = avg(items.map(i => i.micros ?? 0)) / 1e6;
      if (feature === "triage") {
        console.log(`triage: accuracy ${items.filter(i => i.correct).length}/${items.length}, avg $${cost.toFixed(5)}, p50 ${p50(items.map(i => i.latencyMs ?? 0))} ms`);
      } else if (feature === "cover") {
        console.log(`cover: model hit ${items.filter(i => i.pickedHit).length}/${items.length}, lexical hit ${items.filter(i => i.lexicalHit).length}/${items.length}, dipbot source ${items.filter(i => i.source === "dipbot").length}, p50 ${p50(items.map(i => i.latencyMs ?? 0))} ms`);
      } else if (feature === "venue") {
        console.log(`venue: model top-1 ${items.filter(i => i.top1Hit).length}/${items.length}, nearest-first ${items.filter(i => i.heuristicHit).length}/${items.length}, p50 ${p50(items.map(i => i.latencyMs ?? 0))} ms`);
      } else {
        const ok = items.filter(i => (i.outcome ?? "ok") === "ok" && (i.checks as { valid?: boolean } | undefined)?.valid !== false).length;
        console.log(
          `${feature}: n=${items.length}, answered ${ok}/${items.length}, hard problems ${items.reduce((s, i) => s + (i.checks?.problems ?? 0), 0)} (avg ${f1(avg(items.map(i => i.checks?.problems ?? 0)))}), `
          + `judge overall ${f1(avg(judged.map(s => s.overall)))} [${dimText || "not judged"}], avg cost $${cost.toFixed(5)}, `
          + `latency p50 ${p50(items.map(i => i.latencyMs ?? 0))} ms mean ${Math.round(avg(items.map(i => i.latencyMs ?? 0)))} ms, turns ${f1(avg(items.map(i => i.turns ?? 0)))}, `
          + `tokens in/out ${Math.round(avg(items.map(i => i.tokensIn ?? 0)))}/${Math.round(avg(items.map(i => i.tokensOut ?? 0)))}`,
        );
        const keys = new Set(items.flatMap(i => Object.keys(i.checks ?? {})));
        const breakdown = [...keys].filter(k => !["problems", "answered", "countOk", "valid", "rawCount", "count", "distinctThemes", "distinctIllustrations"].includes(k))
          .map(k => [k, items.reduce((s, i) => s + (typeof i.checks?.[k] === "number" ? (i.checks[k] as number) : 0), 0)] as const)
          .filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ");
        if (breakdown) console.log(`  checks: ${breakdown}`);
      }
    }
  }
}

main();
