/**
 * LAUNCH SWITCHES: the single place for the App Store wiring (docs/ops/launch-switches.md).
 *
 * Read by the share page function (`modules/share`) and, as text, by `scripts/build-site.sh` for the landing
 * page (through `scripts/launch_config.py`). Keep both values as plain string/boolean literals on one line each:
 * the build script parses them without compiling TypeScript.
 *
 * The noindex switch is not here; it is the X-Robots-Tag header in firebase.json (`scripts/set-indexing.sh`).
 */

/** Numeric App Store ID of the DIP listing (the digits after `id` in the listing URL). Empty until the listing exists. */
export const APP_STORE_ID = "";

/**
 * Show Apple's official "Download on the App Store" badge instead of the text link/pill. Only takes effect when
 * APP_STORE_ID is set AND `apps/landing/img/app-store-badge.svg` (downloaded from Apple Marketing Tools) exists.
 */
export const USE_OFFICIAL_APP_STORE_BADGE = false;
