import type { AiEventChoices } from "../../../generated/models";
import { AdminError, invalid } from "../../admin/domain/errors";
import { BUDGETS, GOALS, GROUP_SIZES, LIMITS, SETTINGS, TIMINGS } from "./vocabulary";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedGenerateRequest {
  companyId: string;
  requestId: string;
  choices: AiEventChoices;
  prompt: string;
  count: number;
}

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

/** Throws when `record` does not have exactly the `allowed` keys. */
function exactKeys(record: Rec, allowed: readonly string[], prefix: string) {
  const name = (key: string) => (prefix ? `${prefix}.${key}` : key);
  const extra = Object.keys(record).filter(key => !allowed.includes(key)).map(name);
  const missing = allowed.filter(key => !(key in record)).map(name);
  if (extra.length || missing.length) throw invalid([...extra, ...missing]);
}

function oneOf<T extends string>(record: Rec, key: string, values: readonly T[], bad: string[]): T {
  const value = record[key];
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    bad.push(`choices.${key}`);
    return values[0]!;
  }
  return value as T;
}

export function parseContextRequest(data: unknown): { companyId: string } {
  if (!isRecord(data)) throw invalid(["request"]);
  exactKeys(data, ["contractVersion", "companyId"], "");
  const bad: string[] = [];
  if (data.contractVersion !== 1) bad.push("contractVersion");
  if (typeof data.companyId !== "string" || !ID_PATTERN.test(data.companyId)) bad.push("companyId");
  if (bad.length) throw invalid(bad);
  return { companyId: data.companyId as string };
}
const LINE_BREAKS = new RegExp("\\r\\n?|\\u2028|\\u2029", "g");

/** Normalizes the admin note: NFKC, no control, format or bidi characters, tidy whitespace. Never rewrites words. */
export function sanitizeNote(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(LINE_BREAKS, "\n")
    .replace(/\t/g, " ")
    .replace(/(?!\n)[\p{Cc}\p{Cf}]/gu, "")
    .replace(/ {2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const TLDS = "com|org|net|io|co|app|dev|ai|edu|gov|info|biz|xyz|ly|us|uk|ca|de|tv|me|site|online|store|link|page|club";
const URL_SCHEME = /\bhttps?:\/\//i;
const WWW = /\bwww\./i;
const BARE_DOMAIN = new RegExp(`(?<![\\w@.-])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})(?![a-z0-9-])`, "i");
const EMAIL = /[\w.+%-]+@[\w-]+(?:\.[\w-]+)+/;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
const PHONE_CANDIDATE = /(?<![\d$])\+?\(?\d[\d\s().-]{4,}\d(?!\d)/g;

function looksLikePhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  const groups = candidate.split(/\D+/).filter(Boolean);
  // Plain runs of 7+ digits, or separated groups where at least one has 3+ digits (not "10 20 30 40").
  return groups.length === 1 || groups.some(group => group.length >= 3);
}

/** True when text carries a link, an email address or a phone number (none belong in a note or a draft). */
export function containsContactInfo(text: string): boolean {
  if (URL_SCHEME.test(text) || WWW.test(text) || EMAIL.test(text) || BARE_DOMAIN.test(text)) return true;
  const withoutDates = text.replace(ISO_DATE, " ");
  for (const match of withoutDates.matchAll(PHONE_CANDIDATE)) if (looksLikePhone(match[0])) return true;
  return false;
}

export function parseGenerateRequest(data: unknown, catalogIds: ReadonlySet<string>): ParsedGenerateRequest {
  if (!isRecord(data)) throw invalid(["request"]);
  exactKeys(data, ["contractVersion", "companyId", "requestId", "choices", "prompt", "count"], "");
  const bad: string[] = [];
  if (data.contractVersion !== 1) bad.push("contractVersion");
  if (typeof data.companyId !== "string" || !ID_PATTERN.test(data.companyId)) bad.push("companyId");
  if (typeof data.requestId !== "string" || !UUID_PATTERN.test(data.requestId)) bad.push("requestId");
  if (!Number.isInteger(data.count) || (data.count as number) < 1 || (data.count as number) > LIMITS.draftsMax) bad.push("count");

  let choices: AiEventChoices = { focusTagIds: [], goal: GOALS[0], groupSize: GROUP_SIZES[0], setting: SETTINGS[0], budget: BUDGETS[0], timing: TIMINGS[0] };
  if (!isRecord(data.choices)) bad.push("choices");
  else {
    const raw = data.choices;
    exactKeys(raw, ["focusTagIds", "goal", "groupSize", "setting", "budget", "timing"], "choices");
    const focus = raw.focusTagIds;
    let focusTagIds: string[] = [];
    if (
      !Array.isArray(focus) || focus.length > LIMITS.focusTagsMax || new Set(focus).size !== focus.length ||
      !focus.every(id => typeof id === "string" && catalogIds.has(id))
    ) bad.push("choices.focusTagIds");
    else focusTagIds = focus as string[];
    choices = {
      focusTagIds,
      goal: oneOf(raw, "goal", GOALS, bad),
      groupSize: oneOf(raw, "groupSize", GROUP_SIZES, bad),
      setting: oneOf(raw, "setting", SETTINGS, bad),
      budget: oneOf(raw, "budget", BUDGETS, bad),
      timing: oneOf(raw, "timing", TIMINGS, bad),
    };
  }

  let prompt = "";
  if (typeof data.prompt !== "string" || data.prompt.length > LIMITS.promptMax) bad.push("prompt");
  else {
    prompt = sanitizeNote(data.prompt);
    if (prompt.length > LIMITS.promptMax) bad.push("prompt");
  }
  if (bad.length) throw invalid(bad);
  if (containsContactInfo(prompt)) {
    throw new AdminError("invalid-argument", "AI_PROMPT_REJECTED", "Leave out links, email addresses and phone numbers.", ["prompt"]);
  }
  return {
    companyId: data.companyId as string,
    requestId: data.requestId as string,
    choices,
    prompt,
    count: data.count as number,
  };
}
