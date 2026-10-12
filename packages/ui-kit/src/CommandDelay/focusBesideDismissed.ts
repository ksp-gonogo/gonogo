const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/*
 * A dismiss button removes itself, and with it the keyboard operator's place.
 * Called from its click, before the removal, it moves focus to the next
 * dismiss button in the same rail or list, else the previous one, else the
 * first control in the panel's body, else the body itself. The first two
 * survive the removal, so focus set now stays where it was put.
 */
export function focusBesideDismissed(from: HTMLElement): void {
  const scope = from.closest("[data-panel-rail-frame], [data-command-list]");
  if (!scope) return;
  const dismissals = [...scope.querySelectorAll<HTMLElement>("[data-dismiss]")];
  const at = dismissals.indexOf(from);
  const beside = dismissals[at + 1] ?? dismissals[at - 1];
  if (beside && beside !== from) {
    beside.focus();
    return;
  }
  const body = scope
    .closest("[data-panel-rail-frame]")
    ?.parentElement?.querySelector<HTMLElement>("[data-panel-body]");
  if (!body) return;
  const first = body.querySelector<HTMLElement>(FOCUSABLE);
  if (first) {
    first.focus();
    return;
  }
  if (!body.hasAttribute("tabindex")) body.setAttribute("tabindex", "-1");
  body.focus();
}
