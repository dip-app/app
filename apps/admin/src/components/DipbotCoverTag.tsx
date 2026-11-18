// @i18n-migrated
import { t } from "@/lib/aiStrings";
import { DipbotMark } from "./DipbotMark";

/**
 * "Dipbot picked this": a small informational tag on a cover photo. A white pill with ink text and a hairline, so it
 * reads on any photo. Not a control. The parent decides when it shows (only while Dipbot's pick is the cover).
 */
export function DipbotCoverTag() {
  return <span className="dipbot-cover-tag"><DipbotMark size={14} /><span>{t("editor.coverPicked")}</span></span>;
}
