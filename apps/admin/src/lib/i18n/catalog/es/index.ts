// The Spanish catalog: neutral Latin American Spanish, informal "tú". A complete draft that needs review by a native
// speaker before release. Each area file is typed against its English source, so a missing key fails tsc as well as
// scripts/admin-i18n/check.ts.

import { prefixed, type MessageKey } from "../en";
import { account } from "./account";
import { ai } from "./ai";
import { audit } from "./audit";
import { challenges } from "./challenges";
import { common } from "./common";
import { dipbot } from "./dipbot";
import { editor } from "./editor";
import { events } from "./events";
import { login } from "./login";
import { members } from "./members";
import { overview } from "./overview";
import { shell } from "./shell";
import { ui } from "./ui";

export const es: Record<MessageKey, string> = {
  ...common,
  ...shell,
  ...ui,
  ...login,
  ...account,
  ...events,
  ...editor,
  ...dipbot,
  ...overview,
  ...members,
  ...audit,
  ...challenges,
  ...prefixed("ai.", ai),
};
