// @i18n-migrated
// One place that turns any thrown value into plain-language copy. Pages never print `error.message` themselves:
// the Firebase SDK appends the HTTP status ("Invalid request. [400]", "internal [0]") and transport errors carry
// codes, so everything shown to a person goes through `userError()`. See docs/design/admin-components.md.

import { tMaybe } from "./aiStrings";
import { ApiError } from "./contract";
import { type MessageKey, hasMessage, isCatalogText, t, translate } from "./i18n";

export type ErrorKind =
  | "message" // a sentence of our own or the server's, safe to show as is
  | "network" | "busy" | "signedOut" | "permission" | "rateLimit" | "validation" | "notFound" | "conflict" | "unavailable" | "unknown";

export interface UserError {
  /** A short heading, only when the surface asked for one (`options.title`). */
  title?: string;
  /** One or two plain sentences. Never a status code, an error code or a reason key. */
  message: string;
  /** Trying the same thing again may work (offline, busy, unknown). False for permission, validation, not found. */
  retryable: boolean;
  kind: ErrorKind;
  /** True when the message is the generic copy for its kind, not a sentence about this action. */
  generic?: boolean;
}

export interface UserErrorOptions {
  /** The surface's own sentence for an unknown failure ("The export didn’t finish. Try again."). */
  fallback?: string;
  /** What "not found" means here ("This event no longer exists."). */
  notFound?: string;
  title?: string;
  /** A Dipbot surface: a busy service is "Dipbot is busy", not "DIP is busy". */
  dipbot?: boolean;
  /** Fields the failure flagged; without any, a validation failure says the change was not accepted. */
  hasFields?: boolean;
}

const KIND_COPY: Record<Exclude<ErrorKind, "message">, MessageKey> = {
  network: "failure.network",
  busy: "failure.busy",
  signedOut: "failure.signedOut",
  permission: "failure.permission",
  rateLimit: "failure.rateLimit",
  validation: "failure.validation",
  notFound: "failure.notFound",
  conflict: "failure.conflict",
  unavailable: "failure.unavailable",
  unknown: "failure.unknown",
};

const RETRYABLE: Record<ErrorKind, boolean> = {
  message: false, network: true, busy: true, signedOut: false, permission: false, rateLimit: true, validation: false,
  notFound: false, conflict: true, unavailable: true, unknown: true,
};

/** Firebase callable, Firestore, Auth and Storage codes (prefix stripped) mapped to a kind. */
const CODE_KIND: Record<string, Exclude<ErrorKind, "message">> = {
  unauthenticated: "signedOut",
  "user-token-expired": "signedOut",
  "requires-recent-login": "signedOut",
  "permission-denied": "permission",
  unauthorized: "permission",
  "invalid-argument": "validation",
  "out-of-range": "validation",
  "not-found": "notFound",
  "object-not-found": "notFound",
  aborted: "conflict",
  "already-exists": "conflict",
  "failed-precondition": "unavailable",
  "resource-exhausted": "rateLimit",
  "too-many-requests": "rateLimit",
  "quota-exceeded": "rateLimit",
  unavailable: "busy",
  "deadline-exceeded": "busy",
  "network-request-failed": "network",
  "retry-limit-exceeded": "network",
  internal: "unknown",
  unknown: "unknown",
  "data-loss": "unknown",
  unimplemented: "unknown",
  cancelled: "unknown",
  canceled: "unknown",
};

/**
 * Server reasons with their own sentence. Reasons that need numbers or dates (AI_DAILY_LIMIT, AI_CREDITS_EXHAUSTED)
 * are worded by the surface that has them; here they fall back to the code's copy.
 */
const REASON_COPY: Readonly<Record<string, () => string>> = {
  AI_VENUES_DISABLED: () => t("failure.venuesOff"),
  PLACES_DISABLED: () => t("failure.venuesOff"),
};
const AI_REASONS = [
  "AI_BUDGET_EXHAUSTED", "AI_FLAG_LIMIT", "AI_OUTPUT_INVALID", "AI_UNAVAILABLE", "REQUEST_IN_PROGRESS", "REQUEST_REUSED",
  "INSUFFICIENT_ROLE", "VENUE_SEARCH_LIMIT", "OFFICE_NOT_SET",
];

/** Server messages that say nothing a person can act on: the code's copy replaces them. */
const VAGUE_KEYS: readonly MessageKey[] = ["errors.validationFailed", "errors.generic"];
const vagueText = () => new Set([...VAGUE_KEYS.map((key) => translate("en", key)), "Request failed."]);

/** The " [400]" the Firebase SDK appends to every callable error message. */
const STATUS_SUFFIX = /\s*\[\d{1,3}\]\s*$/;

/**
 * Text a person must never see: status codes, reason keys, SDK wording. `presentable()` rejects a message that
 * matches any of these, and the guardrail test (userError.test.ts) runs them over every catalog message in en and es.
 */
export const LEAK_PATTERNS: readonly RegExp[] = [
  /\[\d{1,3}\]/, // "[400]", "[0]"
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/, // reason keys: AI_VENUES_DISABLED
  /\b(?:functions|firestore|auth|storage|appCheck|app-check|installations)\/[a-z-]+/i, // SDK code prefixes
  /\bFirebase\b/i,
  /\bBackend error status\b/i,
  /\bHTTP\b|\bstatus code\b/i,
  /\b(?:TypeError|ReferenceError|SyntaxError|FirebaseError|FunctionsError)\b/,
];

/** LEAK_PATTERNS plus what only makes sense for a caught error's text (a bare code word, a URL, a stack frame). */
export const TECHNICAL_PATTERNS: readonly RegExp[] = [
  ...LEAK_PATTERNS,
  /\b(?:undefined|null|NaN)\b/,
  /^[a-z]+(?:[-_][a-z]+)*\.?$/, // a bare code: "internal", "permission-denied"
  /https?:\/\//,
  /\bat \S+ \(/, // a stack frame
];

/** True when `text` reads as a sentence for people: no codes, keys, URLs or SDK wording. */
export function presentable(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !TECHNICAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Removes the SDK's " [400]" suffix. Everything else is left for `presentable()` to judge. */
export function stripStatus(text: string): string {
  return text.replace(STATUS_SUFFIX, "");
}

function codeOf(error: object): string | null {
  const raw = (error as { code?: unknown }).code;
  return typeof raw === "string" ? raw.replace(/^[a-z-]+\//i, "") : null;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function kindOfCode(code: string | null, message: string): Exclude<ErrorKind, "message"> {
  // The SDK reports a request that never got an answer (offline, blocked, CORS) as "internal [0]".
  if (code === "internal" && /\[0\]\s*$/.test(message)) return "network";
  return (code && CODE_KIND[code]) || "unknown";
}

function make(kind: ErrorKind, message: string, options: UserErrorOptions): UserError {
  return { ...(options.title ? { title: options.title } : {}), message, retryable: RETRYABLE[kind], kind };
}

/** A specific sentence (ours or the server's): worth retrying only when the failure itself is transient. */
function specific(kind: Exclude<ErrorKind, "message">, message: string, options: UserErrorOptions): UserError {
  return { ...make(kind, message, options), retryable: kind === "network" || kind === "busy" || kind === "rateLimit" || kind === "unknown" };
}

function fromKind(kind: Exclude<ErrorKind, "message">, options: UserErrorOptions): UserError {
  if (kind === "unknown" && options.fallback) return make("unknown", options.fallback, options);
  if (kind === "notFound" && options.notFound) return make("notFound", options.notFound, options);
  // The server answered, so "busy" names the service; "check your connection" is only for no answer at all.
  const key = kind === "busy" && options.dipbot ? "failure.busyDipbot"
    // "Some details need fixing" only helps when a field is marked; otherwise say the change was not accepted.
    : kind === "validation" && !options.hasFields ? "failure.rejected"
      : KIND_COPY[kind];
  return { ...make(kind, t(key), options), generic: true };
}

function fromApiError(error: ApiError, given: UserErrorOptions): UserError {
  const options = { ...given, hasFields: given.hasFields ?? Object.keys(error.fields).length > 0 };
  const kind = kindOfCode(error.code, error.message);
  const reasonCopy = error.reason ? REASON_COPY[error.reason]?.() ?? (AI_REASONS.includes(error.reason) ? tMaybe(`limit.${error.reason}`) : null) : null;
  if (reasonCopy) return specific(kind, reasonCopy, options);
  const vague = (error.messageKey && (VAGUE_KEYS as readonly string[]).includes(error.messageKey)) || vagueText().has(stripStatus(error.message).trim());
  if (!vague) {
    if (error.messageKey && hasMessage(error.messageKey)) return specific(kind, t(error.messageKey, error.messageParams ?? {}), options);
    const text = stripStatus(error.message);
    if (presentable(text)) return specific(kind, text, options);
  }
  return fromKind(kind, options);
}

/**
 * Maps anything thrown (ApiError, a Firebase SDK error, a fetch TypeError, a plain Error of ours) to what the person
 * sees. Our own sentences and the server's typed messages pass through; codes, statuses and keys never do.
 */
export function userError(error: unknown, options: UserErrorOptions = {}): UserError {
  if (error instanceof ApiError) return fromApiError(error, options);
  if (isOffline()) return fromKind("network", options);
  if (typeof error === "object" && error !== null) {
    const message = String((error as { message?: unknown }).message ?? "");
    const code = codeOf(error);
    if (code) return fromKind(kindOfCode(code, message), options);
    if (error instanceof TypeError && /fetch|network|load failed/i.test(message)) return fromKind("network", options);
    // A plain Error is how our own code reports a sentence (`new Error(t("roster.message.copyFailed"))`). Only an
    // exact catalog message passes: English text from a library or a stray `new Error("...")` gets the generic copy.
    if (Object.getPrototypeOf(error) === Error.prototype && isCatalogText(message)) return make("message", message, options);
  }
  return fromKind("unknown", options);
}

/** Just the sentence, for toasts and short status lines. */
export function userErrorMessage(error: unknown, fallback?: string, options: Omit<UserErrorOptions, "fallback"> = {}): string {
  return userError(error, fallback ? { ...options, fallback } : options).message;
}

/**
 * The save alert's sentence: on a conflict that offers Reload latest, it also says reloading drops the edits here.
 */
export function saveFailureMessage(error: unknown, canReload: boolean): string {
  const message = userErrorMessage(error);
  const conflict = error instanceof ApiError && error.code === "aborted";
  return conflict && canReload && message !== t("failure.conflict") ? `${message} ${t("failure.reloadLoses")}` : message;
}

/** A field error from the server: its own sentence, or "Check this field." when the server only said "Invalid request". */
export function fieldMessage(text: string, messageKey?: string): string {
  const clean = stripStatus(text);
  const vague = (messageKey !== undefined && (VAGUE_KEYS as readonly string[]).includes(messageKey)) || vagueText().has(clean.trim());
  return presentable(clean) && !vague ? clean : t("failure.field");
}
