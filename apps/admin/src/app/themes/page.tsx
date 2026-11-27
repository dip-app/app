"use client";

import { Redirect, withQuery } from "@/components/Redirect";

/** Moved: Weekly themes is now the Schedule tab of Challenges. The query string (phase, id) carries over. */
export default function ThemesRedirect() {
  return <Redirect to={(params) => withQuery("/challenges/", params)} />;
}
