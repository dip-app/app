// Routes the portal's light callables through the single warm `dipApiV1` dispatcher (docs/design/functions-dispatcher.md).
// The standalone callables stay deployed, so this is a transport choice only: same payloads, responses and errors.
// Rollback is NEXT_PUBLIC_ADMIN_DISPATCHER=off at build time, or deleting dipApiV1 (the portal then falls back by itself).

/** Commands dipApiV1 serves; mirrors gcp/functions/src/modules/dispatcher/transport/registry.ts. */
export const DISPATCHED_COMMANDS: ReadonlySet<string> = new Set([
  "removeEventPhotoV1", "removeEventPhotoCommentV1", "addEventAttendeeV1", "removeEventAttendeeV1", "recordAttendanceV1",
  "listMembersV1", "getMemberV1", "updateMemberV1", "resetMemberProfileV1", "adjustMemberPointsV1",
  "upsertRosterEntryV1", "revokeRosterEntryV1", "resendRosterInviteV1", "listRosterV1", "getEmployeeImportV1",
  "listBugReportsV1", "getBugReportV1", "updateBugReportV1", "getCompanyInsightsV1",
  "createEventV1", "updateEventV1", "createChallengeV1", "updateChallengeV1",
  "listChallengeSubmissionsV1", "approveChallengeV1", "rejectChallengeV1",
  "autocompletePlacesV1", "resolvePlaceV1", "setCompanyOfficeV1",
]);

export const DISPATCHER_CALLABLE = "dipApiV1";

/** On unless the build sets NEXT_PUBLIC_ADMIN_DISPATCHER to off, false or 0. Referenced statically so Next.js inlines it. */
export function dispatcherEnabled(value: string | undefined = process.env.NEXT_PUBLIC_ADMIN_DISPATCHER): boolean {
  return !["off", "false", "0"].includes((value ?? "").trim().toLowerCase());
}

/** Calls one callable by name and resolves with its response data. */
export type CallableTransport = (name: string, data: unknown) => Promise<unknown>;
export type CallableInvoker = <T>(name: string, data: unknown) => Promise<T>;

/**
 * Why a dispatcher call may be retried on the standalone callable:
 * - `unknown-command`: this dispatcher build doesn't serve the command (older backend). Retry; use direct for it from now on.
 * - `unreachable`: dipApiV1 is missing or not answering (404 without details, 503, or the browser's status-0 network/CORS
 *   failure that a missing function produces). Retry; use direct for every command for the rest of the page session.
 * - `none`: a real answer from the command (including its own not-found, e.g. MEMBER_NOT_FOUND). Never retried.
 */
export function dispatcherFailure(error: unknown): "none" | "unknown-command" | "unreachable" {
  if (typeof error !== "object" || error === null) return "none";
  const raw = (error as { code?: unknown }).code;
  const code = typeof raw === "string" ? raw.replace(/^functions\//, "") : "";
  const details = (error as { details?: { reason?: unknown } }).details;
  const reason = typeof details?.reason === "string" ? details.reason : undefined;
  const message = String((error as { message?: unknown }).message ?? "");
  if (code === "not-found") return reason === "UNKNOWN_COMMAND" ? "unknown-command" : reason === undefined ? "unreachable" : "none";
  if (code === "unavailable" && reason === undefined) return "unreachable";
  // The SDK reports a fetch that never got an HTTP answer as internal with status 0 ("internal [0]"; older SDKs: "internal").
  if (code === "internal" && reason === undefined && (message.endsWith("[0]") || message === "internal")) return "unreachable";
  return "none";
}

/**
 * Wraps a transport so dispatched commands go through dipApiV1 and fall back to the standalone callable.
 * A fallback is safe to repeat: mutating admin commands carry a requestId (receipt replay) or expectedRevision.
 */
export function createCallableInvoker(call: CallableTransport, enabled: boolean = dispatcherEnabled()): CallableInvoker {
  let unreachable = false;
  const directOnly = new Set<string>();
  return async <T>(name: string, data: unknown): Promise<T> => {
    if (!enabled || unreachable || !DISPATCHED_COMMANDS.has(name) || directOnly.has(name)) return (await call(name, data)) as T;
    try {
      return (await call(DISPATCHER_CALLABLE, { command: name, payload: data })) as T;
    } catch (error) {
      const failure = dispatcherFailure(error);
      if (failure === "none") throw error;
      if (failure === "unknown-command") directOnly.add(name);
      else unreachable = true;
      return (await call(name, data)) as T;
    }
  };
}
