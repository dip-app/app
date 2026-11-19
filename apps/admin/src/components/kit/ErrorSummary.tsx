// @i18n-migrated

import type { Ref } from "react";
import { InlineNotice } from "./InlineNotice";

export interface ErrorSummaryItem {
  /** DOM id of the control to focus. Items with the same target and label are listed once (the first wins). */
  target: string;
  /** The field's name as it reads on the form ("Cover image"). Empty when the message already names the field. */
  label: string;
  message: string;
}

/**
 * A form's list of everything to fix, shown above the form after a submit (GOV.UK error summary pattern). Each line
 * links to its field. The form moves focus to the summary (pass `ref`), so it is not a live region: focus announces
 * it once. Field-level messages stay next to each field.
 */
export function ErrorSummary({ title, items, ref }: { title: string; items: readonly ErrorSummaryItem[]; ref?: Ref<HTMLDivElement> }) {
  const seen = new Set<string>();
  const unique = items.filter((item) => { const key = `${item.target}\n${item.label}`; return seen.has(key) ? false : (seen.add(key), true); });
  if (unique.length === 0) return null;
  function jump(event: React.MouseEvent<HTMLAnchorElement>, target: string) {
    const control = document.getElementById(target);
    if (!control) return;
    event.preventDefault();
    control.focus({ preventScroll: true });
    control.scrollIntoView({ block: "center", behavior: "auto" });
  }
  return (
    <InlineNotice tone="error" ref={ref} announce={false} title={title} className="error-summary">
      <ul className="error-summary-list">
        {unique.map((item) => (
          <li key={`${item.target}-${item.label}`}>
            <a href={`#${item.target}`} onClick={(event) => jump(event, item.target)}>{item.label ? `${item.label}: ${item.message}` : item.message}</a>
          </li>
        ))}
      </ul>
    </InlineNotice>
  );
}
