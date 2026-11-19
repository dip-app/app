import { translator, type Catalogs } from "../../../i18n";
import { en } from "./en";
import { es } from "./es";

export type PushKey = keyof typeof en;
export const pushCatalogs: Catalogs<PushKey> = { en, es };
export const tPush = translator(pushCatalogs);
