"use client";

import { Redirect, withQuery } from "@/components/Redirect";

/** Moved: Weekly themes is now the Schedule tab of Challenges. The query string (phase, id) carries over. */
export default function EditThemeRedirect() {
  return <Redirect to={(params) => withQuery("/challenges/edit/", params)} />;
}
