import type { Metadata } from "next";
import { share } from "@/lib/seo";

// The login page is the portal's front door, so it carries its own title and description. The canonical
// URL (/admin/), robots and icons come from the root layout.
const TITLE = "Sign in to DIP Admin";
const DESCRIPTION =
  "Sign in with Google to organize your company's events on DIP: events, albums and moderation, attendees, members and roster, bulk import and challenge review.";

export const metadata: Metadata = { title: { absolute: TITLE }, description: DESCRIPTION, ...share(TITLE, DESCRIPTION) };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
