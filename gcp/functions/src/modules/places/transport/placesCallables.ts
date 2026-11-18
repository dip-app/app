import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defaultAdminApp } from "../../accounts/transport/resolveMembershipV1";
import { FirestoreAdminStore, randomId } from "../../admin/infrastructure/firestoreAdminStore";
import { base, command, JEV_API_KEY, OPENAI_API_KEY } from "../../ai/transport/aiCallables";
import { providerFromEnv } from "../../ai/infrastructure/settings";
import { DEFAULT_DAILY_LIMIT, findVenues } from "../application/findVenues";
import { autocompletePlaces, resolvePlace } from "../application/placeLookups";
import type { LocationProvider } from "../application/ports";
import { DEFAULT_PLACES_DAILY_LIMIT } from "../application/quota";
import { refreshPlaceLocations as runRefresh } from "../application/refreshPlaceLocations";
import { setCompanyOffice } from "../application/setCompanyOffice";
import { FakePlaces } from "../infrastructure/fakePlaces";
import { FirestorePlacesRateLimiter } from "../infrastructure/firestoreBucketLimiter";
import { GooglePlaces } from "../infrastructure/googlePlaces";
import { CredentialTokenSource, defaultCredential, projectIdFromEnv } from "../infrastructure/googleToken";

function positive(raw: string | undefined, fallback: number): number {
  const value = raw && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

let google: GooglePlaces | null = null;
let fake: FakePlaces | null = null;

/**
 * The places provider and its kill switch. In the Functions emulator (demo provider) canned Pittsburgh data answers and no
 * Google call is made. Otherwise PLACES_ENABLED must be "true" and the runtime must know its project; calls then use the
 * Functions service account's OAuth token (no API key exists anywhere). Providers are per-instance singletons so the token is cached.
 */
export function placesWiring(env: NodeJS.ProcessEnv): { places: LocationProvider | null; enabled: boolean } {
  if (providerFromEnv(env) === "demo") return { places: (fake ??= new FakePlaces()), enabled: true };
  const projectId = projectIdFromEnv(env);
  if (env.PLACES_ENABLED === "true" && projectId) {
    google ??= new GooglePlaces({ tokens: new CredentialTokenSource(defaultCredential), projectId });
    return { places: google, enabled: true };
  }
  return { places: null, enabled: false };
}

const placesLimiter = () => new FirestorePlacesRateLimiter(getFirestore(defaultAdminApp()));

/**
 * The cheap place lookups (no secrets, no model call), shared by the standalone exports below and the `dipApiV1`
 * dispatcher (modules/dispatcher). findVenuesV1 stays standalone: it binds the AI secrets and may call a model.
 */
export const placeCommands = {
  autocompletePlacesV1: command("autocompletePlacesV1", async (d, caller, data) => {
    const { places, enabled } = placesWiring(process.env);
    return autocompletePlaces({
      store: d.store, places, enabled, now: d.now, limiter: placesLimiter(), dailyLimit: positive(process.env.PLACES_DAILY_LIMIT, DEFAULT_PLACES_DAILY_LIMIT),
      ...(d.log ? { log: d.log } : {}),
    }, caller, data);
  }),
  resolvePlaceV1: command("resolvePlaceV1", async (d, caller, data) => {
    const { places, enabled } = placesWiring(process.env);
    return resolvePlace({
      store: d.store, places, enabled, now: d.now, limiter: placesLimiter(), dailyLimit: positive(process.env.PLACES_DAILY_LIMIT, DEFAULT_PLACES_DAILY_LIMIT),
      ...(d.log ? { log: d.log } : {}),
    }, caller, data);
  }),
  setCompanyOfficeV1: command("setCompanyOfficeV1", async (d, caller, data) => {
    const { places, enabled } = placesWiring(process.env);
    return setCompanyOffice({
      store: d.store, places, enabled, now: d.now, newId: randomId, limiter: placesLimiter(), dailyLimit: positive(process.env.PLACES_DAILY_LIMIT, DEFAULT_PLACES_DAILY_LIMIT),
      ...(d.log ? { log: d.log } : {}),
    }, caller, data);
  }),
} as const;

/**
 * autocompletePlacesV1 (AutocompletePlacesRequest -> AutocompletePlacesResponse): address and place typeahead. event.manage
 * (organizer, admin), biased to the company office, free to admins, capped per company per day (PLACES_DAILY_LIMIT, default 400)
 * and per user per minute. Needs PLACES_ENABLED=true (else PLACES_DISABLED). Typed text is never logged.
 */
export const autocompletePlacesV1 = onCall({ ...base, timeoutSeconds: 30, memory: "256MiB", maxInstances: 10 }, placeCommands.autocompletePlacesV1);

/** resolvePlaceV1 (ResolvePlaceRequest -> ResolvePlaceResponse): resolves a picked suggestion or a typed address. Same limits as autocompletePlacesV1. */
export const resolvePlaceV1 = onCall({ ...base, timeoutSeconds: 30, memory: "256MiB", maxInstances: 10 }, placeCommands.resolvePlaceV1);

/**
 * findVenuesV1 (FindVenuesRequest -> FindVenuesResponse): Dipbot venue finder. Admin only (ai.generate), same burst limiter
 * as the other Dipbot callables. Needs AI_VENUES_ENABLED=true and PLACES_ENABLED=true (else AI_VENUES_DISABLED); no API key.
 * Ranks with Jev, then the cheap OpenAI model, then the heuristic order; charges 1 Dipbot credit only when a model ranked.
 */
export const findVenuesV1 = onCall(
  { ...base, secrets: [OPENAI_API_KEY, JEV_API_KEY], timeoutSeconds: 60, memory: "256MiB", maxInstances: 5 },
  command("findVenuesV1", async (d, caller, data) => {
    const wiring = placesWiring(process.env);
    const demo = providerFromEnv(process.env) === "demo";
    return findVenues({
      store: d.store, decisions: d.decisions, places: wiring.places, enabled: wiring.enabled && (demo || process.env.AI_VENUES_ENABLED === "true"),
      dailyLimit: positive(process.env.AI_VENUES_DAILY_LIMIT, DEFAULT_DAILY_LIMIT), placesDailyLimit: positive(process.env.PLACES_DAILY_LIMIT, DEFAULT_PLACES_DAILY_LIMIT),
      now: d.now, ...(d.limiter ? { limiter: d.limiter } : {}), ...(d.log ? { log: d.log } : {}),
    }, caller, data);
  }),
);

/** setCompanyOfficeV1 (SetCompanyOfficeRequest -> SetCompanyOfficeResponse): sets the office from a picked place. Admin only (company.manage). */
export const setCompanyOfficeV1 = onCall({ ...base, timeoutSeconds: 30, memory: "256MiB", maxInstances: 5 }, placeCommands.setCompanyOfficeV1);

/**
 * refreshPlaceLocations (daily, 04:15 UTC): keeps stored place coordinates inside Google's 30-day caching limit. Refreshes
 * upcoming events and office coordinates older than 25 days and retires the coordinates (0/0) of ended events. Retiring needs
 * no Google call, so it also runs when PLACES_ENABLED is off.
 */
export const refreshPlaceLocations = onSchedule(
  { region: "us-central1", schedule: "15 4 * * *", timeZone: "UTC", timeoutSeconds: 300, memory: "256MiB", maxInstances: 1 },
  async () => {
    const { places, enabled } = placesWiring(process.env);
    try {
      await runRefresh({
        store: new FirestoreAdminStore(getFirestore(defaultAdminApp())), places, enabled, now: () => new Date(),
        log: (event, fields, level = "info") => logger[level](event, fields),
      });
    } catch (error) {
      logger.error("places.refresh failed", { error: error instanceof Error ? error.name : "unknown" });
      throw error;
    }
  },
);
