/**
 * Pure domain logic for event share-link previews (docs/design/share-links.md).
 *
 * Privacy contract: the preview exposes ONLY an allowlisted subset of an event, to anyone holding the
 * (unguessable) link: title, a short plain-text description, a coarse date ("Thu, Nov 20") and an image.
 * Never the venue, address, locality, coordinates, time of day, tags, attendee data, cost or company id.
 */

import { APP_STORE_ID, USE_OFFICIAL_APP_STORE_BADGE } from "../../../config/launch";

/** Public origin of the share links; must equal `DIPShareLink.baseURL` (checked by scripts/tests). */
export const SHARE_ORIGIN = "https://letsdip.work";

/** Previous default Hosting origin; still served, and still accepted for stored preview images. */
export const LEGACY_SHARE_ORIGIN = "https://team05-dip.web.app";

/** App Store wiring lives in config/launch.ts (docs/ops/launch-switches.md); re-exported for existing importers. */
export { APP_STORE_ID, USE_OFFICIAL_APP_STORE_BADGE };
/** Used in the `apple-itunes-app` banner meta while APP_STORE_ID is unset. */
export const APP_STORE_ID_PLACEHOLDER = "0000000000";

/** Time zone used for the coarse date; times are stored in UTC and the company has no time zone yet. */
export const PREVIEW_TIME_ZONE = "America/New_York";

export const GENERIC_TITLE = "DIP";
export const GENERIC_DESCRIPTION = "Join activities with your coworkers on DIP.";
export const THEME_COLOR = "#7B88FA";

export const PREVIEW_IMAGE = { width: 1200, height: 630, type: "image/jpeg" } as const;
export const CATALOG_CATEGORIES: ReadonlySet<string> = new Set(["fitness", "outdoors", "hiking", "games", "cooking"]);
const CATALOG_PREFIX = "catalog://default/";

/** Origins and Firebase Storage buckets of this project whose https URLs may be used as preview images. */
const APPROVED_IMAGE_PREFIXES: readonly string[] = [
  `${SHARE_ORIGIN}/`,
  `${LEGACY_SHARE_ORIGIN}/`,
  "https://team05-dip.firebaseapp.com/",
  "https://firebasestorage.googleapis.com/v0/b/team05-dip.appspot.com/",
  "https://firebasestorage.googleapis.com/v0/b/team05-dip.firebasestorage.app/",
];

export const TITLE_MAX = 90;
export const DESCRIPTION_MAX = 180;

/** The only event fields the share page ever receives. */
export interface ShareEvent {
  title: string;
  description: string;
  startTime: Date | null;
  coverImageURL: string;
  status: string;
}

export interface SharePreview {
  title: string;
  description: string;
  imageURL: string;
  /** Declared only for our own 1200x630 JPEGs; unknown for any other approved image. */
  imageIsStandard: boolean;
  imageAlt: string;
  eventId: string | null;
  /** Coarse date ("Fri, Nov 20") for the page body; null when unknown or for the generic page. */
  dateLabel: string | null;
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
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).format(date);
}

/** Resolves a stored cover URL to an absolute https image URL we control or approved; else the default. */
export function resolveImage(coverImageURL: string | null | undefined): { url: string; standard: boolean } {
  const fallback = { url: `${SHARE_ORIGIN}/share/og/default.jpg`, standard: true };
  if (typeof coverImageURL !== "string") return fallback;
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
    title: GENERIC_TITLE,
    description: GENERIC_DESCRIPTION,
    imageURL: `${SHARE_ORIGIN}/share/og/default.jpg`,
    imageIsStandard: true,
    imageAlt: "DIP",
    eventId,
    dateLabel: null,
    isEvent: false,
  };
}

/** Builds the preview for a shareable event; anything that is not a scheduled event gets the generic preview. */
export function buildPreview(eventId: string | null, event: ShareEvent | null): SharePreview {
  if (!event || event.status !== "scheduled") return genericPreview(eventId);
  const title = truncateAtWord(collapseWhitespace(event.title), TITLE_MAX);
  if (!title) return genericPreview(eventId);
  const date = coarseDate(event.startTime);
  const text = collapseWhitespace(event.description);
  const body = text || "Join this activity on DIP.";
  const description = truncateAtWord(date ? `${date} · ${body}` : body, DESCRIPTION_MAX);
  const image = resolveImage(event.coverImageURL);
  return {
    title,
    description,
    imageURL: image.url,
    imageIsStandard: image.standard,
    imageAlt: `Cover image for ${title}`,
    eventId,
    dateLabel: date,
    isEvent: true,
  };
}

function metaName(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeHtml(content)}">`;
}
function metaProperty(property: string, content: string): string {
  return `<meta property="${property}" content="${escapeHtml(content)}">`;
}

/** Renders the complete server-side HTML page: preview tags for crawlers plus the human landing behaviour. */
export function renderSharePage(
  preview: SharePreview,
  appStoreId: string = APP_STORE_ID,
  useBadge: boolean = USE_OFFICIAL_APP_STORE_BADGE,
): string {
  const pageURL = preview.eventId ? `${SHARE_ORIGIN}/e/${encodeURIComponent(preview.eventId)}` : `${SHARE_ORIGIN}/`;
  const appLink = preview.eventId && EVENT_ID.test(preview.eventId) ? `dip://events/${encodeURIComponent(preview.eventId)}` : "dip://";
  const storeURL = /^[0-9]+$/.test(appStoreId) ? `https://apps.apple.com/app/id${appStoreId}` : "";
  const bannerId = storeURL ? appStoreId : APP_STORE_ID_PLACEHOLDER;
  const tags = [
    `<title>${escapeHtml(preview.title)}</title>`,
    metaName("description", preview.description),
    `<link rel="canonical" href="${escapeHtml(pageURL)}">`,
    `<link rel="image_src" href="${escapeHtml(preview.imageURL)}">`,
    metaName("theme-color", THEME_COLOR),
    metaName("apple-itunes-app", `app-id=${bannerId}, app-argument=${pageURL}`),
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
  const note = !storeURL
    ? `<p class="note">Don’t have DIP yet? It’s coming to the App Store.</p>`
    : useBadge
      ? `<p class="note"><a class="badge" href="${escapeHtml(storeURL)}"><img src="/img/landing/app-store-badge.svg" alt="Download on the App Store" height="40"></a></p>`
      : `<p class="note">Don’t have DIP yet? <a href="${escapeHtml(storeURL)}">Get it on the App Store</a>.</p>`;
  const card = preview.isEvent
    ? `    <div class="cover"><img src="${escapeHtml(preview.imageURL)}" alt="${escapeHtml(preview.imageAlt)}" width="${PREVIEW_IMAGE.width}" height="${PREVIEW_IMAGE.height}"></div>
${preview.dateLabel ? `    <p class="date">${escapeHtml(preview.dateLabel)}</p>\n` : ""}`
    : "";
  const lead = preview.isEvent ? "" : `    <p class="lead">${escapeHtml(preview.description)}</p>\n`;
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fjalla+One&family=Figtree:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root { --purple:#7B88FA; --pink:#FB72E4; --ink:#1E212B; --yellow:#FFCC3E; --bg:#FFFFFF; --accent:#4A56D6; --text:var(--ink); --muted:rgba(30,33,43,.70); --tint:rgba(123,136,250,.10); --line:rgba(123,136,250,.45); }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161D; --accent:#7B88FA; --text:#F4F5FA; --muted:rgba(244,245,250,.72); --tint:rgba(123,136,250,.16); --line:rgba(123,136,250,.55); } }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { background:var(--bg); color:var(--text); font:400 17px/1.5 Figtree,-apple-system,system-ui,sans-serif; min-height:100vh; min-height:100dvh; display:flex; flex-direction:column; }
  .wrap { width:min(520px,100%); margin:0 auto; padding:0 20px; }
  header { padding:22px 0 0; }
  .logo { display:inline-flex; align-items:center; gap:12px; font-family:"Fjalla One",Impact,sans-serif; font-size:34px; line-height:1; letter-spacing:.02em; text-decoration:none; color:var(--text); }
  .logo img { width:46px; height:46px; display:block; border-radius:50%; }
  main { flex:1; padding:28px 0 48px; }
  .cover { margin:0 0 22px; border-radius:20px; overflow:hidden; border:1.5px solid var(--line); background:var(--tint); aspect-ratio:1200/630; }
  .cover img { display:block; width:100%; height:100%; object-fit:cover; }
  .date { margin:0 0 6px; font-size:17px; font-weight:600; color:var(--accent); }
  h1 { font-family:"Fjalla One",Impact,sans-serif; font-weight:400; font-size:clamp(34px,9vw,48px); line-height:1.08; margin:0 0 24px; text-transform:uppercase; overflow-wrap:anywhere; }
  .lead { font-size:20px; color:var(--muted); margin:0 0 24px; }
  .pill { display:inline-flex; align-items:center; justify-content:center; gap:12px; min-height:56px; padding:0 26px 0 18px; border-radius:28px; font:400 20px/1 Figtree,sans-serif; text-decoration:none; white-space:nowrap; background:#0071E3; color:#FFFFFF; transition:background .15s, transform .1s; }
  .pill:hover { background:#0A84FF; }
  .pill:active { transform:scale(.97); }
  .pill:focus-visible { outline:3px solid var(--text); outline-offset:3px; }
  .store-icon { display:block; flex:none; }
  .note { margin:18px 0 0; font-size:14px; color:var(--muted); }
  .note a { color:inherit; text-underline-offset:3px; }
  @media (max-width:420px) { .pill { display:flex; width:100%; } }
  @media (prefers-reduced-motion: reduce) { .pill { transition:none; } }
</style>
</head>
<body>
<header><div class="wrap"><a class="logo" href="/" aria-label="DIP home"><img src="/img/landing/logo.svg" alt="" width="46" height="46">DIP</a></div></header>
<main>
  <div class="wrap">
${card}    <h1>${escapeHtml(preview.title)}</h1>
${lead}    <a class="pill" id="open-app" href="${escapeHtml(appLink)}" role="button"><img class="store-icon" src="/img/landing/app-store.svg" alt="" width="26" height="26">Get the app</a>
    ${note}
  </div>
</main>
<script>
// "Get the app" opens the installed app; with no app installed nothing happens (a hidden frame avoids the
// "address is invalid" alert that iOS Safari shows when navigating straight to an unhandled scheme).
// Universal Links open the app before this page loads; no meta refresh or redirect, so crawlers always read the tags above.
(function () {
  var btn = document.getElementById('open-app');
  if (!btn) return;
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    var f = document.createElement('iframe');
    f.hidden = true; f.setAttribute('aria-hidden', 'true'); f.src = btn.getAttribute('href');
    document.body.appendChild(f);
    setTimeout(function () { f.remove(); }, 1500);${storeURL ? `
    // No app installed (page still visible after the tap): offer the listing. Only ever after a tap.
    setTimeout(function () { if (!document.hidden) { location.href = ${JSON.stringify(storeURL).replace(/</g, "\\u003c")}; } }, 1500);` : ""}
  });
})();
</script>
</body>
</html>
`;
}
