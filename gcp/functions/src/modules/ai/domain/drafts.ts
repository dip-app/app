import { z } from "zod";
import type { AiEventChoices, EventDraft, GeneratedEventDraft } from "../../../generated/models";
import { APPROVED_COVER_URLS, LIMITS as ORGANIZER_LIMITS } from "../../organizer/domain/eventDraft";
import { coverURLFor } from "./covers";
import { modelDraftsSchema } from "./prompt";
import { containsContactInfo } from "./request";
import { BUDGET_CENTS, DAYPARTS, GROUP_CAPACITY, LIMITS, VENUE_TYPES } from "./vocabulary";

const TAG_ID = /^[A-Za-z0-9_-]{1,128}$/;
const approvedCover = z.string().refine(url => APPROVED_COVER_URLS.has(url));
const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length;

/** Mirrors the contract GeneratedEventDraft bounds exactly; the last gate before a draft leaves the server. */
export const GeneratedEventDraftSchema = z.strictObject({
  title: z.string().min(1).max(LIMITS.titleMax),
  description: z.string().min(1).max(LIMITS.descriptionMax),
  tagIds: z.array(z.string().regex(TAG_ID)).min(1).max(LIMITS.tagsPerDraftMax).refine(uniqueIds),
  coverImageURL: approvedCover,
  suggestedDaypart: z.enum(DAYPARTS),
  durationMinutes: z.number().int().min(LIMITS.durationMin).max(LIMITS.durationMax),
  venueType: z.enum(VENUE_TYPES),
  venueSearchHint: z.string().max(LIMITS.venueHintMax),
  costCents: z.number().int().min(0).max(LIMITS.costCentsMax),
  costNote: z.string().max(LIMITS.costNoteMax),
  capacity: z.number().int().min(1).max(10_000),
  isOutdoor: z.boolean(),
  rationale: z.string().min(1).max(LIMITS.rationaleMax),
});

/** The createEventV1 EventDraft fields the admin form pre-fills from a generated draft (organizer LIMITS). */
export const EventDraftPrefillSchema = z.strictObject({
  title: z.string().min(1).max(ORGANIZER_LIMITS.titleMax),
  description: z.string().min(1).max(ORGANIZER_LIMITS.descriptionMax),
  tagIds: z.array(z.string().regex(TAG_ID)).max(ORGANIZER_LIMITS.maxTags).refine(uniqueIds),
  coverImageURL: approvedCover,
  costCents: z.number().int().min(0),
  costNote: z.string().max(ORGANIZER_LIMITS.textMax),
  capacity: z.number().int().min(ORGANIZER_LIMITS.capacityMin).max(ORGANIZER_LIMITS.capacityMax),
  isOutdoor: z.boolean(),
});

export type EventDraftPrefill = Pick<EventDraft, "title" | "description" | "tagIds" | "coverImageURL" | "costCents" | "costNote" | "capacity" | "isOutdoor">;

/** Fields of a generated draft that map onto createEventV1; the admin adds venue, start and end. Throws if out of bounds. */
export function toEventDraftPrefill(draft: GeneratedEventDraft): EventDraftPrefill {
  return EventDraftPrefillSchema.parse({
    title: draft.title,
    description: draft.description,
    tagIds: [...draft.tagIds],
    coverImageURL: draft.coverImageURL,
    costCents: draft.costCents,
    costNote: draft.costNote,
    capacity: draft.capacity,
    isOutdoor: draft.isOutdoor,
  });
}

/** The model returned nothing usable; the caller reports AI_OUTPUT_INVALID. */
export class InvalidModelOutput extends Error {}

export interface DraftContext { count: number; choices: AiEventChoices; catalogIds: ReadonlySet<string> }

type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

/** Strips markdown and control characters, tidies whitespace and clamps to `max` characters at a word boundary. */
export function cleanText(value: string, max: number): string {
  const text = value
    .split(/\r\n?|\n/)
    .map(line => line
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ""))
    .join("\n")
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .normalize("NFKC")
    .replace(/\t/g, " ")
    .replace(/(?!\n)[\p{Cc}\p{Cf}]/gu, "")
    .replace(/ {2,}/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const points = Array.from(text);
  if (points.length <= max) return text;
  const cut = points.slice(0, max).join("");
  const lastSpace = cut.search(/\s\S*$/);
  const base = lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut;
  return base.trimEnd();
}

/** Links, email addresses and phone numbers are never allowed in a draft. */
export function hasForbiddenContent(text: string): boolean {
  return containsContactInfo(text);
}

const DAYPART_FOR_TIMING: Record<AiEventChoices["timing"], GeneratedEventDraft["suggestedDaypart"]> = {
  weekday_lunch: "weekday_lunch",
  after_work: "after_work",
  weekend: "weekend_daytime",
};
const VENUE_FOR_SETTING: Record<AiEventChoices["setting"], GeneratedEventDraft["venueType"]> = {
  indoors: "activity_venue",
  outdoors: "park_or_outdoors",
  offsite: "activity_venue",
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function parseOne(raw: unknown, ctx: DraftContext): GeneratedEventDraft | null {
  if (!isRecord(raw)) return null;
  const textOf = (key: string, max: number, required: boolean): string | null => {
    const value = raw[key];
    if (typeof value !== "string") return null;
    const text = cleanText(value, max);
    if (hasForbiddenContent(text)) return null;
    return required && text === "" ? null : text;
  };
  const title = textOf("title", LIMITS.titleMax, true);
  const description = textOf("description", LIMITS.descriptionMax, true);
  const venueSearchHint = textOf("venueSearchHint", LIMITS.venueHintMax, false);
  const costNote = textOf("costNote", LIMITS.costNoteMax, false);
  const rationale = textOf("rationale", LIMITS.rationaleMax, true);
  if (title === null || description === null || venueSearchHint === null || costNote === null || rationale === null) return null;
  if (!Array.isArray(raw.tagIds)) return null;
  if (typeof raw.durationMinutes !== "number" || !Number.isFinite(raw.durationMinutes)) return null;
  if (typeof raw.costCents !== "number" || !Number.isFinite(raw.costCents)) return null;
  if (typeof raw.capacity !== "number" || !Number.isFinite(raw.capacity)) return null;
  if (typeof raw.isOutdoor !== "boolean") return null;

  let tagIds = [...new Set(raw.tagIds.filter((id): id is string => typeof id === "string" && ctx.catalogIds.has(id)))].slice(0, LIMITS.tagsPerDraftMax);
  if (tagIds.length === 0) {
    const fallback = ctx.choices.focusTagIds[0];
    if (fallback === undefined) return null;
    tagIds = [fallback];
  }

  const budget = BUDGET_CENTS[ctx.choices.budget];
  const group = GROUP_CAPACITY[ctx.choices.groupSize];
  const daypart = (DAYPARTS as readonly unknown[]).includes(raw.suggestedDaypart)
    ? (raw.suggestedDaypart as GeneratedEventDraft["suggestedDaypart"])
    : DAYPART_FOR_TIMING[ctx.choices.timing];
  const venueType = (VENUE_TYPES as readonly unknown[]).includes(raw.venueType)
    ? (raw.venueType as GeneratedEventDraft["venueType"])
    : VENUE_FOR_SETTING[ctx.choices.setting];
  const durationMinutes = clamp(Math.round(raw.durationMinutes / 15) * 15, LIMITS.durationMin, LIMITS.durationMax);
  const costCents = ctx.choices.budget === "free"
    ? 0
    : clamp(clamp(Math.round(raw.costCents), budget.min, budget.max), 0, LIMITS.costCentsMax);
  const capacity = clamp(clamp(Math.round(raw.capacity), group.min, group.max), 1, 10_000);

  return {
    title,
    description,
    tagIds,
    coverImageURL: coverURLFor(raw.coverCategory, tagIds),
    suggestedDaypart: daypart,
    durationMinutes,
    venueType,
    venueSearchHint,
    costCents,
    costNote,
    capacity,
    isOutdoor: raw.isOutdoor,
    rationale,
  };
}

/**
 * Validates untrusted model output in three layers: the zod output schema (shape, enums, catalog tag ids), a per-draft
 * repair (clean text, drop forbidden content, clamp numbers, map the cover, dedupe) and the contract schema. Bad drafts
 * are dropped; no usable draft at all throws InvalidModelOutput.
 */
export function parseModelDrafts(value: unknown, ctx: DraftContext): GeneratedEventDraft[] {
  const shape = modelDraftsSchema([...ctx.catalogIds]).safeParse(value);
  if (!shape.success) throw new InvalidModelOutput("output does not match the schema");
  const seen = new Set<string>();
  const out: GeneratedEventDraft[] = [];
  for (const raw of shape.data.drafts) {
    if (out.length >= ctx.count) break;
    const repaired = parseOne(raw, ctx);
    if (!repaired) continue;
    const checked = GeneratedEventDraftSchema.safeParse(repaired);
    if (!checked.success) continue;
    const draft: GeneratedEventDraft = { ...checked.data, tagIds: [...checked.data.tagIds] };
    const key = draft.title.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(draft);
  }
  if (out.length === 0) throw new InvalidModelOutput("no valid drafts");
  return out;
}
