import type { Metadata } from "next";

/**
 * Share metadata for the portal. It is served under /admin on the shared letsdip.work site, so every URL
 * is absolute (link previews need full addresses and Next would not add the basePath to images).
 * Pre-release the whole site is noindex through the X-Robots-Tag header in firebase.json.
 */
export const ORIGIN = "https://letsdip.work";
export const ADMIN_URL = `${ORIGIN}/admin/`;
export const OG_IMAGE = `${ORIGIN}/img/og-admin.jpg`;
export const OG_ALT =
  "DIP Admin: the organizer portal for DIP company events, shown as a portal window with event rows and the app's avatar characters.";
export const DESCRIPTION =
  "The DIP organizer portal: create and manage your company's events, albums and moderation, attendees, members and roster, bulk imports and challenge review.";

/** Open Graph and Twitter blocks (Next replaces these per page, it does not merge them). */
export function share(title: string, description: string): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type: "website",
      siteName: "DIP",
      locale: "en_US",
      url: ADMIN_URL,
      title,
      description,
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: OG_ALT, type: "image/jpeg" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [{ url: OG_IMAGE, alt: OG_ALT }] },
  };
}
