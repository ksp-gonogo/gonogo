import { act } from "@ksp-gonogo/test-utils";

/** Opens every folded section of the widget on screen, as an operator does before reaching a control inside one. */
export function openSections(): void {
  act(() => {
    for (const trigger of document.querySelectorAll<HTMLElement>(
      'button[aria-expanded="false"]:not([aria-label="Signal-delay detail"])',
    ))
      trigger.click();
  });
}
