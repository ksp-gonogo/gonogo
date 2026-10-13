/** Whether a control is unavailable to the operator: natively disabled, or aria-disabled as a button with a reason is. */
export function isDisabled(element: Element): boolean {
  return (
    element.matches(":disabled") ||
    element.getAttribute("aria-disabled") === "true"
  );
}
