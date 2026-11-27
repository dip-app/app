/**
 * Pure domain logic for event share-link previews (docs/design/share-links.md).
 *
 * Privacy contract: the preview exposes ONLY an allowlisted subset of an event, to anyone holding the
 * (unguessable) link: title, a short plain-text description, a coarse date ("Thu, Nov 20") and an image.
 * Never the venue, address, locality, coordinates, time of day, tags, attendee data, cost or company id.
 * The page body shows the same description text as the preview tags; nothing else leaves the server.
 */

import { APP_STORE_ID, TESTFLIGHT_URL, USE_OFFICIAL_APP_STORE_BADGE } from "../../../config/launch";
import { coverJpegURL } from "../../covers/domain/coverCatalog";

/** Public origin of the share links; must equal `DIPShareLink.baseURL` (checked by scripts/tests). */
export const SHARE_ORIGIN = "https://letsdip.work";

/** Previous default Hosting origin; still served, and still accepted for stored preview images. */
export const LEGACY_SHARE_ORIGIN = "https://team05-dip.web.app";

/** App Store wiring lives in config/launch.ts (docs/ops/launch-switches.md); re-exported for existing importers. */
export { APP_STORE_ID, TESTFLIGHT_URL, USE_OFFICIAL_APP_STORE_BADGE };

/** Default time zone for the coarse date when the company has none set (`emailSettings/{companyId}.timeZone`). */
export const PREVIEW_TIME_ZONE = "America/New_York";

export const GENERIC_TITLE = "DIP";
export const GENERIC_DESCRIPTION = "Join activities with your coworkers on DIP.";
/** Generic page for an event link: says nothing about whether the event exists, is canceled or is private. */
export const GENERIC_EVENT_TITLE = "An event on DIP";
export const GENERIC_EVENT_DESCRIPTION = "Open this link in the DIP app on your iPhone to see the event.";
/** Description used when the organizer wrote none; the page body hides it (it only fills the preview). */
export const FALLBACK_DESCRIPTION = "Join this activity on DIP.";
const TESTFLIGHT_JOIN = /^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]{4,32}$/;
export const THEME_COLOR = "#7B88FA";

export const PREVIEW_IMAGE = { width: 1200, height: 630, type: "image/jpeg" } as const;
export const CATALOG_CATEGORIES: ReadonlySet<string> = new Set(["fitness", "outdoors", "hiking", "games", "cooking"]);
const CATALOG_PREFIX = "catalog://default/";
const COVER_LIBRARY_PREFIX = "catalog://cover/";

/** Origins and Firebase Storage buckets of this project whose https URLs may be used as preview images. */
const APPROVED_IMAGE_PREFIXES: readonly string[] = [
  `${SHARE_ORIGIN}/`,
  `${LEGACY_SHARE_ORIGIN}/`,
  "https://team05-dip.firebaseapp.com/",
  "https://firebasestorage.googleapis.com/v0/b/team05-dip.appspot.com/",
  "https://firebasestorage.googleapis.com/v0/b/team05-dip.firebasestorage.app/",
];

export const TITLE_MAX = 90;
/** The page heading has room for longer titles than link previews. */
export const PAGE_TITLE_MAX = 160;
export const DESCRIPTION_MAX = 180;

/** The only event fields the share page ever receives. */
export interface ShareEvent {
  title: string;
  description: string;
  startTime: Date | null;
  coverImageURL: string;
  status: string;
  /** The company's IANA time zone for the coarse date, when set; otherwise PREVIEW_TIME_ZONE. */
  timeZone?: string | null;
}

export interface SharePreview {
  title: string;
  /** Heading on the page itself: the same title, cut later than the preview title. */
  pageTitle: string;
  description: string;
  imageURL: string;
  /** Declared only for our own 1200x630 JPEGs; unknown for any other approved image. */
  imageIsStandard: boolean;
  imageAlt: string;
  eventId: string | null;
  /** Coarse date ("Fri, Nov 20") for the page body; null when unknown or for the generic page. */
  dateLabel: string | null;
  /** The organizer's description as shown on the page (same text and cut as the preview tags, no date); null when empty. */
  summary: string | null;
  /** True when the preview describes a real, shareable event (false: generic DIP page). */
  isEvent: boolean;
}

const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Extracts the opaque event id from `/e/<id>` (optional trailing slash); null for anything else. */
export function parseEventIdFromPath(path: string): string | null {
  const match = /^\/e\/([^/]+)\/?$/.exec(path);
  if (!match || !match[1]) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return EVENT_ID.test(id) ? id : null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

/** Plain text: control characters and runs of whitespace become single spaces. */
export function collapseWhitespace(value: string): string {
  return value
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncates at a word boundary with an ellipsis; text that fits is returned unchanged. */
export function truncateAtWord(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const slice = chars.slice(0, max - 1).join("");
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace >= max * 0.5 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s.,;:!?\-–—]+$/u, "")}…`;
}

/** "Thu, Nov 20": weekday, month and day only. Never a time of day. */
export function coarseDate(date: Date | null, timeZone: string = PREVIEW_TIME_ZONE): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  let zone = PREVIEW_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    zone = timeZone;
  } catch {
    // Unknown zone: keep the default.
  }
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone }).format(date);
}

/** Resolves a stored cover URL to an absolute https image URL we control or approved; else the default. */
export function resolveImage(coverImageURL: string | null | undefined): { url: string; standard: boolean } {
  const fallback = { url: `${SHARE_ORIGIN}/share/og/default.jpg`, standard: true };
  if (typeof coverImageURL !== "string") return fallback;
  if (coverImageURL.startsWith(COVER_LIBRARY_PREFIX)) {
    // Library covers: the 960 px JPEG next to the WebP (WhatsApp and iMessage previews do not read WebP); unknown keys use the default.
    const jpeg = coverJpegURL(SHARE_ORIGIN, coverImageURL);
    return jpeg ? { url: jpeg, standard: false } : fallback;
  }
  if (coverImageURL.startsWith(CATALOG_PREFIX)) {
    const category = coverImageURL.slice(CATALOG_PREFIX.length);
    return CATALOG_CATEGORIES.has(category) ? { url: `${SHARE_ORIGIN}/share/og/${category}.jpg`, standard: true } : fallback;
  }
  if (
    coverImageURL.length <= 1024 &&
    /^[\x21-\x7e]+$/.test(coverImageURL) &&
    !/["'<>\\]/.test(coverImageURL) &&
    APPROVED_IMAGE_PREFIXES.some((prefix) => coverImageURL.startsWith(prefix))
  ) {
    return { url: coverImageURL, standard: false };
  }
  return fallback;
}

export function genericPreview(eventId: string | null): SharePreview {
  return {
    title: eventId ? GENERIC_EVENT_TITLE : GENERIC_TITLE,
    pageTitle: eventId ? GENERIC_EVENT_TITLE : GENERIC_TITLE,
    description: eventId ? GENERIC_EVENT_DESCRIPTION : GENERIC_DESCRIPTION,
    imageURL: `${SHARE_ORIGIN}/share/og/default.jpg`,
    imageIsStandard: true,
    imageAlt: "DIP",
    eventId,
    dateLabel: null,
    summary: null,
    isEvent: false,
  };
}

/** Builds the preview for a shareable event; anything that is not a scheduled event gets the generic preview. */
export function buildPreview(eventId: string | null, event: ShareEvent | null): SharePreview {
  if (!event || event.status !== "scheduled") return genericPreview(eventId);
  const title = truncateAtWord(collapseWhitespace(event.title), TITLE_MAX);
  if (!title) return genericPreview(eventId);
  const date = coarseDate(event.startTime, event.timeZone ?? PREVIEW_TIME_ZONE);
  const text = collapseWhitespace(event.description);
  const body = text || FALLBACK_DESCRIPTION;
  const description = truncateAtWord(date ? `${date} · ${body}` : body, DESCRIPTION_MAX);
  // The page body shows the organizer's text with the same overall cut, without repeating the date.
  const summary = text ? truncateAtWord(text, DESCRIPTION_MAX - (date ? Array.from(`${date} · `).length : 0)) : null;
  const image = resolveImage(event.coverImageURL);
  return {
    title,
    pageTitle: truncateAtWord(collapseWhitespace(event.title), PAGE_TITLE_MAX),
    description,
    imageURL: image.url,
    imageIsStandard: image.standard,
    imageAlt: `Cover image for ${title}`,
    eventId,
    dateLabel: date,
    summary,
    isEvent: true,
  };
}

function metaName(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeHtml(content)}">`;
}
function metaProperty(property: string, content: string): string {
  return `<meta property="${property}" content="${escapeHtml(content)}">`;
}

/** The launch state the page's call to action describes (docs/ops/launch-switches.md). */
export interface ShareLaunch {
  appStoreId: string;
  useBadge: boolean;
  testflightURL: string;
}

const LAUNCH: ShareLaunch = { appStoreId: APP_STORE_ID, useBadge: USE_OFFICIAL_APP_STORE_BADGE, testflightURL: TESTFLIGHT_URL };

/** Self-hosted fonts and metric-matched fallbacks (the landing page's faces, served by Hosting under /img/landing/). */
const FONT_FACES = `  @font-face { font-family:"Figtree"; src:url(/img/landing/figtree.woff2) format("woff2"); font-weight:300 900; font-display:swap; }
  @font-face { font-family:"Fjalla One"; src:url(/img/landing/fjalla-one.woff2) format("woff2"); font-display:swap; }
  @font-face { font-family:"Fjalla Fallback"; src:local("Impact"); size-adjust:97%; ascent-override:100.9%; descent-override:24.8%; line-gap-override:0%; }
  @font-face { font-family:"Fjalla Fallback Arial"; src:local("Arial"); size-adjust:69.4%; ascent-override:100.9%; descent-override:24.8%; line-gap-override:0%; }
  @font-face { font-family:"Figtree Fallback"; src:local("Arial"); size-adjust:99.9%; ascent-override:95%; descent-override:25%; line-gap-override:0%; }`;

/**
 * Renders the complete server-side HTML page: preview tags for crawlers plus the human landing behaviour.
 * `launch` defaults to config/launch.ts; a string is read as the App Store id (with `useBadge`), as before.
 */
export function renderSharePage(
  preview: SharePreview,
  launch: Partial<ShareLaunch> | string = LAUNCH,
  useBadge?: boolean,
): string {
  const state: ShareLaunch = typeof launch === "string"
    ? { appStoreId: launch, useBadge: useBadge ?? USE_OFFICIAL_APP_STORE_BADGE, testflightURL: "" }
    : { ...LAUNCH, ...launch };
  const pageURL = preview.eventId ? `${SHARE_ORIGIN}/e/${encodeURIComponent(preview.eventId)}` : `${SHARE_ORIGIN}/`;
  const appLink = preview.eventId && EVENT_ID.test(preview.eventId) ? `dip://events/${encodeURIComponent(preview.eventId)}` : "dip://";
  const storeURL = /^[0-9]+$/.test(state.appStoreId) ? `https://apps.apple.com/app/id${state.appStoreId}` : "";
  const testflightURL = !storeURL && TESTFLIGHT_JOIN.test(state.testflightURL) ? state.testflightURL : "";
  const tags = [
    `<title>${escapeHtml(preview.title)}</title>`,
    metaName("description", preview.description),
    `<link rel="canonical" href="${escapeHtml(pageURL)}">`,
    `<link rel="image_src" href="${escapeHtml(preview.imageURL)}">`,
    metaName("theme-color", THEME_COLOR),
    // Safari's Smart App Banner only once a real listing exists (it can never match a TestFlight build).
    ...(storeURL ? [metaName("apple-itunes-app", `app-id=${state.appStoreId}, app-argument=${pageURL}`)] : []),
    metaProperty("og:site_name", "DIP"),
    metaProperty("og:type", "website"),
    metaProperty("og:locale", "en_US"),
    metaProperty("og:url", pageURL),
    metaProperty("og:title", preview.title),
    metaProperty("og:description", preview.description),
    metaProperty("og:image", preview.imageURL),
    metaProperty("og:image:secure_url", preview.imageURL),
    ...(preview.imageIsStandard
      ? [
          metaProperty("og:image:type", PREVIEW_IMAGE.type),
          metaProperty("og:image:width", String(PREVIEW_IMAGE.width)),
          metaProperty("og:image:height", String(PREVIEW_IMAGE.height)),
        ]
      : []),
    metaProperty("og:image:alt", preview.imageAlt),
    metaName("twitter:card", "summary_large_image"),
    metaName("twitter:title", preview.title),
    metaName("twitter:description", preview.description),
    metaName("twitter:image", preview.imageURL),
    metaName("twitter:image:alt", preview.imageAlt),
  ];
  // For people without the app, honest about the launch state: a secondary install button once there is somewhere to
  // install from, else one muted line. Nothing navigates by itself.
  const note = storeURL && state.useBadge
    ? `<div class="get"><span class="get-label">New to DIP?</span><a class="badge" href="${escapeHtml(storeURL)}"><img src="/img/landing/app-store-badge.svg" alt="Download on the App Store" height="40"></a></div>`
    : storeURL
      ? `<div class="get"><span class="get-label">New to DIP?</span><a class="pill secondary" href="${escapeHtml(storeURL)}">Get it on the App Store</a></div>`
      : testflightURL
        ? `<div class="get"><span class="get-label">New to DIP?</span><a class="pill secondary" href="${escapeHtml(testflightURL)}">Join the beta on TestFlight</a><span class="get-hint">You sign in with your work Google account; your company needs to use DIP.</span></div>`
        : `<p class="note">New to DIP? It’s in private beta for invited companies. Ask your DIP admin how to join.</p>`;
  // Our category preview images carry a DIP strip along the bottom; the page crops it (the header already shows the logo).
  const strip = preview.imageIsStandard && /\/share\/og\/(?!default\.jpg)[a-z]+\.jpg$/.test(preview.imageURL);
  const card = preview.isEvent
    ? `    <div class="cover${strip ? " strip" : ""}"><img src="${escapeHtml(preview.imageURL)}" alt="${escapeHtml(preview.imageAlt)}" width="${PREVIEW_IMAGE.width}" height="${PREVIEW_IMAGE.height}" fetchpriority="high"></div>
${preview.dateLabel ? `    <p class="date">${escapeHtml(preview.dateLabel)}</p>\n` : ""}`
    : "";
  const lead = preview.isEvent
    ? (preview.summary ? `    <p class="summary" dir="auto">${escapeHtml(preview.summary)}</p>\n` : "")
    : `    <p class="lead">${escapeHtml(preview.description)}</p>\n`;
  // Appended to the hedged "didn't open" message; static strings only (the URLs are validated above).
  const getLink = storeURL || testflightURL;
  const statusLink = getLink
    ? ` <a href="${escapeHtml(getLink)}">${storeURL ? "Get DIP on the App Store" : "Join the beta on TestFlight"}</a>.`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
${tags.join("\n")}
<link rel="icon" href="/img/landing/logo.svg" type="image/svg+xml">
<link rel="icon" href="/img/landing/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/img/landing/apple-touch-icon.png" sizes="180x180">
<link rel="preload" href="/img/landing/fjalla-one.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/img/landing/figtree.woff2" as="font" type="font/woff2" crossorigin>
<style>
${FONT_FACES}
  :root { --display:"Fjalla One","Fjalla Fallback","Fjalla Fallback Arial",sans-serif; --body:Figtree,"Figtree Fallback",-apple-system,system-ui,sans-serif; --bg:#FFFFFF; --text:#1E212B; --muted:rgba(30,33,43,.72); --accent:#4A56D6; --brand:#4A56D6; --brand-hover:#3B47C4; --on-brand:#FFFFFF; --tint:rgba(123,136,250,.10); --line:rgba(123,136,250,.45); --hairline:rgba(30,33,43,.12); }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161D; --text:#F4F5FA; --muted:rgba(244,245,250,.72); --accent:#A3ACFC; --brand:#8C97FB; --brand-hover:#A3ACFC; --on-brand:#14161D; --tint:rgba(123,136,250,.16); --line:rgba(123,136,250,.55); --hairline:rgba(244,245,250,.14); } }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background:var(--bg); color:var(--text); font:400 17px/1.5 var(--body); min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; -webkit-text-size-adjust:100%; }
  a { color:var(--accent); text-underline-offset:3px; }
  a:focus-visible { outline:3px solid var(--text); outline-offset:3px; border-radius:6px; }
  .wrap { width:min(560px,100%); margin:0 auto; padding:0 20px; }
  header { padding:22px 0 0; }
  .logo { display:inline-flex; align-items:center; gap:12px; font-family:var(--display); font-size:34px; line-height:1; letter-spacing:.02em; text-decoration:none; color:var(--text); min-height:46px; }
  .logo img { width:46px; height:46px; display:block; border-radius:50%; }
  main { flex:1; padding:28px 0 48px; }
  .cover { margin:0 0 22px; border-radius:20px; overflow:hidden; border:1.5px solid var(--line); background:var(--tint); aspect-ratio:1200/630; }
  .cover img { display:block; width:100%; height:100%; object-fit:cover; }
  .cover.strip { aspect-ratio:1200/510; }
  .cover.strip img { object-position:top; }
  .date { margin:0 0 8px; font-size:15px; line-height:20px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--accent); }
  h1 { font-family:var(--display); font-weight:400; font-size:clamp(34px,9vw,48px); line-height:1.08; margin:0 0 14px; text-transform:uppercase; overflow-wrap:anywhere; text-wrap:balance; }
  h1.long { font-size:clamp(28px,7vw,36px); line-height:1.12; }
  .summary { margin:0 0 26px; font-size:18px; line-height:1.5; color:var(--muted); overflow-wrap:anywhere; }
  .lead { font-size:20px; color:var(--muted); margin:0 0 26px; }
  h1:has(+ .pill) { margin-bottom:26px; }
  .pill { display:inline-flex; align-items:center; justify-content:center; min-height:56px; padding:0 30px; border-radius:28px; font:600 19px/1 var(--body); text-decoration:none; white-space:nowrap; background:var(--brand); color:var(--on-brand); transition:background-color .15s ease-out, transform .1s ease-out; }
  .pill:hover { background:var(--brand-hover); }
  .pill:active { transform:scale(.97); }
  .note { margin:16px 0 0; font-size:15px; line-height:22px; color:var(--muted); }
  /* "Didn't open" notice: same wording, place and style as on the landing page. */
  .status { margin:14px 0 0; padding:10px 14px; border:1px solid var(--line); background:var(--tint); border-radius:12px; font-size:15px; line-height:22px; color:var(--text); }
  .status:empty { display:none; }
  .status a { color:var(--accent); }
  .get { display:flex; flex-wrap:wrap; align-items:center; gap:10px 14px; margin:22px 0 0; padding-top:20px; border-top:1px solid var(--hairline); }
  .get-label { font-size:15px; color:var(--muted); }
  .get-hint { flex:1 1 100%; font-size:14px; line-height:20px; color:var(--muted); }
  .pill.secondary { min-height:48px; padding:0 22px; font-size:17px; background:transparent; color:var(--accent); box-shadow:inset 0 0 0 1.5px var(--brand); }
  .pill.secondary:hover { background:var(--tint); }
  footer { border-top:1px solid var(--hairline); }
  footer .wrap { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:0 20px; padding-top:6px; padding-bottom:max(10px, env(safe-area-inset-bottom)); font-size:14px; color:var(--muted); }
  footer nav { display:flex; flex-wrap:wrap; gap:0 20px; }
  footer a { display:inline-flex; align-items:center; min-height:44px; color:var(--muted); }
  footer a:hover { color:var(--text); }
  footer small { font-size:14px; }
  @media (max-width:480px) { .pill { display:flex; width:100%; } .get .pill { flex:1 1 100%; } }
  @media (prefers-reduced-motion: reduce) { .pill { transition:none; } }
</style>
</head>
<body>
<header><div class="wrap"><a class="logo" href="/" aria-label="DIP home"><img src="/img/landing/logo.svg" alt="" width="46" height="46">DIP</a></div></header>
<main>
  <div class="wrap">
${card}    <h1 dir="auto"${Array.from(preview.pageTitle).length > 60 ? ' class="long"' : ""}>${escapeHtml(preview.pageTitle)}</h1>
${lead}    <a class="pill" id="open-app" href="${escapeHtml(appLink)}">Open in DIP</a>
    <p class="status" id="open-status" role="status"></p>
    ${note}
  </div>
</main>
<footer><div class="wrap"><small>&copy; 2026 DIP</small><nav aria-label="Site"><a href="/">About DIP</a><a href="/privacy/">Privacy</a><a href="/support/">Support</a></nav></div></footer>
<template id="not-opened">If DIP didn’t open, it may not be installed on this iPhone. In another app’s browser, open this page in Safari first.${statusLink}</template>
<script>
// "Open in DIP" opens the installed app through a hidden frame (no "address is invalid" alert in iOS Safari when it is
// missing). Universal Links open the app before this page loads; no meta refresh or redirect, so crawlers always read
// the tags above. If the page is still in front about 2.5 s after a tap, say so (hedged: in-app browsers can block the
// scheme even with DIP installed). Nothing ever navigates by itself.
(function () {
  var btn = document.getElementById('open-app');
  var status = document.getElementById('open-status');
  var message = document.getElementById('not-opened');
  if (!btn || !status || !message) return;
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var timer = 0;
  function cancel() { clearTimeout(timer); timer = 0; }
  addEventListener('pagehide', cancel); addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', function () { if (document.hidden) cancel(); });
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    status.textContent = '';
    if (!ios) { status.textContent = 'DIP is an iPhone app. Open this link on your iPhone to see it in DIP.'; return; }
    var f = document.createElement('iframe');
    f.hidden = true; f.setAttribute('aria-hidden', 'true'); f.src = btn.getAttribute('href');
    document.body.appendChild(f);
    setTimeout(function () { f.remove(); }, 1500);
    cancel();
    timer = setTimeout(function () {
      if (!document.hidden) status.replaceChildren(message.content.cloneNode(true));
    }, 2500);
  });
})();
</script>
</body>
</html>
`;
}
