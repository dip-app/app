import type { AdminOpsApi } from "../adminApi";
import { ApiError } from "../contract";
import { LocationError, type LocationProvider, isAbort } from "./types";

export * from "./types";

/** Server answers worth telling apart: PLACES_DISABLED (not set up) and PLACES_LIMIT (resting for today). */
export function toLocationError(error: unknown): unknown {
  if (isAbort(error) || error instanceof LocationError) return error;
  const reason = error instanceof ApiError ? error.reason : undefined;
  return new LocationError(reason === "PLACES_DISABLED" ? "disabled" : reason === "PLACES_LIMIT" ? "limit" : reason === "PLACE_NOT_FOUND" ? "notFound" : "failed");
}

/**
 * The live and mock adapter: every call goes through the admin api (autocompletePlacesV1 / resolvePlaceV1). Callables
 * cannot be cancelled, so an aborted call is ignored when it returns: the caller sees an AbortError instead.
 */
export function createCallableProvider(api: Pick<AdminOpsApi, "autocompletePlaces" | "resolvePlace">): LocationProvider {
  const guard = async <T,>(work: Promise<T>, signal?: AbortSignal): Promise<T> => {
    let result: T;
    try { result = await work; } catch (error) { throw toLocationError(error); }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return result;
  };
  return {
    name: "callable",
    autocomplete: (input, { sessionToken, signal }) => guard(api.autocompletePlaces(input, sessionToken), signal),
    resolve: (request) => guard(api.resolvePlace(request)).catch((error: unknown) => {
      // A typed address the server cannot place is simply "not found"; a stale place id is reported so the admin picks again.
      if ("query" in request && error instanceof LocationError && error.kind === "notFound") return null;
      throw error;
    }),
  };
}
