// Typed wrappers for manageSuggestionsEmailV1 and resolveSuggestedIdeaV1. Mock mode (the local preview) answers
// in the browser; live mode calls the callables through the portal's Firebase app. Kept apart from AdminOpsApi so
// these two callables do not touch the shared API files.
//
// Mock scenarios, mock only (query on the page URL): `?sug=off` (email not enabled), `ai-off`, `unsub` (switch
// starts off), `error` (every call fails), `slow` (2.5 s). Deep link tokens in the mock: `expired`, `other`
// (permission denied); anything else resolves to a sample draft.

import { getApps } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import type { AdminApi, Session } from "./api";
import { ApiError } from "./contract";
import { apiErrorFrom } from "./firebaseAdapter";
import {
  type ManageSuggestionsResponse, type ResolveSuggestedIdeaResponse, type SuggestionsAction, type SuggestionsSchedule,
  manageRequest, resolveRequest, scheduleValid,
} from "./suggestions";

export const SUGGESTION_CALLABLES = { manage: "manageSuggestionsEmailV1", resolve: "resolveSuggestedIdeaV1" } as const;

export interface SuggestionsApi {
  manage(action: SuggestionsAction, schedule?: SuggestionsSchedule): Promise<ManageSuggestionsResponse>;
  resolveIdea(token: string): Promise<ResolveSuggestedIdeaResponse>;
}

export function suggestionsApiFor(api: AdminApi, session: Session): SuggestionsApi {
  return api.mode === "mock" ? createMockSuggestions(session) : createLiveSuggestions(session);
}

function createLiveSuggestions(session: Session): SuggestionsApi {
  const functions = () => {
    const app = getApps().find((a) => a.name === "dip-admin");
    if (!app) throw new ApiError("failed-precondition", "The portal is not connected yet. Reload the page.");
    return getFunctions(app, "us-central1");
  };
  async function call<T>(name: string, payload: unknown): Promise<T> {
    try {
      return (await httpsCallable<unknown, T>(functions(), name)(payload)).data;
    } catch (error) {
      throw apiErrorFrom(error);
    }
  }
  return {
    manage: (action, schedule) => call(SUGGESTION_CALLABLES.manage, manageRequest(session.companyId, action, schedule)),
    resolveIdea: (token) => call(SUGGESTION_CALLABLES.resolve, resolveRequest(session.companyId, token)),
  };
}

// ---------- Mock

type Scenario = "default" | "off" | "ai-off" | "unsub" | "error" | "slow";
const scenario = (): Scenario => {
  if (typeof window === "undefined") return "default";
  const v = new URLSearchParams(window.location.search).get("sug");
  return v === "off" || v === "ai-off" || v === "unsub" || v === "error" || v === "slow" ? v : "default";
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MOCK_ZONE = "America/Los_Angeles";

/** Next occurrence of weekday/hour; the company zone is approximated as UTC-8 for the preview. */
export function mockNextSend(schedule: SuggestionsSchedule, now: Date): string {
  const offsetHours = 8;
  const local = new Date(now.getTime() - offsetHours * 3600_000);
  const day = ((local.getUTCDay() + 6) % 7) + 1;
  let ahead = (schedule.weekday - day + 7) % 7;
  if (ahead === 0 && local.getUTCHours() >= schedule.hour) ahead = 7;
  const target = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + ahead, schedule.hour);
  return new Date(target + offsetHours * 3600_000).toISOString();
}


const MOCK_DRAFT = {
  title: "Lunchtime walk and talk", description: "A relaxed loop around the block with a coffee. Everyone is welcome to join for part or all of it.",
  tagIds: ["tag-fitness", "tag-outdoors"], coverImageURL: "", suggestedDaypart: "weekday_lunch" as const, durationMinutes: 45,
  venueType: "park_or_outdoors" as const, venueSearchHint: "Nearby park", costCents: 0, costNote: "", capacity: 20, isOutdoor: true,
  rationale: "Fitness is one of your top interests.",
};

function createMockSuggestions(session: Session): SuggestionsApi {
  const key = `dip.mock.suggestions.${session.companyId}`;
  type State = { subscribed: boolean; schedule: SuggestionsSchedule; lastTest: number };
  const read = (): State => {
    const base: State = { subscribed: scenario() !== "unsub", schedule: { weekday: 1, hour: 9 }, lastTest: 0 };
    try { return { ...base, ...JSON.parse(window.sessionStorage.getItem(key) ?? "{}") }; } catch { return base; }
  };
  const write = (state: State) => { try { window.sessionStorage.setItem(key, JSON.stringify(state)); } catch { /* preview only */ } };
  const gate = async () => {
    const s = scenario();
    await wait(s === "slow" ? 2500 : 350);
    if (s === "error") throw new ApiError("failed-precondition", "Something went wrong on our side. Try again in a moment.");
    if (session.role !== "admin") throw new ApiError("permission-denied", "Only admins can manage the weekly ideas email.");
  };
  return {
    async manage(action, schedule) {
      await gate();
      const state = read();
      const s = scenario();
      const emailEnabled = s !== "off";
      const aiEnabled = s !== "ai-off";
      if (action === "subscribe") state.subscribed = true;
      if (action === "unsubscribe") state.subscribed = false;
      if (action === "setSchedule") {
        if (!schedule || !scheduleValid(schedule)) throw new ApiError("invalid-argument", "Pick a day and an hour.");
        state.schedule = schedule;
      }
      const response: ManageSuggestionsResponse = {
        contractVersion: 1, subscribed: state.subscribed, emailEnabled, aiEnabled, schedule: state.schedule, timeZone: MOCK_ZONE,
        nextSendAt: state.subscribed && emailEnabled && aiEnabled ? mockNextSend(state.schedule, new Date()) : null,
      };
      if (action === "preview") {
        const sample = await import("./mocks/suggestionsPreviewHtml");
        response.preview = { subject: sample.PREVIEW_SUBJECT, preheader: sample.PREVIEW_PREHEADER, html: localAssets(sample.PREVIEW_HTML), text: sample.PREVIEW_TEXT, engine: "heuristic", ideaCount: 4, dataLevel: "some" };
      }
      if (action === "sendTest") {
        if (!emailEnabled) { response.testQueued = false; response.testReason = "COMPANY_EMAIL_DISABLED"; }
        else if (!state.subscribed) { response.testQueued = false; response.testReason = "NOT_SUBSCRIBED"; }
        else if (Date.now() - state.lastTest < 3600_000) { response.testQueued = false; response.testReason = "TEST_LIMIT"; }
        else { response.testQueued = true; state.lastTest = Date.now(); }
      }
      write(state);
      return response;
    },
    async resolveIdea(token) {
      await gate();
      if (token === "expired") throw new ApiError("failed-precondition", "This link has expired.", {}, "SUGGEST_LINK_EXPIRED");
      if (token === "other") throw new ApiError("permission-denied", "Not your company.");
      return { contractVersion: 1, ideaId: "mock-idea", draft: MOCK_DRAFT };
    },
  };
}

/** Mock only: point the email art at this portal's own copy (public/img/email) so previews render before hosting deploys. */
function localAssets(html: string): string {
  const base = typeof window === "undefined" ? "" : `${window.location.origin}/admin/img/email/`;
  return base ? html.split("https://letsdip.work/img/email/").join(base) : html;
}
