import { t } from "@/lib/aiStrings";
import { DipbotMark } from "./DipbotMark";

/** "Dipbot picked this" inline, next to a control Dipbot set (the Outdoor toggle). Informational, not a control. */
export function DipbotPickedTag() {
  return <span className="dipbot-tag"><DipbotMark size={14} /><span>{t("editor.coverPicked")}</span></span>;
}
