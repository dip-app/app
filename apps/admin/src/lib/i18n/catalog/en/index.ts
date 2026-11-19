// The English catalog: the source of every key. One file per area so areas can be migrated in parallel.
// Imports stay relative and dependency free, because scripts/admin-i18n/check.ts loads these files outside Next.

import { account } from "./account";
import { ai } from "./ai";
import { audit } from "./audit";
import { errors } from "./errors";
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
import { themeForm } from "./themeForm";
import { attendees } from "./attendees";
import { memberDetail } from "./memberDetail";
import { review } from "./review";
import { bugs } from "./bugs";
import { roster } from "./roster";
import { importer } from "./importer";

export type Prefixed<T, P extends string> = { [K in keyof T & string as `${P}${K}`]: T[K] };

export function prefixed<T extends Record<string, string>, P extends string>(prefix: P, messages: T): Prefixed<T, P> {
  return Object.fromEntries(Object.entries(messages).map(([key, value]) => [`${prefix}${key}`, value])) as Prefixed<T, P>;
}

export const en = {
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
  ...errors,
  ...challenges,
  ...themeForm,
  ...attendees,
  ...memberDetail,
  ...review,
  ...bugs,
  ...roster,
  ...importer,
  ...prefixed("ai.", ai),
};

export type MessageKey = keyof typeof en;
