import type { Firestore } from "firebase-admin/firestore";
import type { PastEventSource } from "../application/suggestions";
import type { DecisionPort, DecisionRequest, DecisionResult } from "../application/ports";
import type { PastEventInput } from "../domain/suggestions";
import { benignDecision } from "./fakes";

/** How many recent past events feed the counts. */
const RECENT_EVENTS = 60;

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  const maybe = value as { toDate?: () => Date } | null;
  return maybe && typeof maybe.toDate === "function" ? maybe.toDate() : null;
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

/**
 * Recent past events of the company (`companies/{c}/events`), reduced at once to the five fields the counts need. Titles,
 * descriptions, venues, creators and attendees are never read into the result.
 */
export class FirestorePastEvents implements PastEventSource {
  constructor(private readonly db: Firestore) {}

  async recent(companyId: string, now: Date): Promise<PastEventInput[]> {
    const snap = await this.db.collection(`companies/${companyId}/events`)
      .where("startTime", "<", now).orderBy("startTime", "desc").limit(RECENT_EVENTS).get();
    return snap.docs.flatMap(doc => {
      const data = doc.data();
      const startTime = toDate(data.startTime);
      if (!startTime || data.status === "cancelled") return [];
      return [{
        startTime,
        costCents: count(data.costCents),
        capacity: count(data.capacity),
        isOutdoor: data.isOutdoor === true,
        tagIds: Array.isArray(data.tagIds) ? data.tagIds.filter((id): id is string => typeof id === "string").slice(0, 10) : [],
      }];
    });
  }
}

/** Offline provider for the emulator and AI_PROVIDER=demo: benign typed answers, labelled as Jev so the portal shows the tag. */
export class DemoSuggestionDecisions implements DecisionPort {
  async decide(request: DecisionRequest): Promise<DecisionResult> {
    return { ...benignDecision(request), usage: { inputTokens: 400, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }, model: "demo", provider: "jev" };
  }
}
