/**
 * Pure domain logic for event share-link previews (docs/design/share-links.md).
 *
 * Privacy contract: the preview exposes ONLY an allowlisted subset of an event, to anyone holding the
 * (unguessable) link: title, a short plain-text description, a coarse date ("Thu, Nov 20") and an image.
 * Never the venue, address, locality, coordinates, time of day, tags, attendee data, cost or company id.
 */

/** Public origin of the share links; must equal `DIPShareLink.baseURL` (checked by scripts/tests). */
export const SHARE_ORIGIN = "https://team05-dip.web.app";

/** PLACEHOLDER: numeric App Store ID of the DIP listing. Empty until the listing exists. */
export const APP_STORE_ID = "";
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
export function renderSharePage(preview: SharePreview, appStoreId: string = APP_STORE_ID): string {
  const pageURL = preview.eventId ? `${SHARE_ORIGIN}/e/${encodeURIComponent(preview.eventId)}` : `${SHARE_ORIGIN}/`;
  const appLink = preview.eventId ? `dip://events/${encodeURIComponent(preview.eventId)}` : "dip://";
  const storeURL = /^[0-9]+$/.test(appStoreId) ? `https://apps.apple.com/app/id${appStoreId}` : "";
  const bannerId = storeURL ? appStoreId : APP_STORE_ID_PLACEHOLDER;
  const heading = preview.isEvent ? preview.title : storeURL ? "Join this activity on DIP" : "DIP is coming to the App Store";
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
  const body = storeURL
    ? `  <p>If DIP is installed, tap the button to open this activity. Otherwise we’ll take you to the App Store.</p>
  <a id="open" class="button" href="${escapeHtml(appLink)}">Open in DIP</a>
  <a id="store" class="button secondary" href="${escapeHtml(storeURL)}">Get DIP on the App Store</a>`
    : `  <p>DIP is coming to the App Store. If you already have the app, open this activity with the button below.</p>
  <a id="open" class="button" href="${escapeHtml(appLink)}">Open in DIP</a>
  <p class="note">The App Store listing isn’t live yet. Ask whoever shared this activity to let you know when it is, and we’ll point you to the download.</p>`;
  const script = storeURL
    ? `<script>
  // Universal Links open the app before this page loads; reaching here means the app is not handling it.
  // JS only (no meta refresh, no immediate redirect) so link-preview crawlers always read the tags above.
  (function () {
    var opened = false;
    var open = document.getElementById("open");
    if (open) { open.addEventListener("click", function () { opened = true; }); }
    setTimeout(function () { if (!opened) { location.replace(${JSON.stringify(storeURL).replace(/</g, "\\u003c")}); } }, 2500);
  })();
</script>
`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${tags.join("\n")}
<style>
  :root { --ink:#1E212B; --white:#FFFFFF; --purple:#7B88FA; --pink:#F054A5; --gray:#ECECEC; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px;
         background:var(--purple); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif; }
  main { width:100%; max-width:420px; background:var(--white); border-radius:20px; padding:30px 22px; text-align:center; }
  .logo { font-size:34px; font-weight:800; letter-spacing:-0.02em; margin:0 0 6px; }
  h1 { font-size:22px; margin:0 0 10px; overflow-wrap:anywhere; }
  p { font-size:16px; line-height:1.45; margin:0 0 18px; }
  .note { font-size:14px; opacity:.75; }
  .button { display:block; min-height:50px; line-height:50px; border-radius:25px; background:var(--pink); color:var(--white);
            font-size:16px; font-weight:600; text-decoration:none; margin:0 0 10px; }
  .button.secondary { background:var(--gray); color:var(--ink); }
</style>
</head>
<body>
<main>
  <p class="logo">DIP</p>
  <h1>${escapeHtml(heading)}</h1>
${body}
</main>
${script}</body>
</html>
`;
}
