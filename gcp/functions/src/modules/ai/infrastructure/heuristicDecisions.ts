import type { DecisionAnswer, DecisionPort, DecisionQuestion, DecisionRequest, DecisionResult } from "../application/ports";

/**
 * Last-resort decision provider: deterministic keyword rules, no network, no cost. It runs only when Jev and the OpenAI
 * fallback both failed. Free moderation, the validators and human review still stand in front of and behind it.
 * Noul answers are 0.9 on a rule hit and 0.1 otherwise (0.5 for questions it has no rule for); a Choice it cannot
 * settle gets a low confidence so the server keeps its own pick; a Score is the middle level with flat probabilities.
 */
export const HEURISTIC_MODEL = "heuristic-v1";

const RULES: Readonly<Record<string, RegExp>> = {
  injection: /\b(?:ignore|disregard|forget|override)\b[^.]{0,40}\b(?:instructions?|rules?|prompts?|above|previous)\b|\bsystem prompt\b|\byou are now\b|\bact as\b|\bpretend\b|\bjailbreak\b|\bdeveloper mode\b|\breveal\b|\boutput format\b/i,
  unsafe: /\b(?:weapons?|guns?|firearms?|shooting range|drugs?|cannabis|strip clubs?|strippers?|nude|sex(?:ual|y)?|drinking games?|beer pong|keg|open bar|bar crawl|pub crawl|shots|gambl\w*|casino|fight club|men only|women only|no (?:women|men|old|older)\b|hate|harass\w*)\b/i,
  offTopic: /\b(?:write|generate|give me)\b[^.]{0,20}\b(?:code|essay|poem|script|function|program|homework|story)\b|\btranslate\b|\bstock (?:tips?|picks?)\b|\bcrypto\w*\b|\bbitcoin\b/i,
  personalData: /\b(?:diagnos\w*|pregnan\w*|salary|salaries|pay grade|fired|performance (?:review|issues?|plan)|disabilit\w*|divorc\w*|medical|cancer|therapy|rehab|illness|sick leave)\b/i,
};

const COVER_WORDS: Readonly<Record<string, RegExp>> = {
  cooking: /\b(?:cook\w*|food|meal|lunch|potluck|tasting|bak\w*|chef|kitchen|picnic|pizza|taco|recipe)\b/i,
  hiking: /\b(?:hik\w*|trail|walk\w*|nature|forest|mountain)\b/i,
  fitness: /\b(?:fitness|yoga|run\w*|sport\w*|workout|exercise|stretch\w*|soccer|basketball|volleyball|climb\w*|dance)\b/i,
  outdoors: /\b(?:outdoor\w*|park|kayak\w*|paddle\w*|garden\w*|beach|lake|river|cleanup)\b/i,
  games: /\b(?:game\w*|trivia|quiz|puzzle\w*|board|escape room|bowling|karaoke)\b/i,
};

function answer(question: DecisionQuestion, id: string, text: string): DecisionAnswer {
  if (question.type === "noul") {
    const rule = Object.hasOwn(RULES, id) ? RULES[id] : undefined;
    return { type: "noul", noul: rule ? (rule.test(text) ? 0.9 : 0.1) : 0.5 };
  }
  if (question.type === "choice") {
    const options = Object.keys(question.criteria);
    const hit = options.find(option => Object.hasOwn(COVER_WORDS, option) && COVER_WORDS[option]!.test(text));
    const choice = hit ?? options[0]!;
    const top = hit ? 0.6 : 1 / options.length;
    const rest = options.length > 1 ? (1 - top) / (options.length - 1) : 0;
    return { type: "choice", choice, confidence: top, probabilities: Object.fromEntries(options.map(o => [o, o === choice ? top : rest])) };
  }
  const levels = question.criteria.length;
  const flat = 1 / levels;
  return {
    type: "score", score: Math.floor((levels - 1) / 2), confidence: flat,
    probabilities: Object.fromEntries(question.criteria.map((_, i) => [String(i), flat])),
  };
}

export class HeuristicDecisions implements DecisionPort {
  async decide(request: DecisionRequest): Promise<DecisionResult> {
    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, question] of Object.entries(request.questions)) answers[id] = answer(question, id, request.state);
    return { answers, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }, model: HEURISTIC_MODEL, provider: "heuristic" };
  }
}
