import { z } from "zod";
import type { AiEventChoices } from "../../../generated/models";
import { AdminError, invalid } from "../../admin/domain/errors";
import { isConsiderationId, MAX_CONSIDERATIONS } from "./considerations";
import { BUDGETS, GOALS, GROUP_SIZES, LIMITS, SETTINGS, TIMINGS } from "./vocabulary";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedGenerateRequest {
  companyId: string;
  requestId: string;
  choices: AiEventChoices;
  prompt: string;
  /** Catalog consideration ids (accessibility, food, vibe, ...), validated and unique. */
  considerations: string[];
  count: number;
}

const companyId = z.string().regex(ID_PATTERN);

/** Strict schema of getEventIdeaContextV1. */
export const ContextRequestSchema = z.strictObject({ contractVersion: z.literal(1), companyId });

/**
 * Field paths of a failed parse as VALIDATION_FAILED fields: dotted paths ("choices.goal"), unknown keys named by
 * their own path, list members reported on the list. An unparseable body is reported as "request".
 */
export function fieldsOf(error: z.ZodError): string[] {
  const fields = new Set<string>();
  for (const issue of error.issues) {
    const path = issue.path.map(String);
    const numeric = path.findIndex(part => /^\d+$/.test(part));
    const base = (numeric === -1 ? path : path.slice(0, numeric)).join(".");
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) fields.add(base ? `${base}.${key}` : key);
    } else {
      fields.add(base || "request");
    }
  }
  return [...fields];
}

export function parseContextRequest(data: unknown): { companyId: string } {
  const parsed = ContextRequestSchema.safeParse(data);
  if (!parsed.success) throw invalid(fieldsOf(parsed.error));
  return { companyId: parsed.data.companyId };
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

const promptField = z.string().max(LIMITS.promptMax)
  .transform(sanitizeNote)
  .pipe(z.string().max(LIMITS.promptMax));

/** Strict schema of generateEventDraftsV1; focus tags must be unique catalog ids. */
export function GenerateRequestSchema(catalogIds: ReadonlySet<string>) {
  return z.strictObject({
    contractVersion: z.literal(1),
    companyId,
    requestId: z.string().regex(UUID_PATTERN),
    choices: z.strictObject({
      focusTagIds: z.array(z.string()).max(LIMITS.focusTagsMax)
        .refine(ids => new Set(ids).size === ids.length)
        .refine(ids => ids.every(id => catalogIds.has(id))),
      goal: z.enum(GOALS),
      groupSize: z.enum(GROUP_SIZES),
      setting: z.enum(SETTINGS),
      budget: z.enum(BUDGETS),
      timing: z.enum(TIMINGS),
    }),
    prompt: promptField,
    considerations: z.array(z.string()).max(MAX_CONSIDERATIONS)
      .refine(ids => new Set(ids).size === ids.length)
      .refine(ids => ids.every(isConsiderationId)).default([]),
    count: z.number().int().min(1).max(LIMITS.draftsMax),
  });
}

export function parseGenerateRequest(data: unknown, catalogIds: ReadonlySet<string>): ParsedGenerateRequest {
  const parsed = GenerateRequestSchema(catalogIds).safeParse(data);
  if (!parsed.success) throw invalid(fieldsOf(parsed.error));
  const { choices, prompt, ...rest } = parsed.data;
  if (containsContactInfo(prompt)) {
    throw new AdminError("invalid-argument", "AI_PROMPT_REJECTED", "Leave out links, email addresses and phone numbers.", ["prompt"]);
  }
  return { ...rest, choices: { ...choices, focusTagIds: [...choices.focusTagIds] }, prompt, considerations: [...rest.considerations] };
}
