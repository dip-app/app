// Focus after an action that removes the control that was used (a row's Remove, a dialog's opener). Without this the
// browser drops focus to the page and a keyboard user starts over from the top.

/**
 * Moves focus to the first element matching `selector` once the current dialog has closed and returned focus to its
 * opener (so this wins). Falls back to `<main>`. Elements that are not focusable get `tabindex="-1"`.
 */
export function focusAfterClose(selector: string): void {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => setTimeout(() => {
    const target = document.querySelector<HTMLElement>(selector) ?? document.getElementById("main");
    if (!target) return;
    if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: false });
  }, 0));
}
